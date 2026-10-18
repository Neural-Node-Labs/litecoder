// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:35:56.265Z | xcoder:subtask code-st-9de79a
/**
 * Plan → work.
 *
 * Deliberately thin. `WorkerOrchestrator` already provides concurrency,
 * per-subtask retries, attempt history, an AbortSignal, and — critically —
 * crash isolation (`crashed: true` instead of a rejected promise). This file
 * adds exactly the two things a plan has that a worker request does not:
 *
 *   1. `dependsOn`, resolved into sequential topological waves. It is NOT a
 *      `WorkerSubtask` field and is not pushed down; independence there is a
 *      deliberate contract we do not want to widen.
 *   2. A `skipped` status, for a subtask whose dependency did not succeed.
 *      It is never dispatched, so it must never be reported as `failed` —
 *      that would blame work that never ran.
 *
 * It never rethrows a subtask error (AC7): a run that loses one subtask still
 * produces a full report.
 */
import type { LlmClient } from "../llm/client.js";
import type { Role } from "../types.js";
import {
  WorkerOrchestrator,
  type WorkerRunRequest,
  type WorkerRunReport,
  type WorkerSubtask,
  type WorkerSubtaskReport,
} from "../worker-agent/worker-orchestrator.js";
import type { Plan } from "./plan-schema.js";
import type { BylawVerdict, SecureGate } from "./secure-gate.js";

export type LitecoderSubtaskStatus = "done" | "failed" | "skipped";

export interface LitecoderSubtaskReport extends Omit<WorkerSubtaskReport, "status"> {
  readonly role: Role;
  readonly status: LitecoderSubtaskStatus;
  /** Always null when `--secure` is off (AC11). */
  readonly bylawVerdict: BylawVerdict | null;
  readonly dependsOn: readonly string[];
}

export interface DispatchOptions {
  readonly workspaceRoot: string;
  readonly llm: LlmClient;
  readonly concurrency: number;
  readonly maxAttempts: number;
  readonly secure: SecureGate;
  readonly taskId?: string;
  readonly signal?: AbortSignal;
  readonly quiet?: boolean;
}

export interface DispatchOutcome {
  readonly subtasks: readonly LitecoderSubtaskReport[];
  readonly totals: {
    readonly subtasks: number;
    readonly done: number;
    readonly failed: number;
    readonly skipped: number;
    readonly totalAttempts: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly durationMs: number;
  };
}

/** The only thing the dispatcher needs from the engine — an injection seam for tests. */
export interface DispatchEngine {
  run(request: WorkerRunRequest): Promise<WorkerRunReport>;
}

function emptySubtaskReport(
  id: string,
  role: Role,
  dependsOn: readonly string[],
  reason: string,
): LitecoderSubtaskReport {
  return {
    id,
    role,
    status: "skipped",
    attempts: 0,
    summary: "",
    error: reason,
    filesTouched: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    iterations: 0,
    crashed: false,
    history: [],
    bylawVerdict: null,
    dependsOn,
  };
}

/**
 * Groups the plan into waves: everything whose dependencies have already been
 * placed goes into the next wave. A validated plan is acyclic and has no
 * dangling ids (see `PlanSchema`), so this always terminates; the guard is
 * belt-and-braces so a hand-built `Plan` in a test cannot hang the run.
 */
function planWaves(plan: Plan): Array<Plan["subtasks"]> {
  const placed = new Set<string>();
  const remaining = [...plan.subtasks];
  const waves: Array<Plan["subtasks"]> = [];

  while (remaining.length > 0) {
    const wave = remaining.filter((s) => s.dependsOn.every((d) => placed.has(d)));
    if (wave.length === 0) {
      // Unreachable for a validated plan. Place the rest so the run ends.
      waves.push(remaining);
      break;
    }
    waves.push(wave);
    for (const s of wave) {
      placed.add(s.id);
      const idx = remaining.indexOf(s);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return waves;
}

export async function dispatchPlan(
  plan: Plan,
  opts: DispatchOptions,
  engine?: DispatchEngine,
): Promise<DispatchOutcome> {
  const startedAt = Date.now();
  const runner: DispatchEngine =
    engine ??
    new WorkerOrchestrator({
      workspaceRoot: opts.workspaceRoot,
      llm: opts.llm,
      quiet: opts.quiet ?? false,
    });

  const byId = new Map<string, LitecoderSubtaskReport>();
  const waves = planWaves(plan);

  for (const wave of waves) {
    if (opts.signal?.aborted) {
      for (const sub of wave) {
        byId.set(sub.id, emptySubtaskReport(sub.id, sub.role, sub.dependsOn, "aborted before dispatch"));
      }
      continue;
    }

    const runnable: WorkerSubtask[] = [];
    for (const sub of wave) {
      const blockedBy = sub.dependsOn.filter((d) => byId.get(d)?.status !== "done");
      if (blockedBy.length > 0) {
        byId.set(
          sub.id,
          emptySubtaskReport(
            sub.id,
            sub.role,
            sub.dependsOn,
            `skipped: dependency did not complete (${blockedBy.join(", ")})`,
          ),
        );
        continue;
      }

      // The bylaw block rides on the existing, already-typed `upstreamContext`
      // vehicle, so `SubAgent` renders it without any change to the agent.
      const bylawBlock = opts.secure.promptBlock(sub.role, sub.goal);
      const upstreamContext: Record<string, unknown> = {};
      if (bylawBlock) upstreamContext.bylawContext = bylawBlock;

      runnable.push({
        id: sub.id,
        goal: sub.goal,
        role: sub.role,
        deliverableSpec: sub.deliverableSpec,
        ...(Object.keys(upstreamContext).length > 0 ? { upstreamContext } : {}),
      });
    }

    if (runnable.length === 0) continue;

    let report: WorkerRunReport;
    try {
      report = await runner.run({
        taskDescription: plan.rationale,
        subtasks: runnable,
        concurrency: opts.concurrency,
        maxAttempts: opts.maxAttempts,
        taskId: opts.taskId,
        signal: opts.signal,
      });
    } catch (e) {
      // `WorkerOrchestrator.run` is contractually non-throwing; if it did
      // throw, attribute the failure to this wave rather than lose the run.
      const message = (e as Error)?.message ?? String(e);
      for (const sub of runnable) {
        byId.set(sub.id, {
          ...emptySubtaskReport(sub.id, sub.role ?? "programmer", [], message),
          status: "failed",
          attempts: 1,
          history: [{ attempt: 1, ok: false, error: message }],
        });
      }
      continue;
    }

    for (const sub of runnable) {
      const planned = plan.subtasks.find((p) => p.id === sub.id)!;
      const worker = report.subtasks.find((r) => r.id === sub.id);
      if (!worker) {
        byId.set(sub.id, emptySubtaskReport(sub.id, planned.role, planned.dependsOn, "no result returned"));
        continue;
      }

      // Judged on what the sub agent returned to us. `reviewDeliverable`
      // drops anything it cannot parse, so an unparseable summary surfaces as
      // `unreviewed`, which blocks — the safe direction.
      const verdict = opts.secure.judge(planned.role, planned.goal, worker.summary);

      byId.set(sub.id, {
        ...worker,
        role: planned.role,
        status: worker.status,
        bylawVerdict: verdict,
        dependsOn: planned.dependsOn,
      });
    }
  }

  // Report in plan order — stable, and every planned subtask appears once.
  const subtasks = plan.subtasks.map(
    (p) => byId.get(p.id) ?? emptySubtaskReport(p.id, p.role, p.dependsOn, "not dispatched"),
  );

  return {
    subtasks,
    totals: {
      subtasks: subtasks.length,
      done: subtasks.filter((s) => s.status === "done").length,
      failed: subtasks.filter((s) => s.status === "failed").length,
      skipped: subtasks.filter((s) => s.status === "skipped").length,
      totalAttempts: subtasks.reduce((n, s) => n + s.attempts, 0),
      inputTokens: subtasks.reduce((n, s) => n + s.tokenUsage.inputTokens, 0),
      outputTokens: subtasks.reduce((n, s) => n + s.tokenUsage.outputTokens, 0),
      durationMs: Date.now() - startedAt,
    },
  };
}
