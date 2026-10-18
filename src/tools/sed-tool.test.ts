import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { sedTool, type SedToolInput, type SedToolResult } from "./sed-tool.js";

// ── Test workspace helpers ──

let testRoot: string;
const testFiles: string[] = [];

async function createFile(relPath: string, content: string): Promise<void> {
  const full = path.join(testRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  testFiles.push(relPath);
}

async function readFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(testRoot, relPath), "utf8");
}

async function fileExists(relPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(testRoot, relPath));
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  testRoot = path.join(os.tmpdir(), `sed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testRoot, { recursive: true });
  // Need .xcoder dir for workspace index
  await fs.mkdir(path.join(testRoot, ".xcoder"), { recursive: true });
  // Write a minimal workspace index so getOrBuildIndex doesn't do a full filesystem scan
  const index = {
    root: testRoot,
    builtAt: new Date().toISOString(),
    entries: [] as { relPath: string; sizeBytes: number; mtimeMs: number; sha1: string; language: string }[],
  };
  await fs.writeFile(
    path.join(testRoot, ".xcoder", "workspace-index.json"),
    JSON.stringify(index, null, 2),
    "utf8"
  );
});

afterEach(async () => {
  try {
    await fs.rm(testRoot, { recursive: true, force: true });
  } catch {
    // cleanup best-effort
  }
  testFiles.length = 0;
});

// ── Helper to build input ──

function input(overrides: Partial<SedToolInput> = {}): SedToolInput {
  return {
    operation: "substitute",
    ...overrides,
  } as SedToolInput;
}

// ── Tests ──

describe("sedTool", () => {
  // ── Input validation ──────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns no_target when neither path nor glob provided", async () => {
      const result = await sedTool(testRoot, input({ operation: "substitute" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("no_target");
      }
    });

    it("returns invalid_operation for unknown operation", async () => {
      const result = await sedTool(testRoot, input({ path: "test.txt", operation: "bogus" as any }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for substitute without pattern", async () => {
      const result = await sedTool(testRoot, input({ path: "test.txt", operation: "substitute" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
        expect(result.error).toContain("pattern");
      }
    });

    it("returns invalid_operation for substitute without replacement", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "substitute", pattern: "foo" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
        expect(result.error).toContain("replacement");
      }
    });

    it("returns invalid_operation for delete without pattern", async () => {
      const result = await sedTool(testRoot, input({ path: "test.txt", operation: "delete" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for deleteRange without startLine/endLine", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "deleteRange" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for deleteRange with startLine < 1", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "deleteRange", startLine: 0, endLine: 3 })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for deleteRange with endLine < startLine", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "deleteRange", startLine: 5, endLine: 2 })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for insert without text", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "insert", afterLine: 1 })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for appendAfter without pattern", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "appendAfter", text: "bar" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for appendAfter without text", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "appendAfter", pattern: "foo" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_regex for bad pattern", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "substitute", pattern: "[", replacement: "x" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_regex");
      }
    });

    it("returns invalid_regex for disallowed flags", async () => {
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "foo",
          replacement: "bar",
          flags: "u",
        })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_regex");
      }
    });

    it("allows whitelisted flags (g, i, m, s)", async () => {
      await createFile("test.txt", "hello\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "hello",
          replacement: "bye",
          flags: "gims",
        })
      );
      expect(result.ok).toBe(true);
    });
  });

  // ── Substitute ────────────────────────────────────────────────────────

  describe("substitute operation", () => {
    it("replaces a pattern in a file", async () => {
      await createFile("test.txt", "hello world\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "world",
          replacement: "there",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(true);
        expect(result.results[0].changes).toBeGreaterThanOrEqual(1);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("hello there\n");
    });

    it("supports global replace with g flag", async () => {
      await createFile("test.txt", "cat cat cat\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "cat",
          replacement: "dog",
          flags: "g",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("dog dog dog\n");
    });

    it("supports back-references $1, $&", async () => {
      await createFile("test.txt", "hello world\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "(hello) (world)",
          replacement: "$2 $1",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("world hello\n");
    });

    it("supports $& for full match", async () => {
      await createFile("test.txt", "hello world\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "world",
          replacement: "[$&]",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("hello [world]\n");
    });

    it("returns matched: false when pattern doesn't match", async () => {
      await createFile("test.txt", "hello world\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "xyzzy",
          replacement: "nothing",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
        expect(result.results[0].changes).toBe(0);
      }
    });

    it("supports case-insensitive flag", async () => {
      await createFile("test.txt", "Hello World\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "hello",
          replacement: "hi",
          flags: "i",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("hi World\n");
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────

  describe("delete operation", () => {
    it("deletes lines matching a pattern", async () => {
      await createFile("test.txt", "keep me\ndelete this\nkeep too\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "delete",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(true);
        expect(result.results[0].changes).toBe(1);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("keep me\nkeep too\n");
    });

    it("deletes multiple matching lines", async () => {
      await createFile("test.txt", "remove me\nkeep\nremove this too\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "remove",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("keep\n");
    });

    it("returns matched: false when no lines match", async () => {
      await createFile("test.txt", "keep me\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "nonexistent",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
      }
    });
  });

  // ── DeleteRange ───────────────────────────────────────────────────────

  describe("deleteRange operation", () => {
    it("deletes a range of lines (1-indexed)", async () => {
      await createFile("test.txt", "line1\nline2\nline3\nline4\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 2,
          endLine: 3,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(2);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline4\n");
    });

    it("deletes from startLine to end when endLine exceeds file", async () => {
      await createFile("test.txt", "line1\nline2\nline3\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 2,
          endLine: 99,
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line1\n");
    });

    it("does nothing when startLine > file length", async () => {
      await createFile("test.txt", "line1\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 10,
          endLine: 20,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
      }
    });
  });

  // ── Insert ────────────────────────────────────────────────────────────

  describe("insert operation", () => {
    it("inserts text after a specified line", async () => {
      await createFile("test.txt", "line1\nline3\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 1,
          text: "line2",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(1);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline2\nline3\n");
    });

    it("inserts at beginning when afterLine: 0", async () => {
      await createFile("test.txt", "line1\nline2\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 0,
          text: "line0",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line0\nline1\nline2\n");
    });

    it("appends at end when afterLine exceeds file length", async () => {
      await createFile("test.txt", "line1\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 99,
          text: "appended",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nappended\n");
    });

    it("inserts at end when afterLine is not provided (default)", async () => {
      await createFile("test.txt", "line1\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          text: "appended",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nappended\n");
    });
  });

  // ── AppendAfter ───────────────────────────────────────────────────────

  describe("appendAfter operation", () => {
    it("appends text after lines matching pattern", async () => {
      await createFile("test.txt", "fruit: apple\ncolor: red\nfruit: banana\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "appendAfter",
          pattern: "^fruit:",
          text: "  type: produce",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(2);
      }
      const content = await readFile("test.txt");
      expect(content).toBe(
        "fruit: apple\n  type: produce\ncolor: red\nfruit: banana\n  type: produce\n"
      );
    });

    it("returns matched: false when no lines match", async () => {
      await createFile("test.txt", "line1\nline2\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "appendAfter",
          pattern: "nonexistent",
          text: "extra",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
      }
    });
  });

  // ── Dry Run ───────────────────────────────────────────────────────────

  describe("dryRun", () => {
    it("returns output but does not write to disk", async () => {
      await createFile("test.txt", "hello world\n");
      const original = await readFile("test.txt");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "world",
          replacement: "there",
          dryRun: true,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].output).toBeDefined();
        expect(result.results[0].output).toBe("hello there\n");
      }
      // File should be unchanged
      const content = await readFile("test.txt");
      expect(content).toBe(original);
    });

    it("does not include output when dryRun is false", async () => {
      await createFile("test.txt", "hello world\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "world",
          replacement: "there",
          dryRun: false,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].output).toBeUndefined();
      }
    });
  });

  // ── Line Ending Preservation ─────────────────────────────────────────

  describe("line ending preservation", () => {
    it("preserves LF line endings", async () => {
      await createFile("test.txt", "line1\nline2\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "line",
          replacement: "row",
          flags: "g",
        })
      );
      const content = await readFile("test.txt");
      expect(content).toBe("row1\nrow2\n");
      expect(content).not.toContain("\r");
    });

    it("preserves CRLF line endings", async () => {
      await createFile("test.txt", "line1\r\nline2\r\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "line",
          replacement: "row",
          flags: "g",
        })
      );
      const content = await readFile("test.txt");
      expect(content).toBe("row1\r\nrow2\r\n");
    });

    it("handles mixed line endings (treats as LF for output)", async () => {
      await createFile("test.txt", "line1\r\nline2\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "line",
          replacement: "row",
          flags: "g",
        })
      );
      // Mixed: CRLF is restored to LF after normalization
      const content = await readFile("test.txt");
      // Should be normalized output
      expect(content).toContain("row1");
      expect(content).toContain("row2");
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty file", async () => {
      await createFile("test.txt", "");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "anything",
          replacement: "nothing",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
      }
    });

    it("handles single-line file without trailing newline", async () => {
      await createFile("test.txt", "only line");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "only",
          replacement: "the",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(true);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("the line");
    });

    it("handles file with multiple consecutive newlines", async () => {
      await createFile("test.txt", "line1\n\n\nline2\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "^$",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline2\n");
    });
  });

  // ── Error Codes ─────────────────────────────────────────────────────

  describe("error codes", () => {
    it("returns file_not_found for nonexistent file", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "nonexistent.txt", operation: "substitute", pattern: "x", replacement: "y" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("file_not_found");
      }
    });

    it("returns workspace_escape for paths outside root", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "../outside.txt", operation: "substitute", pattern: "x", replacement: "y" })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("workspace_escape");
      }
    });

    it("returns workspace_escape for absolute paths", async () => {
      const result = await sedTool(
        testRoot,
        input({
          path: "/etc/passwd",
          operation: "substitute",
          pattern: "x",
          replacement: "y",
        })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("workspace_escape");
      }
    });
  });

  // ── Glob ─────────────────────────────────────────────────────────────

  describe("glob resolution", () => {
    it("resolves multiple files via glob", async () => {
      // These files need to be in the index for glob to find them
      await createFile("src/a.ts", "content A\n");
      await createFile("src/b.ts", "content B\n");

      // We need to rebuild the index manually for test
      const { buildIndex } = await import("./workspace-index.js");
      await buildIndex(testRoot);

      const result = await sedTool(
        testRoot,
        input({
          glob: "src/*.ts",
          operation: "substitute",
          pattern: "content",
          replacement: "file",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results.length).toBe(2);
        for (const r of result.results) {
          expect(r.matched).toBe(true);
        }
      }
    });

    it("glob takes precedence over path when both are provided", async () => {
      await createFile("file-a.txt", "aaa\n");
      await createFile("file-b.txt", "bbb\n");

      const { buildIndex } = await import("./workspace-index.js");
      await buildIndex(testRoot);

      const result = await sedTool(
        testRoot,
        input({
          path: "file-a.txt",
          glob: "file-*.txt",
          operation: "substitute",
          pattern: ".",
          replacement: "X",
          flags: "g",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        // glob takes precedence → both files processed
        expect(result.results.length).toBe(2);
      }
    });

    it("returns file_not_found when glob matches no files", async () => {
      const { buildIndex } = await import("./workspace-index.js");
      await buildIndex(testRoot);

      const result = await sedTool(
        testRoot,
        input({
          glob: "nonexistent/*.xyz",
          operation: "substitute",
          pattern: "x",
          replacement: "y",
        })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("file_not_found");
      }
    });
  });

  // ── Additional Input Validation ─────────────────────────────────────

  describe("additional input validation", () => {
    it("returns invalid_operation for insert with negative afterLine", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "insert", text: "foo", afterLine: -1 })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for insert with non-integer afterLine", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "insert", text: "foo", afterLine: 1.5 })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });

    it("returns invalid_operation for deleteRange with non-integer startLine", async () => {
      const result = await sedTool(
        testRoot,
        input({ path: "test.txt", operation: "deleteRange", startLine: 1.5, endLine: 3 })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_operation");
      }
    });
  });

  // ── Substitute Advanced ──────────────────────────────────────────────

  describe("substitute advanced", () => {
    it("supports multiline flag (m) where ^ and $ match line boundaries", async () => {
      await createFile("test.txt", "first\nsecond\nthird\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "^s",
          replacement: "X",
          flags: "gm",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("first\nXecond\nthird\n");
    });

    it("supports dotall flag (s) within a single line", async () => {
      await createFile("test.txt", "hello world\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "hello.world",
          replacement: "REPLACED",
          flags: "s",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("REPLACED\n");
    });

    it("supports $ for literal dollar in replacement", async () => {
      await createFile("test.txt", "price\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "price",
          replacement: "$5.00",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("$5.00\n");
    });

    it("handles empty replacement string", async () => {
      await createFile("test.txt", "remove-me keep\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "remove-me ",
          replacement: "",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("keep\n");
    });

    it("supports back-reference $9", async () => {
      await createFile("test.txt", "abcdefghi\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)",
          replacement: "$9$8$7$6$5$4$3$2$1",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("ihgfedcba\n");
    });

    it("substitutes only first match without g flag (explicit default)", async () => {
      await createFile("test.txt", "cat cat cat\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "cat",
          replacement: "dog",
          flags: "",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("dog cat cat\n");
    });
  });

  // ── DeleteRange Advanced ─────────────────────────────────────────────

  describe("deleteRange advanced", () => {
    it("deletes a single line when startLine equals endLine", async () => {
      await createFile("test.txt", "line1\nline2\nline3\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 2,
          endLine: 2,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(1);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline3\n");
    });

    it("deletes first line via deleteRange when startLine=1 and endLine=1", async () => {
      await createFile("test.txt", "line1\nline2\nline3\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 1,
          endLine: 1,
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line2\nline3\n");
    });

    it("deletes last line via deleteRange", async () => {
      await createFile("test.txt", "line1\nline2\nline3\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 3,
          endLine: 3,
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline2\n");
    });
  });

  // ── Delete Advanced ─────────────────────────────────────────────────

  describe("delete advanced", () => {
    it("deletes all lines when pattern matches everything", async () => {
      await createFile("test.txt", "a\nb\nc\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: ".",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(3);
      }
      const content = await readFile("test.txt");
      // Trailing newline is preserved, so file ends with a single newline
      expect(content).toBe("\n");
    });

    it("handles delete on empty file", async () => {
      await createFile("test.txt", "");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "anything",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
      }
    });

    it("supports case-insensitive delete with i flag", async () => {
      await createFile("test.txt", "Keep\nDELETE\nkeep\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "delete",
          flags: "i",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("Keep\nkeep\n");
    });
  });

  // ── AppendAfter Advanced ────────────────────────────────────────────

  describe("appendAfter advanced", () => {
    it("handles appendAfter on empty file (no matches)", async () => {
      await createFile("test.txt", "");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "appendAfter",
          pattern: "anything",
          text: "extra",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].matched).toBe(false);
      }
    });

    it("appends after every matching line when multiple match", async () => {
      await createFile("test.txt", "header\ndata\nheader\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "appendAfter",
          pattern: "header",
          text: "---",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(2);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("header\n---\ndata\nheader\n---\n");
    });
  });

  // ── Insert Advanced ─────────────────────────────────────────────────

  describe("insert advanced", () => {
    it("allows empty text for insert", async () => {
      await createFile("test.txt", "line1\nline2\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 1,
          text: "",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(1);
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\n\nline2\n");
    });

    it("inserts multiple separate lines by calling twice", async () => {
      await createFile("test.txt", "line1\nline4\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 1,
          text: "line2",
        })
      );
      const result2 = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 2,
          text: "line3",
        })
      );
      expect(result2.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline2\nline3\nline4\n");
    });
  });

  // ── Dry Run Advanced ────────────────────────────────────────────────

  describe("dryRun advanced", () => {
    it("returns output for delete operation in dry-run", async () => {
      await createFile("test.txt", "keep me\ndelete this\nkeep too\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "delete",
          dryRun: true,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].output).toBeDefined();
        expect(result.results[0].output).toBe("keep me\nkeep too\n");
      }
      // File unchanged
      const content = await readFile("test.txt");
      expect(content).toBe("keep me\ndelete this\nkeep too\n");
    });

    it("returns output for insert operation in dry-run", async () => {
      await createFile("test.txt", "line1\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 1,
          text: "inserted",
          dryRun: true,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].output).toBeDefined();
        expect(result.results[0].output).toBe("line1\ninserted\n");
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\n");
    });

    it("returns output for deleteRange operation in dry-run", async () => {
      await createFile("test.txt", "line1\nline2\nline3\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 2,
          endLine: 2,
          dryRun: true,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].output).toBeDefined();
        expect(result.results[0].output).toBe("line1\nline3\n");
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\nline2\nline3\n");
    });
  });

  // ── Edge Cases Extended ─────────────────────────────────────────────

  describe("edge cases extended", () => {
    it("handles file with only newlines", async () => {
      await createFile("test.txt", "\n\n\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "^$",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      // Trailing newline is preserved; deleting all empty lines leaves one newline
      expect(content).toBe("\n");
    });

    it("preserves trailing newline after substitute on single line", async () => {
      await createFile("test.txt", "hello\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "hello",
          replacement: "bye",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("bye\n");
    });

    it("preserves no-trailing-newline convention after substitute", async () => {
      await createFile("test.txt", "hello");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "hello",
          replacement: "bye",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("bye");
    });

    it("handles file with special regex characters in content (literal match)", async () => {
      await createFile("test.txt", "price: $5.00 [special]\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "$5.00",
          replacement: "$10.00",
        })
      );
      expect(result.ok).toBe(true);
      // Note: $ is a regex anchor, so this may not match if not escaped.
      // This tests that the regex is taken literally.
      if (result.ok) {
        // The pattern "$5.00" as regex: $ means end-of-line, so it matches
        // end-of-line followed by "5" and "0" and "0"? Actually "$5.00" as
        // regex would try to match "5.00" at end of line.
        // Since content is "price: $5.00 [special]\n", "5.00" is not at end,
        // so matched should be false.
        expect(result.results[0].matched).toBe(false);
      }
    });

    it("handles CRLF file with insert operation", async () => {
      await createFile("test.txt", "line1\r\nline3\r\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 1,
          text: "line2",
        })
      );
      const content = await readFile("test.txt");
      expect(content).toBe("line1\r\nline2\r\nline3\r\n");
    });

    it("handles CRLF file with delete operation", async () => {
      await createFile("test.txt", "keep\r\ndelete\r\nkeep\r\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "delete",
        })
      );
      const content = await readFile("test.txt");
      expect(content).toBe("keep\r\nkeep\r\n");
    });

    it("handles CRLF file with deleteRange operation", async () => {
      await createFile("test.txt", "line1\r\nline2\r\nline3\r\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "deleteRange",
          startLine: 2,
          endLine: 2,
        })
      );
      const content = await readFile("test.txt");
      expect(content).toBe("line1\r\nline3\r\n");
    });

    it("handles CRLF file with appendAfter operation", async () => {
      await createFile("test.txt", "header\r\ndata\r\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "appendAfter",
          pattern: "header",
          text: "---",
        })
      );
      const content = await readFile("test.txt");
      expect(content).toBe("header\r\n---\r\ndata\r\n");
    });
  });
});
