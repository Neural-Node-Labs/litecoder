// xcoder:version 1 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:40:11.668Z | xcoder:subtask code-st-cd4444
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashFile, assertFileUnchanged, linePatchTool } from "./patch-tools.js";
import { readFileTool } from "./fs-tools.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "patch-tools-test-"));
}

function writeFixture(dir: string, name: string, content: string): { root: string; file: string } {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return { root: dir, file };
}

describe("hashFile / assertFileUnchanged (AC-19)", () => {
  it("hashFile returns a stable sha1 matching workspace-index's value", async () => {
    const dir = tempDir();
    const { file } = writeFixture(dir, "src/a.ts", "const x = 1;\n");
    const h1 = await hashFile(file);
    const h2 = await hashFile(file);
    expect(h1).toMatch(/^[0-9a-f]{40}$/);
    expect(h1).toBe(h2);
  });

  it("assertFileUnchanged: ok on matching sha1, false + actualSha1 after a touch", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.ts", "line one\nline two\n");
    const before = await hashFile(file);
    expect((await assertFileUnchanged(file, before)).ok).toBe(true);

    // Touch the file externally.
    writeFileSync(file, "line one\nline two changed\n", "utf8");
    const res = await assertFileUnchanged(file, before);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.actualSha1).toBe(await hashFile(file));
      expect(res.actualSha1).not.toBe(before);
    }
    void root;
  });
});

describe("linePatchTool (AC-11)", () => {
  it("replaces a line range and returns sha1After", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.ts", "a\nb\nc\nd\n");
    const rel = path.relative(root, file);
    const read = await readFileTool(root, rel, { startLine: 2, endLine: 3 });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("read failed");

    const res = await linePatchTool(root, {
      path: rel,
      startLine: 2,
      endLine: 3,
      newContent: "B\nC",
      expectedSha1: read.readSha1!,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.replacedLines).toEqual([2, 3]);
      expect(res.sha1After).toMatch(/^[0-9a-f]{40}$/);
      expect(readFileSync(file, "utf8")).toBe("a\nB\nC\nd\n");
    }
  });

  it("refuses stale sha1 with ZERO writes (AC-11 / AC-19)", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.ts", "original line\n");
    const rel = path.relative(root, file);
    const before = await hashFile(file);

    // Someone modifies the file between the read and the patch.
    writeFileSync(file, "changed by someone else\n", "utf8");

    const res = await linePatchTool(root, {
      path: rel,
      startLine: 1,
      endLine: 1,
      newContent: "overwritten",
      expectedSha1: before,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("stale");
      // Zero-write proof: the file still holds the external change.
      expect(readFileSync(file, "utf8")).toBe("changed by someone else\n");
    }
  });

  it("requires stale_field_missing when expectedSha1 is absent", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.ts", "x\n");
    const res = await linePatchTool(root, {
      path: path.relative(root, file),
      startLine: 1,
      endLine: 1,
      newContent: "y",
      expectedSha1: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("stale_field_missing");
    }
  });

  it("rejects invalid ranges with a typed error", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.ts", "x\n");
    const read = await readFileTool(root, path.relative(root, file), { startLine: 1, endLine: 1 });
    if (!read.ok) throw new Error("read failed");
    const res = await linePatchTool(root, {
      path: path.relative(root, file),
      startLine: 5,
      endLine: 9,
      newContent: "y",
      expectedSha1: read.readSha1!,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid_range");
    }
  });
});
