// xcoder:version 4 | xcoder:task task-c4a64f | xcoder:updated 2026-10-17T02:33:03.494Z | xcoder:subtask test-st-3a3927
// Tests for the generic worker orchestrator: retry policy, concurrency bound,
// crash isolation, report ordering and JSON round-trip safety.
//
// The swarm engine is injected through `WorkerOrchestratorOptions.dispatch`,
// so nothing here touches the network or a real Sub Agent.
import { describe, it, expect } from "vitest";
import {
  WorkerOrchestrator,
  isFailure,
  type WorkerSubtask,
} from "./worker-orchestrator.js";
import { toSubtaskNode } from "./to-subtask-node.js";
import type { SwarmDispatchResult, dispatchSwarm } from "../orchestrator/swarm.js";
import type { LlmClient } from "../llm/client.js";
import type { SubtaskNode, SubtaskResult } from "../types.js";

type DispatchFn = typeof dispatchSwarm;

function ok(summary = "ok"): SubtaskResult {
  return {
    summary,
    deliverable: null,
    filesTouched: ["src/a.ts"],
    raoTrace: [],
    tokenUsage: { inputTokens: 10, outputTokens: 5 },
    iterations: 1,
  };
}

function crashed(summary = "boom"): SubtaskResult {
  return { ...ok(summary), crashed: true };
}

/** Builds a fake engine that answers per subtask id, recording what it saw. */
function fakeDispatch(
  answer: (node: SubtaskNode, call: number) => SubtaskResult,
): { fn: DispatchFn; seen: SubtaskNode[][]; calls: Map<string, number> } {
  const seen: SubtaskNode[][] = [];
  const calls = new Map<string, number>();
  const fn = (async (nodes: SubtaskNode[]) => {
    seen.push(nodes);
    return nodes.map((node) => {
      const n = (calls.get(node.id) ?? 0) + 1;
      calls.set(node.id, n);
      return { subtaskId: node.id, result: answer(node, n) };
    });
  }) as unknown as DispatchFn;
  return { fn, seen, calls };
}

const llm = {} as LlmClient;

function make(subtasks: WorkerSubtask[], dispatch: DispatchFn, maxAttempts = 2) {
  return new WorkerOrchestrator({ workspaceRoot: "/tmp/ws", llm, dispatch, quiet: true }).run({
    taskDescription: "test task",
    subtasks,
    concurrency: 2,
    maxAttempts,
    taskId: "t1",
  });
}

function ids(list: WorkerSubtask[]): WorkerSubtask[] {
  return list.map((s, i) => ({ id: `st-${i + 1}`, goal: s.goal }));
}

describe("isFailure", () => {
  it("is true only for crashes and exhausted iteration budgets", () => {
    expect(isFailure(ok())).toBe(false);
    expect(isFailure(crashed())).toBe(true);
    expect(isFailure({ ...ok(), iterationsExhausted: true })).toBe(true);
  });
});

describe("toSubtaskNode", () => {
  const ctx = { taskId: "t1", attempt: 2, maxAttempts: 3, priorErrors: ["earlier failure"] };

  it("hard-codes the only implemented engine", () => {
    const node = toSubtaskNode({ id: "a", goal: "do a" }, ctx);
    expect(node.engine).toBe("react-v1");
    expect(node.status).toBe("ready");
    expect(node.dependsOn).toEqual([]);
    expect(node.acceptanceCriteria).toEqual([]);
    expect(node.deliverableSpec).toBe("do a");
    expect(node.healing).toEqual({ attempts: 1, maxAttempts: 3, log: ["earlier failure"] });
  });

  it("defaults role to programmer and honours a caller-supplied one", () => {
    expect(toSubtaskNode({ id: "a", goal: "g" }, ctx).role).toBe("programmer");
    expect(toSubtaskNode({ id: "a", goal: "g", role: "tester" }, ctx).role).toBe("tester");
  });
});

describe("WorkerOrchestrator.run", () => {
  it("forwards the concurrency bound to the engine and never overlaps waves", async () => {
    const subtasks = ids(Array.from({ length: 5 }, () => ({ id: "", goal: "work" })));
    const bounds: number[] = [];
    let active = 0;
    let overlapped = false;

    // Emulate the pool dispatchSwarm runs, so the observed peak reflects the
    // bound this layer forwards rather than how many nodes a wave contains.
    const fn = (async (nodes: SubtaskNode[], opts: { concurrency: number }) => {
      bounds.push(opts.concurrency);
      if (active > 0) overlapped = true;
      const queue = [...nodes];
      const results: SwarmDispatchResult[] = [];
      const runOne = async (): Promise<void> => {
        while (queue.length) {
          const node = queue.shift();
          if (!node) return;
          active += 1;
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
          results.push({ subtaskId: node.id, result: ok() });
        }
      };
      await Promise.all(Array.from({ length: Math.min(opts.concurrency, nodes.length) }, runOne));
      return results;
    }) as unknown as DispatchFn;

    const report = await make(subtasks, fn);

    expect(report.status).toBe("completed");
    // A single wave, bounded by the requested concurrency of 2.
    expect(bounds).toEqual([2]);
    expect(overlapped).toBe(false);
  });

  it("isolates a crashed subtask without failing the run", async () => {
    const subtasks = ids(Array.from({ length: 5 }, () => ({ id: "", goal: "work" })));
    const { fn } = fakeDispatch((node) => (node.id === "st-3" ? crashed("kaboom") : ok()));

    const report = await make(subtasks, fn);

    expect(report.status).toBe("partial");
    expect(report.subtasks.find((s) => s.id === "st-3")?.status).toBe("failed");
    expect(report.subtasks.filter((s) => s.status === "done")).toHaveLength(4);
  });

  it("resolves even when the engine throws outright", async () => {
    const subtasks = ids([{ id: "", goal: "a" }, { id: "", goal: "b" }]);
    const fn = (async () => {
      throw new Error("engine exploded");
    }) as unknown as DispatchFn;

    const report = await make(subtasks, fn);

    expect(report.status).toBe("failed");
    expect(report.subtasks).toHaveLength(2);
    expect(report.subtasks.every((s) => s.status === "failed")).toBe(true);
    expect(report.errors.join(" ")).toContain("engine exploded");
  });

  it("stops at maxAttempts and reports the whole history", async () => {
    const { fn } = fakeDispatch(() => crashed("still broken"));

    const report = await make(ids([{ id: "", goal: "a" }]), fn, 3);

    const sub = report.subtasks[0];
    expect(sub.status).toBe("failed");
    expect(sub.attempts).toBe(3);
    expect(sub.history).toHaveLength(3);
    expect(sub.history.map((h) => h.ok)).toEqual([false, false, false]);
  });

  it("retries once and then succeeds", async () => {
    const { fn, calls } = fakeDispatch((_node, n) => (n === 1 ? crashed("first try failed") : ok("recovered")));

    const report = await make(ids([{ id: "", goal: "a" }]), fn, 2);

    const sub = report.subtasks[0];
    expect(sub.status).toBe("done");
    expect(sub.attempts).toBe(2);
    expect(sub.history.map((h) => h.ok)).toEqual([false, true]);
    expect(sub.error).toBeNull();
    expect(sub.summary).toBe("recovered");
    expect(calls.get("st-1")).toBe(2);
  });

  it("keeps request order, not completion order", async () => {
    const subtasks: WorkerSubtask[] = [
      { id: "slow", goal: "slow one" },
      { id: "fast", goal: "fast one" },
      { id: "mid", goal: "middle one" },
    ];
    const { fn } = fakeDispatch(() => ok());

    const report = await make(subtasks, fn);

    expect(report.subtasks.map((s) => s.id)).toEqual(["slow", "fast", "mid"]);
  });

  it("produces a report that survives a JSON round trip", async () => {
    const { fn } = fakeDispatch((node) => (node.id === "st-2" ? crashed() : ok()));

    const report = await make(ids([{ id: "", goal: "a" }, { id: "", goal: "b" }]), fn);

    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("derives completed / partial / failed, treating an empty request as completed", async () => {
    const allOk = fakeDispatch(() => ok());
    expect((await make(ids([{ id: "", goal: "a" }]), allOk.fn)).status).toBe("completed");

    const mixed = fakeDispatch((node) => (node.id === "st-1" ? crashed() : ok()));
    expect((await make(ids([{ id: "", goal: "a" }, { id: "", goal: "b" }]), mixed.fn)).status).toBe("partial");

    const allBad = fakeDispatch(() => crashed());
    expect((await make(ids([{ id: "", goal: "a" }]), allBad.fn)).status).toBe("failed");

    const empty = fakeDispatch(() => ok());
    const report = await make([], empty.fn);
    expect(report.status).toBe("completed");
    expect(report.totals.subtasks).toBe(0);
  });

  it("sums token usage and attempt counts into totals", async () => {
    const { fn } = fakeDispatch(() => ok());

    const report = await make(ids([{ id: "", goal: "a" }, { id: "", goal: "b" }]), fn);

    expect(report.totals.done).toBe(2);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.totalAttempts).toBe(2);
    expect(report.totals.inputTokens).toBe(20);
    expect(report.totals.outputTokens).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Edge cases and defensive behaviour
//
// These pin the guarantees stated in the module docs: dedupe (dispatchSwarm
// keys results by id, so a duplicate would mis-map), never-absent reports
// (abort / no-result), clamped numerics, and the retry context that gets
// carried into the next attempt.
// ---------------------------------------------------------------------------
describe("WorkerOrchestrator.run — edge cases", () => {
  it("skips duplicate ids and records why, keeping one report per unique id", async () => {
    const { fn } = fakeDispatch(() => ok());
    const subtasks: WorkerSubtask[] = [
      { id: "dup", goal: "first" },
      { id: "dup", goal: "second" },
      { id: "other", goal: "third" },
    ];

    const report = await make(subtasks, fn);

    expect(report.subtasks.map((s) => s.id)).toEqual(["dup", "other"]);
    expect(report.errors.join(" ")).toContain("duplicate subtask id 'dup'");
    expect(report.status).toBe("completed");
  });

  it("skips a subtask with no id and reports it instead of dispatching garbage", async () => {
    const { fn, seen } = fakeDispatch(() => ok());
    const subtasks = [{ id: "", goal: "orphan" }, { id: "keep", goal: "real" }] as WorkerSubtask[];

    const report = await make(subtasks, fn);

    expect(report.subtasks.map((s) => s.id)).toEqual(["keep"]);
    expect(report.errors.join(" ")).toContain("no id");
    // The orphan never reached the engine.
    expect(seen.flat().map((n) => n.id)).not.toContain("");
  });

  it("survives a non-array subtasks field without throwing", async () => {
    const { fn, seen } = fakeDispatch(() => ok());
    const orch = new WorkerOrchestrator({ workspaceRoot: "/tmp/ws", llm, dispatch: fn, quiet: true });

    const report = await orch.run({ taskDescription: "t", subtasks: null as unknown as WorkerSubtask[] });

    expect(report.subtasks).toEqual([]);
    expect(report.errors.join(" ")).toContain("must be an array");
    expect(seen).toHaveLength(0);
  });

  it("clamps concurrency and maxAttempts up to at least 1", async () => {
    const bounds: number[] = [];
    const fn = (async (nodes: SubtaskNode[], opts: { concurrency: number }) => {
      bounds.push(opts.concurrency);
      return nodes.map((n) => ({ subtaskId: n.id, result: crashed("nope") }));
    }) as unknown as DispatchFn;

    const orch = new WorkerOrchestrator({ workspaceRoot: "/tmp/ws", llm, dispatch: fn, quiet: true });
    const report = await orch.run({
      taskDescription: "t",
      subtasks: [{ id: "a", goal: "g" }],
      concurrency: 0,
      maxAttempts: -3,
      taskId: "t-clamp",
    });

    expect(bounds).toEqual([1]);
    // maxAttempts clamped to 1 ⇒ exactly one attempt, no retry.
    expect(report.subtasks[0].attempts).toBe(1);
  });

  it("treats a missing result as an attempt failure and retries it", async () => {
    let call = 0;
    const fn = (async (nodes: SubtaskNode[]) => {
      call += 1;
      // First wave silently omits the result; second wave answers.
      if (call === 1) return [];
      return nodes.map((n) => ({ subtaskId: n.id, result: ok("second wave") }));
    }) as unknown as DispatchFn;

    const report = await make([{ id: "a", goal: "g" }], fn, 2);

    const sub = report.subtasks[0];
    expect(sub.status).toBe("done");
    expect(sub.attempts).toBe(2);
    expect(sub.history[0].ok).toBe(false);
    expect(sub.history[0].error).toContain("no result returned");
  });

  it("carries prior attempt errors into the next attempt's healing context", async () => {
    const logs: string[][] = [];
    const attemptsSeen: number[] = [];
    const fn = (async (nodes: SubtaskNode[], _opts: unknown) => {
      for (const n of nodes) {
        logs.push(n.healing.log);
        attemptsSeen.push(n.healing.attempts);
      }
      return nodes.map((n) => (n.healing.attempts === 0 ? { subtaskId: n.id, result: crashed("first") } : { subtaskId: n.id, result: ok() }));
    }) as unknown as DispatchFn;

    const report = await make([{ id: "a", goal: "g" }], fn, 2);

    expect(report.subtasks[0].status).toBe("done");
    expect(logs).toEqual([[], ["first"]]);
    expect(attemptsSeen).toEqual([0, 1]);
  });

  it("finalises un-run subtasks as failed when the signal aborts, never omitting them", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fn, seen } = fakeDispatch(() => ok());

    const report = await new WorkerOrchestrator({ workspaceRoot: "/tmp/ws", llm, dispatch: fn, quiet: true }).run({
      taskDescription: "t",
      subtasks: [
        { id: "a", goal: "g" },
        { id: "b", goal: "g" },
      ],
      taskId: "t-abort",
      signal: controller.signal,
    });

    expect(seen).toHaveLength(0);
    expect(report.subtasks).toHaveLength(2);
    expect(report.status).toBe("failed");
    for (const sub of report.subtasks) {
      expect(sub.status).toBe("failed");
      expect(sub.error).toContain("aborted");
      expect(sub.attempts).toBe(1);
    }
  });

  it("synthesises a taskId when none is supplied", async () => {
    const { fn } = fakeDispatch(() => ok());

    const report = await new WorkerOrchestrator({ workspaceRoot: "/tmp/ws", llm, dispatch: fn, quiet: true }).run({
      taskDescription: "t",
      subtasks: [{ id: "a", goal: "g" }],
    });

    expect(report.taskId).toMatch(/^worker-\d+$/);
  });

  it("records iterationsExhausted as a failure, not a success", async () => {
    // An empty summary is what makes `errOf` fall through to the
    // exhaustion-specific message rather than echoing the summary.
    const { fn } = fakeDispatch(() => ({ ...ok(""), iterationsExhausted: true }));

    const report = await make([{ id: "a", goal: "g" }], fn, 1);

    expect(report.subtasks[0].status).toBe("failed");
    expect(report.subtasks[0].error).toContain("iteration budget");
    // Not a crash: the flag is reported as-is, not coerced.
    expect(report.subtasks[0].crashed).toBe(false);
  });
});
