// xcoder:version 4 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:49:03.816Z | xcoder:subtask code-st-cd4444
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readFullFileTool,
  readMultipleFilesTool,
  WRITE_FILE_LINE_CEILING,
  FULL_FILE_LINE_CEILING,
  writeFileTool,
  truncateOutput,
  MAX_OBSERVATION_CHARS,
} from "./fs-tools.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "fs-efffs-test-"));
}

function writeFixture(dir: string, name: string, content: string): string {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return file;
}

describe("read_full_file gate (AC-07)", () => {
  it("refuses above ceiling without allowLarge, succeeds with allowLarge", async () => {
    const dir = tempDir();
    const big = Array.from({ length: FULL_FILE_LINE_CEILING + 10 }, (_, i) => `line ${i}`).join("\n");
    const file = writeFixture(dir, "src/big.ts", big);
    const rel = path.relative(dir, file);

    const refused = await readFullFileTool(dir, rel, false);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("file_too_large");
      expect(refused.error).toContain("read_full_file refused");
    }

    const allowed = await readFullFileTool(dir, rel, true);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.lineCount).toBe(FULL_FILE_LINE_CEILING + 10);
    }
  });

  it("succeeds below ceiling without allowLarge", async () => {
    const dir = tempDir();
    const file = writeFixture(dir, "src/small.ts", "a\nb\n");
    const res = await readFullFileTool(dir, path.relative(dir, file), false);
    expect(res.ok).toBe(true);
  });
});

describe("read_multiple_files (AC-06)", () => {
  it("returns labeled sections per file, respects a small ceiling and drops tails with a note", async () => {
    const dir = tempDir();
    const a = writeFixture(dir, "src/a.ts", "aaaa\n");
    const b = writeFixture(dir, "src/b.ts", "bbbb\n");
    const c = writeFixture(dir, "src/c.ts", "cccc\n");

    // Budget sized to fit exactly one section — the last two drop with a note.
    const res = await readMultipleFilesTool(dir, {
      files: [
        { path: path.relative(dir, a) },
        { path: path.relative(dir, b) },
        { path: path.relative(dir, c) },
      ],
      maxTotalChars: 60, // fits exactly one ~37-char section
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sections.length).toBe(1);
      expect(res.dropped).toBe(2);
      expect(res.note).toContain("maxTotalChars");
    }
  });

  it("fits all sections under a generous ceiling", async () => {
    const dir = tempDir();
    const a = writeFixture(dir, "src/a.ts", "aaaa");
    const b = writeFixture(dir, "src/b.ts", "bbbb");
    const c = writeFixture(dir, "src/c.ts", "cccc");
    const res = await readMultipleFilesTool(dir, {
      files: [{ path: path.relative(dir, a) }, { path: path.relative(dir, b) }, { path: path.relative(dir, c) }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sections.length).toBe(3);
      expect(res.dropped).toBe(0);
      expect(res.sections[0].label).toContain("src/a.ts");
      expect(res.sections[0].label).toContain("of 1");
    }
  });
});

describe("write_file gate (AC-15)", () => {
  it("file_too_large above ceiling without force, with an actionable error", async () => {
    const dir = tempDir();
    const content = Array.from({ length: WRITE_FILE_LINE_CEILING + 5 }, (_, i) => `line ${i}`).join("\n");
    const res = await writeFileTool(dir, "src/huge.ts", content);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("file_too_large");
      expect(res.error).toContain("edit_file");
      expect(res.error).toContain("line_patch");
    }
  });

  it("force writes the same content", async () => {
    const dir = tempDir();
    const content = Array.from({ length: WRITE_FILE_LINE_CEILING + 5 }, (_, i) => `line ${i}`).join("\n");
    const res = await writeFileTool(dir, "src/huge.ts", content, undefined, { force: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(readFileSync(path.join(dir, "src/huge.ts"), "utf8")).toBe(content);
    }
  });

  it("small writes unaffected (backward compatible)", async () => {
    const dir = tempDir();
    const res = await writeFileTool(dir, "src/small.ts", "x\n");
    expect(res.ok).toBe(true);
  });
});

describe("truncateOutput (AC-18)", () => {
  it("truncates above MAX_OBSERVATION_CHARS with an actionable note", () => {
    const long = "x".repeat(5000);
    const res = truncateOutput(long);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThan(MAX_OBSERVATION_CHARS);
    expect(res.note).toContain("truncated");
  });

  it("passes through short text untouched", () => {
    const short = "short";
    const res = truncateOutput(short);
    expect(res.truncated).toBe(false);
    expect(res.text).toBe(short);
  });
});
