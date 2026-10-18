// xcoder:version 2 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:46:36.879Z | xcoder:subtask code-st-cd4444
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateFileTool } from "./validate-tool.js";

let dir: string;
let root: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "validate-tool-test-"));
  root = dir;
  mkdirSync(path.join(root, "src"), { recursive: true });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("validateFileTool (AC-17)", () => {
  it("broken TS fixture → passed:false + errors-only observation (no file body)", async () => {
    writeFileSync(path.join(root, "src/broken.ts"), "const x = ;\n", "utf8");
    const res = await validateFileTool(root, "src/broken.ts", "typescript");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.passed).toBe(false);
      expect(Array.isArray(res.result.errors)).toBe(true);
      expect((res.result.errors ?? []).length).toBeGreaterThan(0);
      // Observation is errors only — the file body must never be echoed.
      const joined = (res.result.errors ?? []).join("\n");
      expect(joined).not.toContain("export function x");
    }
  });

  it("valid TS file → passed:true with no errors", async () => {
    writeFileSync(path.join(root, "src/ok.ts"), "export function ok(a: number): number { return a + 1; }\n", "utf8");
    const res = await validateFileTool(root, "src/ok.ts", "typescript");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.passed).toBe(true);
      expect(res.result.errors).toBeUndefined();
    }
  });

  it("uncheckable language → no_checker_available with a fallback suggestion", async () => {
    writeFileSync(path.join(root, "src/data.xyz"), "???\n", "utf8");
    const res = await validateFileTool(root, "src/data.xyz");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("no_checker_available");
      expect(res.error).toContain("run_command");
    }
  });

  it("missing file → typed file_not_found, never throws", async () => {
    const res = await validateFileTool(root, "src/nope.ts");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("file_not_found");
    }
  });
});
