// xcoder:version 1 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T19:08:49.837Z | xcoder:subtask test-st-cd592b
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOutlineTool, readMultipleFilesTool } from "./fs-tools.js";
import { linePatchTool } from "./patch-tools.js";
import { searchAstTool, updateFunctionTool, renameSymbolTool } from "./ast-tools.js";
import { applyUnifiedDiffTool } from "./git-tools.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "efffs-contract2-"));
}

function writeFixture(dir: string, name: string, content: string): string {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return file;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("readOutlineTool TS structural skeleton", () => {
  it("exposes symbol signatures/docstrings and keeps the body", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/lib.ts", "// Adds two numbers.\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n");
      const res = await readOutlineTool(dir, path.relative(dir, file));
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.language).toBe("typescript");
        const add = res.symbols.find((s) => s.name === "add");
        expect(add?.kind).toBe("function");
        expect(add?.signature?.indexOf("export function add")).toBe(0);
        expect(add?.doc).toContain("Adds two numbers");
        expect(res.body).toContain("export function add");
      }
    } finally {
      cleanup(dir);
    }
  });
});

describe("searchAstTool structural contract", () => {
  it("finds a function declaration with typed kind/lines/posix path", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/lib.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
      const res = await searchAstTool(dir, { query: "function add", pathGlob: "src/**/*.ts" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.total).toBe(1);
        const m = res.matches[0];
        expect(m.kind).toBe("function");
        expect(m.name).toBe("add");
        expect(m.startLine).toBe(1);
        expect(m.endLine).toBe(3);
        expect(m.signature).toContain("export function add");
        expect(m.file.replace(/\\/g, "/")).toBe("src/lib.ts");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("call query reports only real call sites", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/lib.ts", "function add(a: number, b: number): number {\n  return a + b;\n}\nconst s = \"add is a string\";\n// add comment\nexport function start() {\n  return add(1, 2);\n}\n");
      const res = await searchAstTool(dir, { query: "call add", pathGlob: "src/**/*.ts" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.matches.map((x) => x.line)).toEqual([7]);
        expect(res.matches[0].kind).toBe("call");
      }
    } finally {
      cleanup(dir);
    }
  });
});

describe("updateFunctionTool zero-write guard", () => {
  it("no_match leaves the file byte-identical", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/a.ts", "export function real(): number {\n  return 1;\n}\n");
      const before = readFileSync(file, "utf8");
      const res = await updateFunctionTool(dir, { path: "src/a.ts", functionName: "ghost", newCode: "export function ghost() { return 2; }" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("no_match");
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});

describe("renameSymbolTool typed zero-write failures", () => {
  it("invalid newName returns no_match without writing", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/a.ts", "const a = 1;\n");
      const before = readFileSync(file, "utf8");
      const res = await renameSymbolTool(dir, { path: "src/a.ts", name: "a", newName: "not an identifier" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("no_match");
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});

describe("applyUnifiedDiffTool workspace escape", () => {
  it("workspace_escape for paths outside the root", async () => {
    const dir = tempDir();
    try {
      const res = await applyUnifiedDiffTool(dir, { path: "../evil.ts", diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("workspace_escape");
      }
    } finally {
      cleanup(dir);
    }
  });
});

describe("linePatchTool stale_field_missing", () => {
  it("empty expectedSha1 refuses the write", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/a.ts", "before\n");
      const before = readFileSync(file, "utf8");
      const res = await linePatchTool(dir, { path: "src/a.ts", startLine: 1, endLine: 1, newContent: "after", expectedSha1: "" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("stale_field_missing");
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});

describe("readMultipleFilesTool per-call cap", () => {
  it("drops files beyond 8 with an actionable note", async () => {
    const dir = tempDir();
    try {
      for (let i = 0; i < 10; i++) {
        writeFixture(dir, "src/f" + i + ".ts", "export const f" + i + " = " + i + ";\n");
      }
      const files = Array.from({ length: 10 }, (_, i) => ({ path: "src/f" + i + ".ts" }));
      const res = await readMultipleFilesTool(dir, { files });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.dropped).toBe(2);
        expect(res.note).toContain("max 8 files per call");
      }
    } finally {
      cleanup(dir);
    }
  });
});
