// xcoder:version 1 | xcoder:task task-4f2baf | xcoder:updated 2026-08-05T06:32:36.146Z | xcoder:subtask test-st-99757c
// Tests for duplicate-detector.ts — DuplicateActionDetector
import { describe, it, expect } from "vitest";
import { DuplicateActionDetector, actionKey } from "./duplicate-detector.js";

describe("actionKey", () => {
  it("produces consistent keys for structurally identical inputs", () => {
    const a = actionKey("read_file", { path: "src/a.ts" });
    const b = actionKey("read_file", { path: "src/a.ts" });
    expect(a).toBe(b);
  });

  it("distinguishes different tools", () => {
    const a = actionKey("read_file", { path: "a.ts" });
    const b = actionKey("write_file", { path: "a.ts" });
    expect(a).not.toBe(b);
  });

  it("distinguishes different inputs", () => {
    const a = actionKey("read_file", { path: "a.ts" });
    const b = actionKey("read_file", { path: "b.ts" });
    expect(a).not.toBe(b);
  });

  it("is order-independent for object keys", () => {
    const a = actionKey("read_file", { a: 1, b: 2 });
    const b = actionKey("read_file", { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("handles null inputs", () => {
    const k = actionKey("test", null);
    expect(k).toBe("test::null");
  });

  it("handles nested objects", () => {
    const a = actionKey("test", { outer: { inner: [1, 2, 3] } });
    const b = actionKey("test", { outer: { inner: [1, 2, 3] } });
    expect(a).toBe(b);
  });

  it("handles array inputs", () => {
    const a = actionKey("test", [1, 2, 3]);
    const b = actionKey("test", [1, 2, 3]);
    expect(a).toBe(b);
  });

  it("distinguishes arrays with different order", () => {
    const a = actionKey("test", [1, 2]);
    const b = actionKey("test", [2, 1]);
    expect(a).not.toBe(b);
  });

  it("handles empty string input", () => {
    const k = actionKey("read_file", "");
    expect(k).toBe('read_file::""');
  });

  it("handles boolean and number inputs", () => {
    expect(actionKey("test", true)).toBe("test::true");
    expect(actionKey("test", 42)).toBe("test::42");
    expect(actionKey("test", 0)).toBe("test::0");
  });
});

describe("DuplicateActionDetector", () => {
  describe("first occurrence", () => {
    it("reports not duplicate for a new thought+action", () => {
      const detector = new DuplicateActionDetector();
      const result = detector.check("read the file", "read_file", { path: "x.ts" }, 1);
      expect(result.isDuplicate).toBe(false);
      expect(result.stuck).toBe(false);
      expect(result.warning).toBeNull();
      expect(result.priorIterations).toEqual([]);
      expect(detector.duplicateCount).toBe(0);
    });
  });

  describe("exact duplicate detection", () => {
    it("detects same thought and action", () => {
      const detector = new DuplicateActionDetector();
      detector.check("read the file", "read_file", { path: "x.ts" }, 1);
      const result = detector.check("read the file", "read_file", { path: "x.ts" }, 2);
      expect(result.isDuplicate).toBe(true);
      expect(result.priorIterations).toEqual([1]);
      expect(result.warning).toContain("duplicate detected");
      expect(result.warning).toContain("iteration 1");
      expect(detector.duplicateCount).toBe(1);
    });

    it("increments duplicateCount across different actions", () => {
      const detector = new DuplicateActionDetector();
      detector.check("do A", "tool_a", { x: 1 }, 1);
      detector.check("do A", "tool_a", { x: 1 }, 2); // dup #1
      detector.check("do B", "tool_b", { y: 2 }, 3);
      detector.check("do B", "tool_b", { y: 2 }, 4); // dup #2
      expect(detector.duplicateCount).toBe(2);
    });
  });

  describe("thought normalization", () => {
    it("ignores case differences in thought", () => {
      const detector = new DuplicateActionDetector();
      detector.check("Read the file", "read_file", { path: "x.ts" }, 1);
      const result = detector.check("read the file", "read_file", { path: "x.ts" }, 2);
      expect(result.isDuplicate).toBe(true);
    });

    it("ignores extra whitespace in thought", () => {
      const detector = new DuplicateActionDetector();
      detector.check("read   the   file", "read_file", { path: "x.ts" }, 1);
      const result = detector.check("read the file", "read_file", { path: "x.ts" }, 2);
      expect(result.isDuplicate).toBe(true);
    });

    it("detects duplicates even with leading/trailing whitespace", () => {
      const detector = new DuplicateActionDetector();
      detector.check("  read file  ", "read_file", { path: "x.ts" }, 1);
      const result = detector.check("read file", "read_file", { path: "x.ts" }, 2);
      expect(result.isDuplicate).toBe(true);
    });

    it("distinguishes genuinely different thoughts", () => {
      const detector = new DuplicateActionDetector();
      detector.check("read the design doc", "read_file", { path: "x.ts" }, 1);
      const result = detector.check("write a new file", "read_file", { path: "x.ts" }, 2);
      // Same action, different thought — but the combined key includes thought
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe("prior iterations tracking", () => {
    it("records all iterations where a duplicate occurred", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought", "tool", { x: 1 }, 1);
      detector.check("thought", "tool", { x: 1 }, 3);
      const result = detector.check("thought", "tool", { x: 1 }, 5);
      expect(result.priorIterations).toEqual([1, 3]);
    });

    it("shows prior iteration number in warning", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought", "tool", { x: 1 }, 7);
      const result = detector.check("thought", "tool", { x: 1 }, 12);
      expect(result.warning).toContain("iteration 7");
    });

    it("mentions multiple prior occurrences in warning", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought", "tool", { x: 1 }, 1);
      detector.check("thought", "tool", { x: 1 }, 4);
      detector.check("thought", "tool", { x: 1 }, 5);
      const result = detector.check("thought", "tool", { x: 1 }, 6);
      expect(result.warning).toContain("2 time(s) before that");
    });
  });

  describe("stuck detection (abort threshold)", () => {
    it("reports stuck=false before threshold", () => {
      const detector = new DuplicateActionDetector(5);
      // 4 duplicates
      detector.check("a", "t1", {}, 1); detector.check("a", "t1", {}, 2);
      detector.check("b", "t2", {}, 3); detector.check("b", "t2", {}, 4);
      detector.check("c", "t3", {}, 5); detector.check("c", "t3", {}, 6);
      detector.check("d", "t4", {}, 7); detector.check("d", "t4", {}, 8);
      expect(detector.duplicateCount).toBe(4);
    });

    it("reports stuck=true at exactly the threshold", () => {
      const detector = new DuplicateActionDetector(3);
      detector.check("a", "t", {}, 1); detector.check("a", "t", {}, 2); // dup 1
      detector.check("b", "t", {}, 3); detector.check("b", "t", {}, 4); // dup 2
      detector.check("c", "t", {}, 5); detector.check("c", "t", {}, 6); // dup 3 — stuck
      const result = detector.check("c", "t", {}, 7);
      expect(result.stuck).toBe(true);
    });

    it("stays stuck after threshold is crossed", () => {
      const detector = new DuplicateActionDetector(3);
      detector.check("a", "t", {}, 1); detector.check("a", "t", {}, 2);
      detector.check("b", "t", {}, 3); detector.check("b", "t", {}, 4);
      detector.check("c", "t", {}, 5); detector.check("c", "t", {}, 6);
      // 4th dup, still stuck
      detector.check("d", "t", {}, 7); detector.check("d", "t", {}, 8);
      const result = detector.check("d", "t", {}, 9);
      expect(result.stuck).toBe(true);
    });

    it("defaults to abort threshold of 5", () => {
      const detector = new DuplicateActionDetector();
      // 4 duplicates: not stuck
      for (let i = 0; i < 4; i++) {
        detector.check(`thought${i}`, `tool${i}`, {}, i * 2 + 1);
        const r = detector.check(`thought${i}`, `tool${i}`, {}, i * 2 + 2);
        if (i < 4) expect(r.stuck).toBe(false);
      }
      // 5th duplicate: stuck
      detector.check("final", "final_tool", {}, 9);
      const r = detector.check("final", "final_tool", {}, 10);
      expect(r.stuck).toBe(true);
      expect(detector.duplicateCount).toBe(5);
    });
  });

  describe("non-duplicate scenarios", () => {
    it("different tool with same thought is not a duplicate", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought", "read_file", { path: "x" }, 1);
      const result = detector.check("thought", "write_file", { path: "x" }, 2);
      expect(result.isDuplicate).toBe(false);
    });

    it("different input with same thought and tool is not a duplicate", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought", "read_file", { path: "a" }, 1);
      const result = detector.check("thought", "read_file", { path: "b" }, 2);
      expect(result.isDuplicate).toBe(false);
    });

    it("same action with different thought is not a duplicate", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought A", "read_file", { path: "x" }, 1);
      const result = detector.check("thought B", "read_file", { path: "x" }, 2);
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty thought", () => {
      const detector = new DuplicateActionDetector();
      detector.check("", "tool", { x: 1 }, 1);
      const result = detector.check("", "tool", { x: 1 }, 2);
      expect(result.isDuplicate).toBe(true);
    });

    it("handles empty string input", () => {
      const detector = new DuplicateActionDetector();
      detector.check("thought", "tool", "", 1);
      const result = detector.check("thought", "tool", "", 2);
      expect(result.isDuplicate).toBe(true);
    });

    it("isolation: separate detectors do not interfere", () => {
      const d1 = new DuplicateActionDetector();
      const d2 = new DuplicateActionDetector();
      d1.check("thought", "tool", { x: 1 }, 1);
      d1.check("thought", "tool", { x: 1 }, 2);
      expect(d1.duplicateCount).toBe(1);
      expect(d2.duplicateCount).toBe(0);
    });
  });
});
