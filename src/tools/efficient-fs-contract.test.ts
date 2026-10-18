// xcoder:version 8 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T19:17:07.092Z | xcoder:subtask test-st-cd592b
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { editFileTool } from "./edit-tool.js";
import { applyUnifiedDiffTool } from "./git-tools.js";
import { readOutlineTool, readMultipleFilesTool } from "./fs-tools.js";
import { linePatchTool, hashFile } from "./patch-tools.js";
import { renameSymbolTool } from "./ast-tools.js";
import { validateFileTool } from "./validate-tool.js";
import { dispatchTool } from "./tool-registry.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "efffs-contract-test-"));
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

// ---------------------------------------------------------------------------
// search_replace_block / edit_file — blueprint Part 2: "must fail loudly if
// search_block doesn't match exactly once — never guess".
// ---------------------------------------------------------------------------
describe("editFileTool exactly-once anchor contract (blueprint search_replace_block)", () => {
  it("replaces a unique occurrence exactly once and reports replaced:true", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/a.ts", "const a = 1;\nconst b = 2;\n");
      const res = await editFileTool(dir, { path: "src/a.ts", old_str: "const a = 1;", new_str: "const a = 10;" });
      expect(res).toEqual({ ok: true, relPath: "src/a.ts", replaced: true });
      expect(readFileSync(file, "utf8")).toBe("const a = 10;\nconst b = 2;\n");
    } finally {
      cleanup(dir);
    }
  });

  it("returns typed no_match with ZERO writes when the anchor is absent", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/a.ts", "const a = 1;\n");
      const before = readFileSync(file, "utf8");
      const res = await editFileTool(dir, { path: "src/a.ts", old_str: "const z = 99;", new_str: "x" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("no_match");
        expect(res.error).toMatch(/EXACTLY/i);
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  it("returns typed not_unique with ZERO writes when the anchor matches 2+ times", async () => {
    const dir = tempDir();
    try {
      const file = writeFixture(dir, "src/a.ts", "const a = 1;\nconst a = 2;\n");
      const before = readFileSync(file, "utf8");
      const res = await editFileTool(dir, { path: "src/a.ts", old_str: "const a =", new_str: "const b =" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("not_unique");
        expect(res.error).toMatch(/2 locations/);
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  it("refuses paths that resolve outside the workspace", async () => {
    const dir = tempDir();
    try {
      const res = await editFileTool(dir, { path: "../evil.ts", old_str: "x", new_str: "y" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("workspace_escape");
      }
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// apply_unified_diff JS fallback — regression guards for the corruption fix:
// hunks are applied bottom-up against ORIGINAL line numbers and stale hunks
// abort with zero writes.
// ---------------------------------------------------------------------------
describe("applyUnifiedDiffTool non-repo JS fallback", () => {
  it("applies multiple hunks bottom-up against original line numbers without corrupting the file", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/a.ts", "line1\nline2\nline3\nline4\nline5\nline6\n");
      const res = await applyUnifiedDiffTool(dir, {
        path: "src/a.ts",
        diff: `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,2 @@
 line1
-line2
-line3
+LINE2.5
@@ -5,2 +5,2 @@
 line5
-line6
+LINE6
`,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.hunksApplied).toBe(2);
        expect(res.sha1After).toMatch(/^[0-9a-f]{40}$/);
        // hunk B targets original lines 5-6, NOT the shifted lines after hunk A shrank the file.
        expect(readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe("line1\nLINE2.5\nline4\nline5\nLINE6\n");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("aborts with no_diff_hunks and ZERO writes when a hunk covers a stale line range", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/a.ts", "one\ntwo\nthree\n");
      const before = readFileSync(path.join(dir, "src/a.ts"), "utf8");
      const res = await applyUnifiedDiffTool(dir, {
        path: "src/a.ts",
        diff: `--- a/src/a.ts
+++ b/src/a.ts
@@ -10,2 +10,2 @@
 one
-two
+TWO
`,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("no_diff_hunks");
        expect(res.error).toMatch(/stale/);
      }
      expect(readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  it("returns no_diff_hunks for a diff with no @@ hunks", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/a.ts", "one\n");
      const res = await applyUnifiedDiffTool(dir, { path: "src/a.ts", diff: "--- a\n+++ b\n- one\n+ 1\n" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("no_diff_hunks");
      }
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// read_outline (blueprint: default first read; text fallback; binary refusal)
// ---------------------------------------------------------------------------
describe("readOutlineTool", () => {
  it("returns a structural text outline for markdown/text files", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "README.md", "# Title\n\nSome prose line.\n\n## Second\n- item one\n- item two\n");
      const res = await readOutlineTool(dir, "README.md");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.language).toBe("text");
        expect(res.symbols).toEqual([]);
        expect(res.imports).toEqual([]);
        expect(res.body).toContain("# Title");
        expect(res.body).toContain("## Second");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("refuses binary files with unsupported_language", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/blob.bin", "abc\u0000def");
      const res = await readOutlineTool(dir, "src/blob.bin");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("unsupported_language");
        expect(res.error).toMatch(/binary/i);
      }
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// read_multiple_files (blueprint Part 3: batch reads; error sections not fatal)
// ---------------------------------------------------------------------------
describe("readMultipleFilesTool edge cases", () => {
  it("invalid_files for an empty files array", async () => {
    const dir = tempDir();
    try {
      const res = await readMultipleFilesTool(dir, { files: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("invalid_files");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("keeps the batch ok and labels per-file errors instead of failing the whole call", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/b.ts", "export const b = 1;\n");
      const res = await readMultipleFilesTool(dir, {
        files: [{ path: "src/missing.ts" }, { path: "src/b.ts" }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.dropped).toBe(0);
        expect(res.sections[0].label).toContain("(ERROR)");
        expect(res.sections[0].content).toMatch(/doesn't exist|not found|not in the workspace index/i);
        expect(res.sections[1].label).toContain("src/b.ts");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("marks a ranged section as sliced and labels the window", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/a.ts", "l1\nl2\nl3\nl4\nl5");
      const res = await readMultipleFilesTool(dir, {
        files: [{ path: "src/a.ts", startLine: 2, endLine: 4 }],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.sections[0].sliced).toBe(true);
        expect(res.sections[0].label).toContain("lines 2-4 of 5");
      }
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// line_patch typed failure paths (workspace escape, missing file, bad range)
// ---------------------------------------------------------------------------
describe("linePatchTool typed failures", () => {
  it("workspace_escape for paths outside the root", async () => {
    const dir = tempDir();
    try {
      const res = await linePatchTool(dir, {
        path: "../evil.ts",
        startLine: 1,
        endLine: 1,
        newContent: "x",
        expectedSha1: "a".repeat(40),
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("workspace_escape");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("file_not_found for a missing file", async () => {
    const dir = tempDir();
    try {
      const res = await linePatchTool(dir, {
        path: "src/nope.ts",
        startLine: 1,
        endLine: 1,
        newContent: "x",
        expectedSha1: "a".repeat(40),
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("file_not_found");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("invalid_range when endLine exceeds the file, with ZERO writes", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/a.ts", "only one line\n");
      const before = readFileSync(path.join(dir, "src/a.ts"), "utf8");
      const res = await linePatchTool(dir, {
        path: "src/a.ts",
        startLine: 1,
        endLine: 50,
        newContent: "x",
        expectedSha1: await hashFile(path.join(dir, "src/a.ts")),
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("invalid_range");
      }
      expect(readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// validate_file JSON path + escape guard
// ---------------------------------------------------------------------------
describe("validateFileTool", () => {
  it("JSON: valid file passes, broken file fails with parse errors", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "data/ok.json", "{\"a\": 1}\n");
      const okRes = await validateFileTool(dir, "data/ok.json");
      expect(okRes.ok).toBe(true);
      if (okRes.ok) {
        expect(okRes.result.passed).toBe(true);
        expect(okRes.result.errors).toBeUndefined();
      }

      writeFixture(dir, "data/bad.json", "{bad json}\n");
      const badRes = await validateFileTool(dir, "data/bad.json");
      expect(badRes.ok).toBe(true);
      if (badRes.ok) {
        expect(badRes.result.passed).toBe(false);
        expect(Array.isArray(badRes.result.errors)).toBe(true);
        expect((badRes.result.errors ?? []).join("\n")).toContain("JSON parse error");
      }
    } finally {
      cleanup(dir);
    }
  });

  it("workspace_escape for paths outside the root", async () => {
    const dir = tempDir();
    try {
      const res = await validateFileTool(dir, "../evil.ts");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("workspace_escape");
      }
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// rename_symbol — not_unique must refuse with ZERO writes (no partial rename)
// ---------------------------------------------------------------------------
describe("renameSymbolTool not_unique guard", () => {
  it("refuses when the name is declared more than once and writes nothing", async () => {
    const dir = tempDir();
    try {
      writeFixture(dir, "src/dup.ts", "const dup = 1;\nconst dup = 2;\n");
      const before = readFileSync(path.join(dir, "src/dup.ts"), "utf8");
      const res = await renameSymbolTool(dir, { path: "src/dup.ts", name: "dup", newName: "x" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("not_unique");
      }
      expect(readFileSync(path.join(dir, "src/dup.ts"), "utf8")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Registry integration: required-field validation gates for the 12 new tools
// ---------------------------------------------------------------------------
describe("dispatchTool required-field gates for efficient-fs tools", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["read_outline", {}],
    ["read_multiple_files", { files: [] }],
    ["read_full_file", {}],
    ["search_ast", {}],
    ["get_dependency_graph", {}],
    ["git_log", {}],
    ["line_patch", { path: "x", newContent: "x" }],
    ["apply_unified_diff", { path: "x" }],
    ["update_function", { path: "x" }],
    ["rename_symbol", { path: "x" }],
    ["validate_file", {}],
  ];

  for (const [tool, input] of cases) {
    it(`${tool} missing required field → typed validation error, never throws`, async () => {
      const res = await dispatchTool(process.cwd(), tool, input as never);
      expect(res.ok).toBe(false);
      const out = res.output as { error?: string };
      expect(out.error).toContain("missing required field");
    });
  }

  it("git_diff accepts an empty input object (all fields optional)", async () => {
    const res = await dispatchTool(process.cwd(), "git_diff", {});
    // Should never be a required-field validation error.
    const out = res.output as { error?: string };
    expect(out?.error ?? "").not.toContain("missing required field");
  });
});
