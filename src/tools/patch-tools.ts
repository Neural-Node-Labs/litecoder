// xcoder:version 1 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:18:11.500Z | xcoder:subtask code-st-cd4444
import { promises as fs } from "node:fs";
import { resolveInWorkspaceSafe } from "./workspace-path.js";
import path from "node:path";
import crypto from "node:crypto";
import { upsertEntry } from "./workspace-index.js";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import { incrementFileVersion } from "../store/file-version-store.js";

export class WorkspaceEscapeError extends Error {}

/**
 * Every path a tool touches is resolved and pinned inside the workspace root.
 * No `..` escapes — the same 8-line guard every other path-taking tool uses.
 */
export function resolveInWorkspace(root: string, relPath: string): string {
  return resolveInWorkspaceSafe(root, relPath, (m) => new WorkspaceEscapeError(m));
}

// ---------------------------------------------------------------------------
// Staleness helpers (AC-11 / AC-19)
// ---------------------------------------------------------------------------

/**
 * Full-file sha1, byte-for-byte identical to the one `workspace-index.ts`
 * stores per entry — so a sha1 taken here is directly comparable with the
 * index's value and with the `readSha1` returned by range reads.
 */
export async function hashFile(fullPath: string): Promise<string> {
  const buf = await fs.readFile(fullPath);
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/**
 * The reusable staleness core behind every stale-enforced write tool.
 * Compares the file's CURRENT sha1 against the sha1 the caller observed
 * earlier (via read_file's `readSha1`). A mismatch means the file changed
 * under the caller — the write MUST NOT proceed.
 */
export async function assertFileUnchanged(
  fullPath: string,
  expectedSha1: string
): Promise<{ ok: true } | { ok: false; actualSha1: string }> {
  const actualSha1 = await hashFile(fullPath);
  if (actualSha1 !== expectedSha1) return { ok: false, actualSha1 };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// line_patch (AC-11)
// ---------------------------------------------------------------------------

export interface LinePatchInput {
  path: string;
  startLine: number;
  endLine: number;
  newContent: string;
  expectedSha1: string;
}

export type LinePatchResult =
  | {
      ok: true;
      relPath: string;
      replacedLines: [number, number];
      newContentChars: number;
      linesAfter: number;
      sha1After: string;
    }
  | {
      ok: false;
      error: string;
      code:
        | "stale"
        | "stale_field_missing"
        | "file_not_found"
        | "workspace_escape"
        | "invalid_range"
        | "io_error";
      actualSha1?: string;
    };

/**
 * Replace lines [startLine..endLine] (1-indexed, inclusive) with newContent.
 *
 * Staleness contract: `expectedSha1` is REQUIRED. It must come from the
 * `readSha1` field of a prior read_file range call. The file is hashed
 * immediately before any mutation; a mismatch returns `stale` and performs
 * ZERO writes — never a blind line splice onto a file that changed under
 * the agent.
 */
export async function linePatchTool(
  root: string,
  input: LinePatchInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<LinePatchResult> {
  if (typeof input.expectedSha1 !== "string" || input.expectedSha1 === "") {
    return {
      ok: false,
      code: "stale_field_missing",
      error:
        `line_patch requires "expectedSha1" — the file may have changed since you last read it. ` +
        `Re-read the file with read_file (a range read includes "readSha1") and pass that sha1 here.`,
    };
  }

  let full: string;
  try {
    full = resolveInWorkspace(root, input.path);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "workspace_escape" };
  }

  let content: string;
  try {
    content = await fs.readFile(full, "utf8");
  } catch {
    return {
      ok: false,
      code: "file_not_found",
      error: `"${input.path}" doesn't exist or can't be read. Use write_file to create a new file instead of line_patch.`,
    };
  }

  // Range validation BEFORE any mutation.
  const lines = content.split("\n");
  const start = Number(input.startLine);
  const end = Number(input.endLine);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    return {
      ok: false,
      code: "invalid_range",
      error: `invalid line range [${String(input.startLine)}..${String(input.endLine)}] — startLine must be >= 1 and endLine must be >= startLine.`,
    };
  }
  if (end > lines.length) {
    return {
      ok: false,
      code: "invalid_range",
      error: `endLine ${end} exceeds the file's ${lines.length} lines. Re-read the file to confirm its current size.`,
    };
  }

  // Staleness check: hash immediately before any write.
  let checked: { ok: true } | { ok: false; actualSha1: string };
  try {
    checked = await assertFileUnchanged(full, input.expectedSha1);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "io_error" };
  }
  if (!checked.ok) {
    return {
      ok: false,
      code: "stale",
      error:
        `the file changed since you read it (expected sha1 ${input.expectedSha1.slice(0, 12)}, ` +
        `actual ${checked.actualSha1.slice(0, 12)}). Re-read the file and retry with the fresh readSha1 — no changes were written.`,
      actualSha1: checked.actualSha1,
    };
  }

  // Line splice: replace [start..end] (1-indexed, inclusive) with newContent.
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);
  const replacement = input.newContent.split("\n");
  const nextLines = [...before, ...replacement, ...after];
  let next = nextLines.join("\n");

  // Header injection (when context is available and file type supports it).
  if (ctx) {
    const syntax = getCommentSyntax(input.path);
    if (syntax) {
      try {
        const meta = await incrementFileVersion(root, input.path, ctx.taskId, ctx.subtaskId);
        const injected = injectVersionHeader(next, syntax, meta);
        next = injected.content;
      } catch (e) {
        return { ok: false, error: (e as Error).message, code: "io_error" };
      }
    }
  }

  try {
    await fs.writeFile(full, next, "utf8");
    await upsertEntry(root, path.relative(root, full));
    const sha1After = await hashFile(full);
    return {
      ok: true,
      relPath: path.relative(root, full).split(path.sep).join("/"),
      replacedLines: [start, end],
      newContentChars: input.newContent.length,
      linesAfter: next.split("\n").length,
      sha1After,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "io_error" };
  }
}
