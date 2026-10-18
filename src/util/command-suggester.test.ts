// xcoder:version 2 | xcoder:task task-c776f2 | xcoder:updated 2026-08-03T19:36:43.355Z | xcoder:subtask code-st-5c254e
import { describe, it, expect } from "vitest";
import { suggestCommands } from "./command-suggester.js";

describe("suggestCommands", () => {
  const known = ["index", "status", "backlog", "sprint", "bench", "help"];

  it("suggests 'status' for typo 'staatus' (distance 1)", () => {
    const result = suggestCommands("staatus", known);
    expect(result).toEqual(["status"]);
  });

  it("suggests 'status' for typo 'stats' (distance 2)", () => {
    const result = suggestCommands("stats", known);
    expect(result).toEqual(["status"]);
  });

  it("returns empty array for totally unrelated string", () => {
    const result = suggestCommands("xyz123", known);
    expect(result).toEqual([]);
  });

  it("returns empty array for unknown command beyond threshold", () => {
    const result = suggestCommands("nonexistent", known, 3, 3);
    expect(result).toEqual([]);
  });

  it("respects case-insensitive input", () => {
    const result = suggestCommands("STATUS", known);
    // "status" is an exact match when case-folded (distance 0)
    expect(result).toContain("status");
  });

  it("supports custom maxSuggestions", () => {
    // "stats" distances: status=1, start=2, stack=2, sprint=5
    const result = suggestCommands("stats", ["status", "sprint", "start", "stack"], 2, 3);
    // Sorted: status(1), stack(2), start(2)
    expect(result).toEqual(["status", "stack"]);
  });

  it("supports custom threshold", () => {
    // "stats" → status=1 (within threshold 1), help=4, sprint=5, bench=5, backlog=5, index=5
    const result = suggestCommands("stats", known, 3, 1);
    expect(result).toEqual(["status"]);
  });

  it("sorts by distance then alphabetically", () => {
    const cmds = ["aaa", "aba", "abb"];
    // "abc" → aaa=3, aba=1, abb=2
    const result = suggestCommands("abc", cmds, 3, 3);
    expect(result).toEqual(["aba", "abb", "aaa"]);
  });

  it("preserves original casing in results", () => {
    const cmds = ["Status", "INDEX", "Help"];
    const result = suggestCommands("status", cmds, 3, 0);
    // Only exact case-folded match
    expect(result).toEqual(["Status"]);
  });

  it("handles empty known commands array", () => {
    const result = suggestCommands("status", []);
    expect(result).toEqual([]);
  });
});
