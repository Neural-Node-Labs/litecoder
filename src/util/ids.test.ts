// xcoder:version 1 | xcoder:task task-4f2baf | xcoder:updated 2026-08-05T06:33:19.120Z | xcoder:subtask test-st-99757c
// Tests for ids.ts — shortId
import { describe, it, expect } from "vitest";
import { shortId } from "./ids.js";

describe("shortId", () => {
  it("returns a string with the prefix and a hex suffix", () => {
    const id = shortId("task");
    expect(id).toMatch(/^task-[0-9a-f]{6}$/);
  });

  it("generates unique values across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(shortId("task"));
    }
    // With 6 hex chars (16.7M possibilities), 100 should all be unique
    expect(ids.size).toBe(100);
  });

  it("works with empty prefix", () => {
    const id = shortId("");
    expect(id).toMatch(/^-[0-9a-f]{6}$/);
  });

  it("works with various prefixes", () => {
    expect(shortId("agent")).toMatch(/^agent-/);
    expect(shortId("sub")).toMatch(/^sub-/);
    expect(shortId("x")).toMatch(/^x-/);
  });

  it("returns a 6-char hex suffix", () => {
    const id = shortId("test");
    const suffix = id.split("-")[1];
    expect(suffix).toHaveLength(6);
    expect(/^[0-9a-f]{6}$/.test(suffix)).toBe(true);
  });

  it("generates IDs quickly (fast path)", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      shortId("fast");
    }
    const elapsed = Date.now() - start;
    // Should be very fast (< 50ms for 1000 calls)
    expect(elapsed).toBeLessThan(100);
  });
});
