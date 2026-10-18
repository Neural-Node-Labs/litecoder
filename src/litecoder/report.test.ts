// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:37:50.289Z | xcoder:subtask code-st-9de79a
import { describe, it, expect } from "vitest";
import { deriveStatus, exitCodeFor, summariseBylawVerdicts, type BylawSummary } from "./report.js";
import type { Plan } from "./plan-schema.js";
import type { LitecoderSubtaskStatus } from "./dispatcher.js";

const plan = {
  rationale: "r",
  subtasks: [{ id: "a", goal: "g", role: "programmer", dependsOn: [] }],
} as unknown as Plan;

const subs = (...statuses: LitecoderSubtaskStatus[]) => statuses.map((status) => ({ status }));

const blocked: BylawSummary = {
  approved: false,
  blocking: ["CORE-01"],
  unreviewed: [],
  invalid: [],
};
const approved: BylawSummary = { approved: true, blocking: [], unreviewed: [], invalid: [] };

describe("deriveStatus — the single status rule", () => {
  it("failed when planning produced no plan", () => {
    expect(deriveStatus({ plan: null, subtasks: [], bylaw: null })).toBe("failed");
  });

  it("completed when every subtask is done", () => {
    expect(deriveStatus({ plan, subtasks: subs("done", "done"), bylaw: null })).toBe("completed");
  });

  it("partial when some succeeded and some did not", () => {
    expect(deriveStatus({ plan, subtasks: subs("done", "failed"), bylaw: null })).toBe("partial");
    expect(deriveStatus({ plan, subtasks: subs("done", "skipped"), bylaw: null })).toBe("partial");
  });

  it("failed when nothing succeeded", () => {
    expect(deriveStatus({ plan, subtasks: subs("failed", "skipped"), bylaw: null })).toBe("failed");
  });

  it("downgrades completed to partial when --secure did not approve (AC10)", () => {
    expect(deriveStatus({ plan, subtasks: subs("done"), bylaw: blocked })).toBe("partial");
    expect(deriveStatus({ plan, subtasks: subs("done"), bylaw: approved })).toBe("completed");
  });

  it("cannot influence status when --secure is off, because bylaw is null (AC11)", () => {
    expect(deriveStatus({ plan, subtasks: subs("done"), bylaw: null })).toBe("completed");
  });

  it("maps status to the CLI exit-code convention", () => {
    expect(exitCodeFor("completed")).toBe(0);
    expect(exitCodeFor("partial")).toBe(1);
    expect(exitCodeFor("failed")).toBe(1);
  });
});

describe("summariseBylawVerdicts", () => {
  it("is null when nothing was judged — the --secure off case", () => {
    expect(summariseBylawVerdicts([{ bylawVerdict: null }])).toBeNull();
    expect(summariseBylawVerdicts([])).toBeNull();
  });

  it("is unapproved if any verdict is unapproved", () => {
    const summary = summariseBylawVerdicts([
      { bylawVerdict: { approved: true, blocking: [], unreviewed: [], invalid: [], layers: [], findings: [] } },
      { bylawVerdict: { approved: false, blocking: ["X"], unreviewed: ["Y"], invalid: [], layers: [], findings: [] } },
    ]);
    expect(summary).not.toBeNull();
    expect(summary!.approved).toBe(false);
    expect(summary!.blocking).toEqual(["X"]);
    expect(summary!.unreviewed).toEqual(["Y"]);
  });
});
