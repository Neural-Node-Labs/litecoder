// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:37:22.528Z | xcoder:subtask code-st-9de79a
import { describe, it, expect } from "vitest";
import {
  MAX_SUBTASKS_HARD_CAP,
  PlanSchema,
  PlannedSubtaskSchema,
  parsePlan,
} from "./plan-schema.js";

const valid = {
  rationale: "split the work",
  subtasks: [
    { id: "a", goal: "do a", role: "programmer", dependsOn: [] },
    { id: "b", goal: "do b", role: "tester", dependsOn: ["a"] },
  ],
};

describe("PlanSchema — the model-output trust boundary", () => {
  it("accepts a well-formed plan", () => {
    expect(PlanSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown keys instead of silently dropping them", () => {
    expect(PlanSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
    expect(
      PlanSchema.safeParse({
        rationale: "r",
        subtasks: [{ id: "a", goal: "g", role: "programmer", tool: "write_file" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a role outside the enum", () => {
    expect(
      PlanSchema.safeParse({ rationale: "r", subtasks: [{ id: "a", goal: "g", role: "hacker" }] })
        .success,
    ).toBe(false);
  });

  it("rejects ids outside [a-zA-Z0-9_-]", () => {
    expect(
      PlannedSubtaskSchema.safeParse({ id: "a/../b", goal: "g", role: "programmer" }).success,
    ).toBe(false);
  });

  it("rejects duplicate ids", () => {
    expect(
      PlanSchema.safeParse({
        rationale: "r",
        subtasks: [
          { id: "a", goal: "one", role: "programmer" },
          { id: "a", goal: "two", role: "programmer" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a self-referencing dependency", () => {
    expect(
      PlanSchema.safeParse({
        rationale: "r",
        subtasks: [{ id: "a", goal: "g", role: "programmer", dependsOn: ["a"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects a dependency on an unknown id", () => {
    expect(
      PlanSchema.safeParse({
        rationale: "r",
        subtasks: [{ id: "a", goal: "g", role: "programmer", dependsOn: ["nope"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects a dependency cycle", () => {
    const result = PlanSchema.safeParse({
      rationale: "r",
      subtasks: [
        { id: "a", goal: "g", role: "programmer", dependsOn: ["b"] },
        { id: "b", goal: "g", role: "programmer", dependsOn: ["a"] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /cycle/.test(i.message))).toBe(true);
    }
  });

  it("rejects an empty plan and a plan over the hard cap", () => {
    expect(PlanSchema.safeParse({ rationale: "r", subtasks: [] }).success).toBe(false);
    expect(
      PlanSchema.safeParse({
        rationale: "r",
        subtasks: Array.from({ length: MAX_SUBTASKS_HARD_CAP + 1 }, (_, i) => ({
          id: `s${i}`,
          goal: "g",
          role: "programmer",
        })),
      }).success,
    ).toBe(false);
  });

  it("parsePlan returns readable issues rather than throwing", () => {
    const outcome = parsePlan("not a plan");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.length).toBeGreaterThan(0);
  });
});
