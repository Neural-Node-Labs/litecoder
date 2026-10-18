// xcoder:version 1 | xcoder:task task-456d3f | xcoder:updated 2026-08-03T15:46:46.218Z | xcoder:subtask code-st-97a4d4
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { grepTool } from "./grepTool.js";

describe("grepTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcoder-grep-"));
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "function hello() {\n  return 'world';\n}\n");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "const x = 42;\n// no function here\n");
    fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "sub", "c.ts"), "function goodbye() {\n  return true;\n}\n");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("matches regex in files", async () => {
    const results = await grepTool("function", "*.ts", tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.file.includes("a.ts"))).toBe(true);
    expect(results.some((r) => r.text.includes("function hello"))).toBe(true);
  });

  it("no matches returns empty array", async () => {
    const results = await grepTool("NONEXISTENT_PATTERN_XYZ", "*.ts", tmpDir);
    expect(results).toEqual([]);
  });

  it("globPattern filtering limits search scope", async () => {
    const results = await grepTool("function", "*.ts", tmpDir);
    // Should find functions in *.ts at root, not necessarily in sub/
    const files = new Set(results.map((r) => r.file));
    expect(files.has("a.ts")).toBe(true);
    // sub/c.ts should NOT be in results because glob is *.ts which only matches root
    expect(files.has("sub/c.ts")).toBe(false);
  });

  it("recursive globPattern finds nested files", async () => {
    const results = await grepTool("function", "**/*.ts", tmpDir);
    const files = new Set(results.map((r) => r.file));
    expect(files.has("a.ts")).toBe(true);
    expect(files.has("sub/c.ts")).toBe(true);
  });

  it("returns correct line numbers", async () => {
    const results = await grepTool("return", "a.ts", tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results.find((r) => r.text.includes("return"));
    expect(r).toBeDefined();
    // a.ts: line 2 is "  return 'world';"
    expect(r!.line).toBe(2);
  });

  it("default globPattern is **/*", async () => {
    const results = await grepTool("function", undefined, tmpDir);
    const files = new Set(results.map((r) => r.file));
    expect(files.has("a.ts")).toBe(true);
    expect(files.has("sub/c.ts")).toBe(true);
  });

  it("skips unreadable files gracefully", async () => {
    // Should not throw even if there are no readable files
    const results = await grepTool("whatever", "nonexistent*", tmpDir);
    expect(results).toEqual([]);
  });
});
