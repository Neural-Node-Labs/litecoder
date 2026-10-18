// xcoder:version 9 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:55:07.172Z | xcoder:subtask code-st-cd4444
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInWorkspace } from "./patch-tools.js";
import { upsertEntry } from "./workspace-index.js";
import { truncateOutput } from "./fs-tools.js";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import { incrementFileVersion } from "../store/file-version-store.js";
import { createKooderPaths } from "../util/kooder-paths.js";

function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr });
    });
  });
}

/**
 * Walks up from `startDir` looking for a `.git` directory. Returns the repo
 * root or null. Mirrors the findUp pattern used for repo pinning elsewhere.
 */
async function findGitRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    try {
      await fs.access(path.join(dir, ".git"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// git_diff (AC-08)
// ---------------------------------------------------------------------------

export interface GitDiffInput {
  ref?: string;
  path?: string;
  rawDiff?: boolean;
}

export type GitDiffResult =
  | {
      ok: true;
      summary: string;
      entries: Array<{ file: string; added: number; removed: number; status: "added" | "modified" | "deleted" | "renamed" }>;
      hasDiff: boolean;
      statsOnly: boolean;
      rawDiff?: string;
      note?: string;
    }
  | { ok: false; code: "not_a_git_repo" | "git_error"; error: string; stderr?: string };

const STAT_LINE_RE = /^\s*(\S+)\s+\|\s+(\d+)\s+([+\-*]+)?\s*$/;

/**
 * Low-token diff summary by default (`git diff --stat`). Pass `rawDiff: true`
 * to get the full unified diff (still capped by truncation). Summary-first is
 * the cheapest-first default (T5).
 */
export async function gitDiffTool(root: string, input: GitDiffInput = {}): Promise<GitDiffResult> {
  const cwd = path.resolve(root);
  const repoRoot = await findGitRoot(cwd);
  if (!repoRoot) {
    return {
      ok: false,
      code: "not_a_git_repo",
      error: `no git repository found from "${root}" upward — git_diff works inside a git repo. Use git_log/read_file/read_outline on the workspace files instead.`,
    };
  }

  if (input.ref && input.ref.trim().startsWith("-")) {
    return { ok: false, code: "git_error", error: `invalid ref "${input.ref}": refs must not start with '-'`, stderr: "" };
  }

  const args: string[] = [];
  if (input.rawDiff) {
    args.push("diff");
    if (input.ref && input.ref.trim() !== "") args.push(input.ref);
    if (input.path && input.path.trim() !== "") {
      args.push("--", input.path.replace(/\\/g, "/"));
    }
  } else {
    args.push("diff", "--stat");
    if (input.ref && input.ref.trim() !== "") args.push(input.ref);
    if (input.path && input.path.trim() !== "") {
      args.push("--", input.path.replace(/\\/g, "/"));
    }
  }

  const res = await run("git", args, repoRoot);
  if (!res.ok) {
    return { ok: false, code: "git_error", error: `git ${args[0]} failed: ${res.stderr.trim() || "unknown git error"}`, stderr: res.stderr };
  }

  const raw = res.stdout;
  if (input.rawDiff) {
    const capped = truncateOutput(raw, 4000);
    return {
      ok: true,
      summary: capped.text.includes("\n") ? capped.text.split("\n")[0] : capped.text,
      entries: [],
      hasDiff: raw.trim() !== "",
      statsOnly: false,
      rawDiff: capped.text,
      note: capped.truncated ? capped.note : undefined,
    };
  }

  // Parse the --stat output into entries.
  const lines = raw.split("\n");
  const entries: Array<{ file: string; added: number; removed: number; status: "added" | "modified" | "deleted" | "renamed" }> = [];
  const dirs = new Set<string>();
  for (const line of lines) {
    if (line.trim() === "" || line.includes("files changed") || line.includes("file changed")) continue;
    const m = STAT_LINE_RE.exec(line);
    if (m) {
      const file = m[1].replace(/\|.*$/, "").trim();
      const added = (m[3]?.match(/\+/g) ?? []).length;
      const removed = (m[3]?.match(/-/g) ?? []).length;
      const status: "added" | "modified" | "deleted" | "renamed" = line.includes("|") ? "modified" : "modified";
      entries.push({ file, added, removed, status });
    } else if (/^\s*\S+\s*\|/.test(line)) {
      // A path with a rename `->` or a mode-change line — best-effort capture.
      const file = line.split("|")[0].trim();
      if (file && !file.startsWith(" ")) entries.push({ file, added: 0, removed: 0, status: "renamed" });
    } else if (/^\s*[A-Za-z]:\\.*/.test(line) || line.trim().startsWith("dev/")) {
      dirs.add(line.trim());
    }
  }

  const capped = truncateOutput(raw, 4000);
  return {
    ok: true,
    summary: capped.text,
    entries,
    hasDiff: raw.trim() !== "",
    statsOnly: true,
    note: capped.truncated ? capped.note : undefined,
  };
}

// ---------------------------------------------------------------------------
// git_log (AC-08)
// ---------------------------------------------------------------------------

export interface GitLogInput {
  path?: string;
  maxCount?: number;
}

export type GitLogResult =
  | {
      ok: true;
      commits: Array<{ hash: string; shortHash: string; author: string; date: string; subject: string }>;
      truncated: boolean;
      truncationNote?: string;
    }
  | { ok: false; code: "not_a_git_repo" | "git_error"; error: string; stderr?: string };

export async function gitLogTool(root: string, input: GitLogInput): Promise<GitLogResult> {
  const cwd = path.resolve(root);
  const repoRoot = await findGitRoot(cwd);
  if (!repoRoot) {
    return {
      ok: false,
      code: "not_a_git_repo",
      error: `no git repository found from "${root}" upward — git_log works inside a git repo. Use read_file/read_outline on the workspace files instead.`,
    };
  }

  const maxCount = Math.min(Math.max(1, input.maxCount ?? 10), 100);
  const args = [
    "log",
    `--max-count=${maxCount}`,
    "--format=%H|%h|%an|%ad|%s",
    "--date=short",
  ];
  if (input.path && input.path.trim() !== "") {
    args.push("--", input.path.replace(/\\/g, "/"));
  }

  const res = await run("git", args, repoRoot);
  if (!res.ok) {
    return { ok: false, code: "git_error", error: `git log failed: ${res.stderr.trim() || "unknown git error"}`, stderr: res.stderr };
  }

  const commits = res.stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [hash, shortHash, author, date, ...subjectParts] = l.split("|");
      return { hash, shortHash, author, date, subject: subjectParts.join("|") };
    });

  const result: GitLogResult = {
    ok: true,
    commits: commits.slice(0, maxCount),
    truncated: commits.length > maxCount || commits.length === 0 ? false : commits.length === maxCount,
  };
  if (result.truncated && commits.length > maxCount) {
    result.truncationNote = `showing the most recent ${maxCount} commits — pass a larger "maxCount" (up to 100) for more.`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// apply_unified_diff (AC-12)
// ---------------------------------------------------------------------------

export interface ApplyUnifiedDiffInput {
  path: string;
  diff: string;
}

export type ApplyUnifiedDiffResult =
  | { ok: true; relPath: string; hunksApplied: number; linesChanged: number; sha1After: string }
  | {
      ok: false;
      error: string;
      code: "diff_check_failed" | "diff_apply_failed" | "file_not_found" | "workspace_escape" | "not_a_git_repo" | "no_diff_hunks";
      checkOutput?: string;
    };

/**
 * Applies a unified diff to a single file. Inside a git repo this uses
 * `git apply --check` (zero-writes on failure, full check output returned)
 * then `git apply`. Outside a repo it falls back to a small JS hunk parser
 * that splices the same way `line_patch` does (cross-platform — no `patch`
 * binary dependency).
 */
export async function applyUnifiedDiffTool(
  root: string,
  input: ApplyUnifiedDiffInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<ApplyUnifiedDiffResult> {
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
      error: `"${input.path}" doesn't exist or can't be read. Use write_file to create it first.`,
    };
  }

  const repoRoot = await findGitRoot(path.dirname(full));
  if (repoRoot) {
    // Work via a temp file so `git apply --check` (zero writes on failure) and
    // `git apply` both read the exact same bytes. Do NOT use `-` as the patch
    // path without piping stdin — execFile would leave git waiting on the pipe.
    const tmp = path.join(createKooderPaths(repoRoot).root, `tmp-apply-${Date.now()}.diff`);
    await fs.mkdir(path.dirname(tmp), { recursive: true });
    await fs.writeFile(tmp, input.diff, "utf8");
    try {
      const checkRes = await run("git", ["apply", "--check", path.relative(repoRoot, tmp)], repoRoot);
      if (!checkRes.ok) {
        return {
          ok: false,
          code: "diff_check_failed",
          error: `git apply --check rejected the diff — no changes were written. Fix the diff or re-read the file and regenerate it.`,
          checkOutput: checkRes.stderr.trim() || checkRes.stdout.trim(),
        };
      }
      const applyRes = await run("git", ["apply", path.relative(repoRoot, tmp)], repoRoot);
      if (!applyRes.ok) {
        return { ok: false, code: "diff_apply_failed", error: `git apply failed: ${applyRes.stderr.trim() || "unknown error"}` };
      }
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
    // Header injection + index refresh after git apply (ctx-aware).
    let finalContent: string;
    try {
      finalContent = await fs.readFile(full, "utf8");
    } catch {
      return { ok: false, code: "diff_apply_failed", error: "file unreadable after apply" };
    }
    let next = finalContent;
    if (ctx) {
      const syntax = getCommentSyntax(input.path);
      if (syntax) {
        const meta = await incrementFileVersion(root, input.path, ctx.taskId, ctx.subtaskId);
        const injected = injectVersionHeader(next, syntax, meta);
        next = injected.content;
        await fs.writeFile(full, next, "utf8");
      }
    }
    await upsertEntry(root, path.relative(root, full));
    const sha1After = await (await import("./patch-tools.js")).hashFile(full);
    const hunks = (input.diff.match(/^@@/gm) ?? []).length;
    const changes = (input.diff.match(/^[+-](?![+-])/gm) ?? []).length;
    return {
      ok: true,
      relPath: path.relative(root, full).split(path.sep).join("/"),
      hunksApplied: hunks,
      linesChanged: changes,
      sha1After,
    };
  }

  // ── Non-repo fallback: JS hunk parser + line splice ──
  const parsed = parseUnifiedDiff(input.diff);
  if (!parsed.ok) return { ok: false, code: "no_diff_hunks", error: parsed.error, checkOutput: undefined };
  const lines = content.split("\n");
  let changed = 0;
  // Apply hunks bottom-up against ORIGINAL line numbers so earlier hunks
  // don't shift the coordinates of later ones.
  const sortedHunks = [...parsed.hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const hunk of sortedHunks) {
    if (hunk.oldCount > 0) {
      const end = hunk.oldStart + hunk.oldCount - 1;
      if (hunk.oldStart < 1 || end > lines.length) {
        return {
          ok: false,
          code: "no_diff_hunks",
          error: `hunk covers old lines ${hunk.oldStart}..${end}, but the file only has ${lines.length} lines — the diff is stale.`,
        };
      }
    } else if (hunk.oldStart !== 0 && (hunk.oldStart < 1 || hunk.oldStart > lines.length + 1)) {
      return {
        ok: false,
        code: "no_diff_hunks",
        error: `insert hunk at line ${hunk.oldStart} is outside the file's ${lines.length} lines — the diff is stale.`,
      };
    }
    const before = lines.slice(0, hunk.oldStart === 0 ? 0 : hunk.oldStart - 1);
    const after = lines.slice(hunk.oldStart === 0 ? 0 : hunk.oldStart - 1 + hunk.oldCount);
    lines.length = 0;
    lines.push(...before, ...hunk.lines, ...after);
    changed += hunk.addedCount + hunk.removedCount;
  }
  let next = lines.join("\n");

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
    const sha1After = await (await import("./patch-tools.js")).hashFile(full);
    return {
      ok: true,
      relPath: path.relative(root, full).split(path.sep).join("/"),
      hunksApplied: parsed.hunks.length,
      linesChanged: changed,
      sha1After,
    };
  } catch (e) {
    return { ok: false, code: "diff_apply_failed", error: (e as Error).message };
  }
}

interface ParsedHunk {
  /** 1-based position of the hunk in the ORIGINAL file (0 for a pure insertion before line 1). */
  oldStart: number;
  /** Number of original-file lines the hunk covers (context + removed). */
  oldCount: number;
  /** 1-based position of the hunk in the NEW file. */
  newStart: number;
  /** Replacement lines: unchanged context plus `+` lines (without their prefix). */
  lines: string[];
  addedCount: number;
  removedCount: number;
}

/** Minimal unified-diff parser for a single file: `@@ -a,b +c,d @@` + ` `, `+`, `-` lines. */
function parseUnifiedDiff(
  diff: string
): { ok: true; hunks: ParsedHunk[] } | { ok: false; error: string } {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;

  for (const rawLine of diff.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkHeader) {
      if (current) hunks.push(current);
      const oldStart = Number(hunkHeader[1]);
      const oldCount = hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]);
      const newStart = Number(hunkHeader[3]);
      current = {
        oldStart,
        oldCount,
        newStart,
        lines: [],
        addedCount: 0,
        removedCount: 0,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) {
      current.lines.push(line.slice(1));
      current.addedCount++;
    } else if (line.startsWith("-")) {
      // Removed lines are NOT copied into the replacement; they are covered by
      // the old-side splice extent (oldStart + oldCount).
      current.removedCount++;
    } else if (line.startsWith(" ")) {
      current.lines.push(line.slice(1));
    }
    // '\\ No newline at end of file' and 'diff --git' header lines are ignored.
  }
  if (current) hunks.push(current);

  if (hunks.length === 0) {
    return { ok: false, error: "no hunks found — the diff must contain @@ hunk headers" };
  }
  return { ok: true, hunks };
}
