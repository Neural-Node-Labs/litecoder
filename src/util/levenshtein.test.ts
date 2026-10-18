// xcoder:version 3 | xcoder:task task-c776f2 | xcoder:updated 2026-08-03T19:36:27.636Z | xcoder:subtask code-st-5c254e
import { describe, it, expect } from "vitest";
import { levenshtein } from "./levenshtein.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  it("returns 0 for identical strings with different casing", () => {
    expect(levenshtein("Hello", "hElLo")).toBe(0);
  });

  it("returns the length of the other string when one is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("handles single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  it("handles single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("handles single substitution", () => {
    expect(levenshtein("cat", "cut")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  it("handles distance 1 (one deletion)", () => {
    expect(levenshtein("status", "stats")).toBe(1);
  });

  it("handles longer strings", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(levenshtein("STATUS", "status")).toBe(0);
    expect(levenshtein("StAtUs", "staats")).toBe(2);
  });
});
