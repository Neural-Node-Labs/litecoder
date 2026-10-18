import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { sedTool } from "./sed-tool.js";
import type { SedToolInput } from "./sed-tool.js";

// ── Test workspace helpers ──

let testRoot: string;

async function createFile(relPath: string, content: string): Promise<void> {
  const full = path.join(testRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

async function readFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(testRoot, relPath), "utf8");
}

beforeEach(async () => {
  testRoot = path.join(os.tmpdir(), `sed-cross-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testRoot, { recursive: true });
  await fs.mkdir(path.join(testRoot, ".xcoder"), { recursive: true });
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
});

function input(overrides: Partial<SedToolInput> = {}): SedToolInput {
  return {
    operation: "substitute",
    ...overrides,
  } as SedToolInput;
}

describe("sedTool cross-platform and edge cases", () => {
  // ══════════════════════════════════════════════════════════════
  // Back-reference Edge Cases
  // ══════════════════════════════════════════════════════════════

  describe("back-reference edge cases", () => {
    it("preserves literal $N when capture group N does not exist", async () => {
      await createFile("test.txt", "price\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "(pri)ce",
          replacement: "$1-$2-ce",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      // $1 = "pri", $2 is undefined => should be literal "$2"
      expect(content).toBe("pri-$2-ce\n");
    });

    it("preserves $$ as literal single dollar", async () => {
      await createFile("test.txt", "price\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "price",
          replacement: "$$5.00",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      // $$ => literal $
      expect(content).toBe("$5.00\n");
    });

    it("mixes $&, valid $N, and invalid $N", async () => {
      await createFile("test.txt", "abc\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "(a)bc",
          replacement: "$1-$&-$9",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      // $1=a, $&=abc, $9=undefined => literal "$9"
      expect(content).toBe("a-abc-$9\n");
    });

    it("treats $0 as literal text", async () => {
      await createFile("test.txt", "hello\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "hello",
          replacement: "$0",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      expect(content).toBe("$0\n");
    });

    it("handles multiple $N with mix of valid and invalid", async () => {
      await createFile("test.txt", "ab12cd\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "(ab)(12)(cd)",
          replacement: "$3$2$1$4$5",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("test.txt");
      // $3=cd, $2=12, $1=ab, $4/literal, $5/literal
      expect(content).toBe("cd12ab$4$5\n");
    });

    it("supports literal $ in replacement (regression test)", async () => {
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
  });

  // ══════════════════════════════════════════════════════════════
  // CRLF Line Ending Edge Cases (cross-platform)
  // ══════════════════════════════════════════════════════════════

  describe("CRLF cross-platform edge cases", () => {
    it("preserves CRLF in dry-run output", async () => {
      await createFile("test.txt", "line1\r\nline2\r\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "substitute",
          pattern: "line",
          replacement: "row",
          flags: "g",
          dryRun: true,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].output).toBe("row1\r\nrow2\r\n");
      }
      const content = await readFile("test.txt");
      expect(content).toBe("line1\r\nline2\r\n");
    });

    it("handles empty file (CRLF detection defaults to LF)", async () => {
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
        expect(result.results[0].changes).toBe(0);
      }
    });

    it("preserves CRLF with insert operation", async () => {
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

    it("preserves CRLF with delete operation", async () => {
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

    it("preserves CRLF with deleteRange operation", async () => {
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

    it("preserves CRLF with appendAfter operation", async () => {
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

  // ══════════════════════════════════════════════════════════════
  // Mixed Line Endings (cross-platform consistency)
  // ══════════════════════════════════════════════════════════════

  describe("mixed line endings", () => {
    it("handles mixed endings with insert", async () => {
      await createFile("test.txt", "line1\r\nline2\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "insert",
          afterLine: 1,
          text: "inserted",
        })
      );
      const content = await readFile("test.txt");
      expect(content).toContain("line1");
      expect(content).toContain("inserted");
      expect(content).toContain("line2");
    });

    it("handles mixed endings with delete", async () => {
      await createFile("test.txt", "keep\r\ndelete\nkeep\r\n");
      await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "delete",
          pattern: "delete",
        })
      );
      const content = await readFile("test.txt");
      expect(content).not.toContain("delete");
      expect(content).toContain("keep");
    });

    it("handles mixed endings with appendAfter", async () => {
      await createFile("test.txt", "fruit\r\ncolor\nfruit\r\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "test.txt",
          operation: "appendAfter",
          pattern: "fruit",
          text: "added",
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results[0].changes).toBe(2);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Cross-Platform Path Handling
  // ══════════════════════════════════════════════════════════════

  describe("cross-platform path handling", () => {
    it("handles deeply nested subdirectory paths", async () => {
      await createFile("deep/nested/dir/file.txt", "data\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "deep/nested/dir/file.txt",
          operation: "substitute",
          pattern: "data",
          replacement: "processed",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("deep/nested/dir/file.txt");
      expect(content).toBe("processed\n");
    });

    it("handles subdirectory paths with forward slashes", async () => {
      await createFile("dir/file.txt", "test\n");
      const result = await sedTool(
        testRoot,
        input({
          path: "dir/file.txt",
          operation: "substitute",
          pattern: "test",
          replacement: "passed",
        })
      );
      expect(result.ok).toBe(true);
      const content = await readFile("dir/file.txt");
      expect(content).toBe("passed\n");
    });
  });
});
