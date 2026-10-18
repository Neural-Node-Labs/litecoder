// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:37:58.578Z | xcoder:subtask code-st-9de79a
import { describe, it, expect } from "vitest";
import {
  dispatchPlan,
  type DispatchEngine,
} from "./dispatcher.js";
import { createSecureGate } from "./secure-gate.js";
import type { Plan } from "./plan-schema.js";
import type { LlmClient } from "../llm/client.js";
import type {
  WorkerRunReport,
  WorkerSubtask,
  WorkerSubtaskReport,
} from "../worker-agent/worker-orchestrator.js";

function subReport(id: string, failed = false, crashed = false): WorkerSubtaskReport {
  return {
    id,
    status: failed ? "failed" : "done",
    attempts: 1,
    summary: failed ? "" : `${id} finished`,
    error: failed ? "boom" : null,
    filesTouched: failed ? [] : [`src/${id}.ts`],
    tokenUsage: { inputTokens: 1, outputTokens: 1 },
    iterations: 1,
    crashed,
    history: [{ attempt: 1, ok: !failed, error: failed ? "boom" : null }],
  };
}

/** Records each wave, and reports per-id outcomes from the supplied map. */
function scriptedEngine(
  outcomes: Record<string, "done" | "failed" | "crash"> = {},
): { engine: DispatchEngine; waves: WorkerSubtask[][] } {
  const waves: WorkerSubtask[][] = [];
  const engine: DispatchEngine = {
    async run(request): Promise<WorkerRunReport> {
      waves.push(request.subtasks);
      const reports = request.subtasks.map((s) => {
        const outcome = outcomes[s.id] ?? "done";
        if (outcome === "done") return subReport(s.id);
        return subReport(s.id, true, outcome === "crash");
      });
      const done = reports.filter((r) => r.status === "done").length;
      return {
        taskId: "t",
        taskDescription: "d",
        status: done === reports.length ? "completed" : done === 0 ? "failed" : "partial",
        subtasks: reports,
        totals: {
          subtasks: reports.length,
          done,
          failed: reports.length - done,
          totalAttempts: reports.length,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
        },
        errors: [],
      };
    },
  };
  return { engine, waves };
}

function planOf(
  subtasks: Array<{ id: string; role?: string; dependsOn?: string[] }>,
): Plan {
  return {
    rationale: "r",
    subtasks: subtasks.map((s) => ({
      id: s.id,
      goal: `do ${s.id}`,
      role: (s.role ?? "programmer") as Plan["subtasks"][number]["role"],
      dependsOn: s.dependsOn ?? [],
    })),
  };
}

const fakeLlm = {} as LlmClient;

const baseOpts = {
  workspaceRoot: ".",
  llm: fakeLlm,
  concurrency: 3,
  maxAttempts: 1,
  secure: createSecureGate("off"),
};

describe("dispatchPlan", () => {
  it("executes in topological waves, honouring dependsOn", async () => {
    const { engine, waves } = scriptedEngine();
    const outcome = await dispatchPlan(
      planOf([{ id: "b", dependsOn: ["a"] }, { id: "a" }]),
      baseOpts,
      engine,
    );

    expect(waves).toHaveLength(2);
    expect(waves[0].map((s) => s.id)).toEqual(["a"]);
    expect(waves[1].map((s) => s.id)).toEqual(["b"]);
    expect(outcome.totals.done).toBe(2);
    expect(outcome.totals.skipped).toBe(0);
  });

  it("reports a dependent of a failed subtask as skipped, never dispatched", async () => {
    const { engine, waves } = scriptedEngine({ a: "failed" });
    const outcome = await dispatchPlan(
      planOf([{ id: "a" }, { id: "b", dependsOn: ["a"] }]),
      baseOpts,
      engine,
    );

    expect(waves).toHaveLength(1);
    const b = outcome.subtasks.find((s) => s.id === "b")!;
    expect(b.status).toBe("skipped");
    expect(b.attempts).toBe(0);
    expect(b.error).toMatch(/dependency did not complete/);
    expect(outcome.totals).toMatchObject({ done: 0, failed: 1, skipped: 1 });
  });

  it("isolates a crashing subtask and still completes the run (AC7)", async () => {
    const { engine } = scriptedEngine({ a: "crash" });
    const outcome = await dispatchPlan(planOf([{ id: "a" }, { id: "b" }]), baseOpts, engine);

    const a = outcome.subtasks.find((s) => s.id === "a")!;
    expect(a.status).toBe("failed");
    expect(a.crashed).toBe(true);
    expect(outcome.subtasks.find((s) => s.id === "b")!.status).toBe("done");
    // The dispatcher itself never throws, so the caller still gets a report.
    expect(outcome.totals.subtasks).toBe(2);
  });

  it("reports every planned subtask exactly once, in plan order", async () => {
    const { engine } = scriptedEngine();
    const outcome = await dispatchPlan(
      planOf([{ id: "c" }, { id: "a" }, { id: "b" }]),
      baseOpts,
      engine,
    );
    expect(outcome.subtasks.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("is always null-verdict when --secure is off (AC11)", async () => {
    const { engine } = scriptedEngine();
    const outcome = await dispatchPlan(
      planOf([{ id: "a", role: "architect" }]),
      baseOpts,
      engine,
    );
    expect(outcome.subtasks[0].bylawVerdict).toBeNull();
  });

  it("injects the bylaw block via upstreamContext and judges the result when enforcing", async () => {
    const { engine, waves } = scriptedEngine();
    const outcome = await dispatchPlan(
      planOf([{ id: "a", role: "architect" }]),
      { ...baseOpts, secure: createSecureGate("enforce") },
      engine,
    );

    expect(String(waves[0][0].upstreamContext?.bylawContext)).toMatch(/Security bylaws/);
    expect(outcome.subtasks[0].bylawVerdict).not.toBeNull();
    // An unparseable/empty deliverable leaves the bylaws unreviewed, which blocks.
    expect(outcome.subtasks[0].bylawVerdict!.approved).toBe(false);
  });
});
