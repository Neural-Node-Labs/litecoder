import { promises as fs } from "node:fs";
import { resolveInWorkspaceSafe } from "./workspace-path.js";
import path from "node:path";
import { upsertEntry } from "./workspace-index.js";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import { incrementFileVersion } from "../store/file-version-store.js";

export class WorkspaceEscapeError extends Error {}

function resolveInWorkspace(root: string, relPath: string): string {
  return resolveInWorkspaceSafe(root, relPath, (m) => new WorkspaceEscapeError(m));
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export interface EditFileInput {
  path: string;
  old_str: string;
  new_str: string;
}

export type EditFileResult =
  | { ok: true; relPath: string; replaced: true }
  | { ok: false; error: string; code: "file_not_found" | "not_unique" | "no_match" | "workspace_escape" | "io_error" };

/**
 * The tool that exists specifically to fix "the programmer can't refactor
 * large files": `write_file` requires reproducing an ENTIRE file's content
 * to change one function, which is exactly where a model truncates,
 * mis-copies, or silently drops unrelated code in a big file. `edit_file`
 * takes a unique anchor (`old_str`) and its replacement — the same
 * str_replace pattern Claude Code's own editor uses — so a correction to
 * one function never risks the other 900 lines.
 *
 * `old_str` must match EXACTLY ONCE. Zero matches and multiple matches are
 * both refused with a specific, actionable error (rather than guessing
 * which occurrence was meant) so the model can widen its anchor with more
 * surrounding context and retry.
 */
export async function editFileTool(
  root: string,
  input: EditFileInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<EditFileResult> {
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
      error: `"${input.path}" doesn't exist. Use write_file to create a new file instead of edit_file.`,
    };
  }

  const occurrences = countOccurrences(content, input.old_str);
  if (occurrences === 0) {
    return {
      ok: false,
      code: "no_match",
      error:
        `old_str was not found in "${input.path}". It must match the file's current content EXACTLY, ` +
        `including whitespace/indentation. Re-read the file (or the relevant range) and copy the anchor precisely.`,
    };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      code: "not_unique",
      error:
        `old_str matches ${occurrences} locations in "${input.path}" — it must be unique. ` +
        `Include more surrounding context (a few extra lines above/below) so the anchor pins exactly one spot.`,
    };
  }

  let next = content.replace(input.old_str, input.new_str);

  // Header injection (when context is available and file type supports it)
  if (ctx) {
    const syntax = getCommentSyntax(input.path);
    if (syntax) {
      const meta = await incrementFileVersion(root, input.path, ctx.taskId, ctx.subtaskId);
      const injected = injectVersionHeader(next, syntax, meta);
      next = injected.content;
    }
  }

  try {
    await fs.writeFile(full, next, "utf8");
    await upsertEntry(root, path.relative(root, full));
    return { ok: true, relPath: input.path, replaced: true };
  } catch (e) {
    return { ok: false, code: "io_error", error: (e as Error).message };
  }
}
