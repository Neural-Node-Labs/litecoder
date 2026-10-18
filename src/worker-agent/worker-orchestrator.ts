// xcoder:version 1 | xcoder:task task-c4a64f | xcoder:updated 2026-10-17T02:20:47.001Z | xcoder:subtask code-st-348a21
// Generic worker orchestrator — non-SDLC task delegation.
//
// Deliberately NOT a copy of `sdlc-orchestrator.ts`: there is no TaskSpec,
// no WBS DAG, no escalations, no orchestrator trace, and no `SdlcStage` in
// the public input. Concurrency and crash isolation are delegated to the
// existing `dispatchSwarm`; the only logic here is the retry policy and
// report assembly.
import { dispatchSwarm, type SwarmDispatchResult } from "../orchestrator/swarm.js";
import type { LlmClient } from "../llm/client.js";
import type { Role, SubtaskResult, TokenUsage } from "../types.js";
import { toSubtaskNode } from "./to-subtask-node.js";

// ---------------------------------------------------------------------------
// Public input
// ---------------------------------------------------------------------------

/**
 * One unit of work. There is intentionally no `stage`, `engine`,
 * `dependsOn`, `acceptanceCriteria` or `healing` field — an `SdlcStage`
 * cannot be supplied to this path by construction.
 */
export interface WorkerSubtask {
  /** Stable id, echoed in the report. Unique within a request. */
  id: string;
  /** Self-contained work order. */
  goal: string;
  /** Owning role. Optional: defaults to "programmer". Prompt routing only. */
  role?: Role;
  /** Inlined upstream context, as in `SubtaskNode`. */
  upstreamContext?: Record<string, unknown>;
  /** Optional; defaults to `goal`. */
  deliverableSpec?: string;
}

export interface WorkerRunRequest {
  taskDescription: string;
  /** Ordered; request order is preserved in the report, execution is concurrent. */
  subtasks: WorkerSubtask[];
  /** Default 3. Clamped to >= 1. */
  concurrency?: number;
  /** Total attempts per subtask (not retries). Default 2. Clamped to >= 1. */
  maxAttempts?: number;
  /** Optional run id; otherwise `worker-<timestamp>`. */
  taskId?: string;
  /** Stops *new* waves. In-flight agents finish (no real-time cancellation). */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Public output — flat, JSON round-trip safe
// ---------------------------------------------------------------------------

export type WorkerSubtaskStatus = "done" | "failed";

export interface WorkerAttemptRecord {
  /** 1-based. */
  attempt: number;
  ok: boolean;
  error: string | null;
}

export interface WorkerSubtaskReport {
  id: string;
  status: WorkerSubtaskStatus;
  /** Always >= 1; equals `history.length`. */
  attempts: number;
  summary: string;
  /** Last failure message; `null` when the subtask is done. */
  error: string | null;
  filesTouched: string[];
  tokenUsage: TokenUsage;
  iterations: number;
  crashed: boolean;
  /** One entry per attempt, in order — this is what makes retries assertable. */
  history: WorkerAttemptRecord[];
}

export type WorkerRunStatus = "completed" | "partial" | "failed";

export interface WorkerRunReport {
  taskId: string;
  taskDescription: string;
  status: WorkerRunStatus;
  /** Request order, always one entry per requested subtask. */
  subtasks: WorkerSubtaskReport[];
  totals: {
    subtasks: number;
    done: number;
    failed: number;
    totalAttempts: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
  /** Run-level problems (adapter/validation), never raw agent stacks. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface WorkerOrchestratorOptions {
  workspaceRoot: string;
  llm: LlmClient;
  /** Swarm worker client; defaults to `llm`. */
  subAgentLlm?: LlmClient;
  quiet?: boolean;
  /** Injection seam for tests — defaults to the real `dispatchSwarm`. */
  dispatch?: typeof dispatchSwarm;
}

/**
 * The single place "what counts as a failed attempt" is decided. Centralising
 * it keeps the retry loop unchanged if the policy is ever revisited, and lets
 * tests assert the predicate directly.
 */
export function isFailure(result: SubtaskResult): boolean {
  return result.crashed === true || result.iterationsExhausted === true;
}

function emptyResult(error: string): SubtaskResult {
  return {
    summary: error,
    deliverable: null,
    filesTouched: [],
    raoTrace: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    iterations: 0,
    crashed: true,
  };
}

function errOf(result: SubtaskResult): string {
  const summary = (result.summary ?? "").trim();
  if (summary) return summary;
  if (result.crashed) return "subtask crashed";
  if (result.iterationsExhausted) return "subtask exhausted its iteration budget";
  return "subtask failed";
}

export class WorkerOrchestrator {
  private readonly workspaceRoot: string;
  private readonly llm: LlmClient;
  private readonly subAgentLlm?: LlmClient;
  private readonly quiet: boolean;
  private readonly dispatch: typeof dispatchSwarm;

  constructor(opts: WorkerOrchestratorOptions) {
    this.workspaceRoot = opts.workspaceRoot;
    this.llm = opts.llm;
    this.subAgentLlm = opts.subAgentLlm;
    this.quiet = opts.quiet ?? false;
    this.dispatch = opts.dispatch ?? dispatchSwarm;
  }

  /**
   * Runs every subtask, retrying failures in bounded waves.
   *
   * NEVER rejects — for any input, and for any failure of any worker agent.
   * Unusable input surfaces as a `failed` report with run-level `errors`.
   */
  async run(request: WorkerRunRequest): Promise<WorkerRunReport> {
    const startedAt = Date.now();
    const taskId = (request?.taskId ?? "").trim() || `worker-${startedAt}`;
    const taskDescription = request?.taskDescription ?? "";
    const errors: string[] = [];

    const requested = Array.isArray(request?.subtasks) ? request.subtasks : [];
    if (!Array.isArray(request?.subtasks)) {
      errors.push("request.subtasks must be an array; nothing was dispatched");
    }

    const concurrency = Math.max(1, Math.floor(request?.concurrency ?? 3) || 1);
    const maxAttempts = Math.max(1, Math.floor(request?.maxAttempts ?? 2) || 1);
    const signal = request?.signal;

    // De-duplicate by id defensively: dispatchSwarm keys results by subtask id,
    // so a duplicate would silently mis-map results.
    const seen = new Set<string>();
    const subtasks: WorkerSubtask[] = [];
    for (const sub of requested) {
      const id = (sub?.id ?? "").trim();
      if (!id) {
        errors.push(`skipped a subtask with no id (goal: ${(sub?.goal ?? "").slice(0, 80)})`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`skipped duplicate subtask id '${id}'`);
        continue;
      }
      seen.add(id);
      subtasks.push(sub);
    }

    const history = new Map<string, WorkerAttemptRecord[]>();
    const finals = new Map<string, { result: SubtaskResult; error: string | null }>();
    for (const sub of subtasks) history.set(sub.id, []);

    let pending = [...subtasks];
    let attempt = 1;

    while (pending.length > 0 && attempt <= maxAttempts && !signal?.aborted) {
      const priorErrorsOf = (id: string): string[] =>
        (history.get(id) ?? [])
          .map((h) => h.error)
          .filter((e): e is string => typeof e === "string" && e.length > 0);

      const nodes = pending.map((sub) =>
        toSubtaskNode(sub, {
          taskId,
          attempt,
          maxAttempts,
          priorErrors: priorErrorsOf(sub.id),
        }),
      );

      let dispatched: SwarmDispatchResult[] = [];
      try {
        dispatched = await this.dispatch(nodes, {
          taskId,
          workspaceRoot: this.workspaceRoot,
          llm: this.llm,
          subAgentLlm: this.subAgentLlm,
          concurrency,
          signal,
          quiet: this.quiet,
        });
      } catch (e) {
        // `dispatchSwarm` is contractually non-throwing; reaching here means
        // something structural broke. Attribute it to every subtask in the
        // wave rather than losing the run.
        const message = (e as Error)?.message ?? String(e);
        errors.push(`dispatch failed on attempt ${attempt}: ${message}`);
        dispatched = [];
      }

      const byId = new Map<string, SubtaskResult>();
      for (const out of dispatched ?? []) {
        if (out && typeof out.subtaskId === "string" && out.result) {
          byId.set(out.subtaskId, out.result);
        }
      }

      const retry: WorkerSubtask[] = [];
      for (const sub of pending) {
        const result = byId.get(sub.id) ?? emptyResult("no result returned for this subtask");
        const failed = isFailure(result);
        const rec: WorkerAttemptRecord = {
          attempt,
          ok: !failed,
          error: failed ? errOf(result) : null,
        };
        history.get(sub.id)?.push(rec);

        if (failed && attempt < maxAttempts) {
          retry.push(sub);
        } else {
          finals.set(sub.id, { result, error: failed ? rec.error : null });
        }
      }

      pending = retry;
      attempt += 1;
    }

    // Anything still pending after the loop ended (abort, or an attempt wave
    // that produced no result) is finalised as failed — never left absent.
    for (const sub of pending) {
      const reason = signal?.aborted ? "aborted before dispatch" : "attempts exhausted without a result";
      const recs = history.get(sub.id) ?? [];
      recs.push({ attempt: recs.length + 1, ok: false, error: reason });
      history.set(sub.id, recs);
      finals.set(sub.id, { result: emptyResult(reason), error: reason });
    }

    const reports: WorkerSubtaskReport[] = subtasks.map((sub) => {
      const recs = history.get(sub.id) ?? [];
      const final = finals.get(sub.id);
      const result = final?.result ?? emptyResult("subtask was never dispatched");
      const failed = final ? final.error !== null : true;
      const hist = recs.length > 0 ? recs.map((r) => ({ ...r })) : [{ attempt: 1, ok: false, error: "not dispatched" }];
      return {
        id: sub.id,
        status: failed ? "failed" : "done",
        attempts: hist.length,
        summary: result.summary ?? "",
        error: failed ? (final?.error ?? "subtask was never dispatched") : null,
        filesTouched: Array.isArray(result.filesTouched) ? [...result.filesTouched] : [],
        tokenUsage: {
          inputTokens: result.tokenUsage?.inputTokens ?? 0,
          outputTokens: result.tokenUsage?.outputTokens ?? 0,
        },
        iterations: result.iterations ?? 0,
        crashed: result.crashed === true,
        history: hist,
      };
    });

    const done = reports.filter((r) => r.status === "done").length;
    const failedCount = reports.length - done;
    const status: WorkerRunStatus =
      reports.length === 0 || failedCount === 0 ? "completed" : done === 0 ? "failed" : "partial";

    return {
      taskId,
      taskDescription,
      status,
      subtasks: reports,
      totals: {
        subtasks: reports.length,
        done,
        failed: failedCount,
        totalAttempts: reports.reduce((sum, r) => sum + r.attempts, 0),
        inputTokens: reports.reduce((sum, r) => sum + r.tokenUsage.inputTokens, 0),
        outputTokens: reports.reduce((sum, r) => sum + r.tokenUsage.outputTokens, 0),
        durationMs: Date.now() - startedAt,
      },
      errors,
    };
  }
}
