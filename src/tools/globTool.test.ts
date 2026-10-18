// xcoder:version 2 | xcoder:task task-456d3f | xcoder:updated 2026-08-03T15:54:56.517Z | xcoder:subtask code-st-97a4d4
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { globTool } from "./globTool.js";

describe("globTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcoder-glob-"));
    // Create test files
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "app.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "src", "app.test.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "src", "sub", "util.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "");
    // Create .gitignore for ignore rule testing
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "dist/\n");
    fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "dist", "out.js"), "");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("matches files by simple glob", async () => {
    const results = await globTool("src/*.ts", tmpDir);
    // fast-glob returns paths relative to the cwd
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((f) => f.endsWith("app.ts"))).toBe(true);
    expect(results.some((f) => f.endsWith("app.test.ts"))).toBe(true);
    expect(results.some((f) => f.includes("sub") && f.endsWith("util.ts"))).toBe(false);
  });

  it("matches recursively with ** pattern", async () => {
    const results = await globTool("src/**/*.ts", tmpDir);
    expect(results.some((f) => f.endsWith("app.ts"))).toBe(true);
    expect(results.some((f) => f.includes("sub") && f.endsWith("util.ts"))).toBe(true);
  });

  it("empty results for non-matching pattern", async () => {
    const results = await globTool("nonexistent/**", tmpDir);
    expect(results).toEqual([]);
  });

  it("respects ignore rules from .gitignore", async () => {
    const results = await globTool("**/*.js", tmpDir);
    const basenames = results.map((f) => path.posix.relative(tmpDir, f.replace(/\\/g, "/")).replace(/^\//, ""));
    // dist/out.js should be ignored because .gitignore has dist/
    expect(basenames).not.toContain("dist/out.js");
  });

  it("returns only files (not directories)", async () => {
    const results = await globTool("src", tmpDir);
    // "src" is a directory, should not be returned as a file
    const basenames = results.map((f) => path.posix.relative(tmpDir, f.replace(/\\/g, "/")).replace(/^\//, ""));
    expect(basenames).not.toContain("src");
  });

  it("uses process.cwd() when cwd is not provided", async () => {
    // Just verify it doesn't throw with default cwd
    const results = await globTool("package.json");
    expect(results).toBeInstanceOf(Array);
  });
});
