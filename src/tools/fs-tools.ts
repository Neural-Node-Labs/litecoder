// xcoder:version 10 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:48:04.548Z | xcoder:subtask code-st-cd4444
import { promises as fs } from "node:fs";
import { resolveInWorkspaceSafe } from "./workspace-path.js";
import path from "node:path";
import {
  buildIndex,
  findInIndex,
  getOrBuildIndex,
  upsertEntry,
  toPosixPath,
  type WorkspaceIndex,
} from "./workspace-index.js";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import { incrementFileVersion } from "../store/file-version-store.js";
import { hashFile } from "./patch-tools.js";

export class WorkspaceEscapeError extends Error {}

/** Every path a tool touches is resolved and pinned inside the workspace root. No `..` escapes. */
function resolveInWorkspace(root: string, relPath: string): string {
  return resolveInWorkspaceSafe(root, relPath, (m) => new WorkspaceEscapeError(m));
}

export interface ReadFileResult {
  ok: true;
  content: string;
  relPath: string;
  totalLines?: number;
  /**
   * Full-file sha1 (only present on range reads). Stale-enforced write
   * tools (line_patch) require this — hash the file right before writing.
   */
  readSha1?: string;
}
export interface ReadFileError {
  ok: false;
  error: string;
  code: "file_not_found" | "workspace_escape" | "read_error";
}

/**
 * The workspace index is the source of truth for "what files exist". If a
 * requested path isn't in the index, this triggers exactly one automatic
 * reindex and retries — covering the common case (a file appeared via some
 * process outside Kooder, or the index is simply stale). If it's still not
 * found after that, the caller gets a typed `file_not_found`, not a crash.
 *
 * `startLine`/`endLine` (1-indexed, inclusive) let a large file be read in
 * slices instead of pulling the whole thing into context at once — pair
 * this with `edit_file` for surgical changes to files too big to safely
 * rewrite in full via `write_file`.
 */
export async function readFileTool(
  root: string,
  relPath: string,
  range?: { startLine?: number; endLine?: number }
): Promise<ReadFileResult | ReadFileError> {
  let full: string;
  try {
    full = resolveInWorkspace(root, relPath);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "workspace_escape" };
  }

  let index = await getOrBuildIndex(root);
  if (!findInIndex(index, relPath)) {
    index = await buildIndex(root); // one automatic reindex
    if (!findInIndex(index, relPath)) {
      return {
        ok: false,
        code: "file_not_found",
        error: `"${relPath}" is not in the workspace index even after a reindex. ` +
          `Either the path is wrong, or the file genuinely doesn't exist yet — ` +
          `consider whether this subtask should create it instead.`,
      };
    }
  }

  try {
    const raw = await fs.readFile(full, "utf8");
    if (!range || (range.startLine === undefined && range.endLine === undefined)) {
      return { ok: true, content: raw, relPath };
    }
    const lines = raw.split("\n");
    const start = Math.max(1, range.startLine ?? 1);
    const end = Math.min(lines.length, range.endLine ?? lines.length);
    const slice = lines.slice(start - 1, end).join("\n");
    const readSha1 = await hashFile(full);
    return { ok: true, content: slice, relPath, totalLines: lines.length, readSha1 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "read_error" };
  }
}

export interface WriteFileResult {
  ok: true;
  relPath: string;
  bytesWritten: number;
}
export interface WriteFileError {
  ok: false;
  error: string;
  code: "workspace_escape" | "write_error" | "file_too_large";
}

/**
 * write_file gate (AC-15): refuse whole-file rewrites above this many lines
 * unless the caller explicitly opts out with `force: true`. The refusal is
 * a steering signal — point the model at the surgical alternatives rather
 * than silently accepting a 900-line reproduce-the-whole-file risk.
 */
export const WRITE_FILE_LINE_CEILING = 200;

export async function writeFileTool(
  root: string,
  relPath: string,
  content: string,
  ctx?: { taskId: string; subtaskId: string },
  opts?: { force?: boolean }
): Promise<WriteFileResult | WriteFileError> {
  const lineCount = content.split("\n").length;
  if (lineCount > WRITE_FILE_LINE_CEILING && !opts?.force) {
    return {
      ok: false,
      code: "file_too_large",
      error: `content is ${lineCount} lines > ${WRITE_FILE_LINE_CEILING} ceiling. If this is a genuine full rewrite add force: true; otherwise prefer edit_file, line_patch, or update_function.`,
    };
  }
  let full: string;
  try {
    full = resolveInWorkspace(root, relPath);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "workspace_escape" };
  }
  try {
    // Header injection (when context is available and file type supports it)
    let finalContent = content;
    if (ctx) {
      const syntax = getCommentSyntax(relPath);
      if (syntax) {
        const meta = await incrementFileVersion(root, relPath, ctx.taskId, ctx.subtaskId);
        const injected = injectVersionHeader(finalContent, syntax, meta);
        finalContent = injected.content;
      }
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, finalContent, "utf8");
    await upsertEntry(root, path.relative(root, full)); // keep the index fresh incrementally
    return { ok: true, relPath, bytesWritten: Buffer.byteLength(content, "utf8") };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "write_error" };
  }
}

export interface ListDirResult {
  ok: true;
  entries: string[];
}

export async function listDirTool(index: WorkspaceIndex, relDir: string): Promise<ListDirResult> {
  const normalizedDir = toPosixPath(relDir);
  const prefix = normalizedDir === "" || normalizedDir === "." ? "" : normalizedDir.replace(/\/?$/, "/");
  const entries = index.entries
    .filter((e) => e.relPath.startsWith(prefix))
    .map((e) => e.relPath);
  return { ok: true, entries };
}

// ---------------------------------------------------------------------------
// Efficient-filesystem read tools (read_outline / read_multiple_files /
// read_full_file) + the shared truncation helper.
// ---------------------------------------------------------------------------

/**
 * Maximum characters for a single observation returned to the LLM. Every
 * growable new-tool output routes through `truncateOutput` — with an
 * actionable note naming that tool's narrowing parameter, never a silent
 * cutoff (AC-18).
 */
export const MAX_OBSERVATION_CHARS = 4000;

export function truncateOutput(
  text: string,
  maxChars: number = MAX_OBSERVATION_CHARS
): { text: string; truncated: boolean; note: string } {
  if (text.length <= maxChars) {
    return { text, truncated: false, note: "" };
  }
  const head = text.slice(0, Math.max(0, maxChars - 120));
  return {
    text: `${head}\n… [truncated: ${text.length} chars, showing first ${maxChars}]`,
    truncated: true,
    note: `output was truncated from ${text.length} chars to ${maxChars}. Narrow the result with that tool's range/path/maxCount parameters before retrying.`,
  };
}

// ---------------------------------------------------------------------------
// read_outline (AC-05)
// ---------------------------------------------------------------------------

export type ReadOutlineResult =
  | {
      ok: true;
      relPath: string;
      language: "typescript" | "javascript" | "text";
      lineCount: number;
      imports: string[];
      symbols: Array<{
        kind: "function" | "class" | "interface" | "type" | "const";
        name: string;
        startLine: number;
        endLine: number;
        signature: string;
        doc?: string;
      }>;
      body: string;
    }
  | {
      ok: false;
      error: string;
      code: "file_not_found" | "workspace_escape" | "unsupported_language" | "read_error";
    };

const CODE_EXT_LANG: Record<string, "typescript" | "javascript"> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

async function readFileRaw(root: string, relPath: string): Promise<{ ok: true; full: string; content: string } | { ok: false; error: string; code: "file_not_found" | "workspace_escape" | "read_error" }> {
  let full: string;
  try {
    full = resolveInWorkspace(root, relPath);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "workspace_escape" };
  }
  try {
    const content = await fs.readFile(full, "utf8");
    return { ok: true, full, content };
  } catch {
    return { ok: false, code: "file_not_found", error: `"${relPath}" doesn't exist or can't be read.` };
  }
}

/**
 * Structural skeleton read: imports, symbol signatures, docstrings, bodies
 * collapsed. The default first read for files over ~150 lines — far cheaper
 * than pulling the whole file into context. TS/JS uses the scanner in
 * ast-tools; other text files get a structural fallback (markdown headings,
 * `---` separators, first non-empty lines). Binary → unsupported_language.
 */
export async function readOutlineTool(root: string, relPath: string): Promise<ReadOutlineResult> {
  const raw = await readFileRaw(root, relPath);
  if (!raw.ok) return raw;

  const ext = path.extname(raw.full).toLowerCase();
  const codeLang = CODE_EXT_LANG[ext];
  const lineCount = raw.content.split("\n").length;

  // Binary / unsupported detection: NUL byte or unknown extension.
  if (raw.content.includes("\u0000")) {
    return {
      ok: false,
      code: "unsupported_language",
      error: `"${relPath}" appears to be a binary file. Use ` + "`read_file`" + ` with a line range for text, or run_command if it needs a specific tool.`,
    };
  }

  if (codeLang) {
    const { scanFile } = await import("./ast-tools.js");
    const scan = scanFile(raw.content, codeLang);
    if (!("ok" in scan) && !scan.parseError) {
      const symbols: Array<{
        kind: "function" | "class" | "interface" | "type" | "const";
        name: string;
        startLine: number;
        endLine: number;
        signature: string;
        doc?: string;
      }> = [];
      const lines = raw.content.split("\n");
      const outKind: Record<string, "function" | "class" | "interface" | "type" | "const"> = {
        function: "function",
        class: "class",
        interface: "interface",
        type: "type",
        const: "const",
        let: "const",
        var: "const",
      };
      for (const d of scan.declarations) {
        if (!outKind[d.kind]) continue;
        symbols.push({
          kind: outKind[d.kind],
          name: d.name,
          startLine: d.startLine,
          endLine: d.endLine,
          signature: (lines[d.startLine - 1] ?? "").trim().slice(0, 160),
          doc: lines[d.startLine - 2]?.trim().startsWith("//") ? lines[d.startLine - 2].trim() : undefined,
        });
      }
      // Collapse bodies: keep the skeleton, not the full content.
      let body = raw.content;
      if (lineCount > 150) {
        body = lines
          .map((line, i) => (scan.declarations.some((d) => i + 1 >= d.startLine && i + 1 <= Math.min(d.endLine, d.startLine + 2)) ? line : line.length > 80 ? line.slice(0, 80) + " …" : line))
          .join("\n");
        body = "… (outline collapsed: " + lineCount + " lines total; use read_file with a range for full sections) …\n" + body;
      }
      return {
        ok: true,
        relPath,
        language: codeLang,
        lineCount,
        imports: scan.imports.slice(0, 40),
        symbols,
        body,
      };
    }
    // Scanner failed — fall through to the structural text fallback.
  }

  // Structural text fallback for non-code files / scan failures.
  const lines = raw.content.split("\n");
  const head: string[] = [];
  for (const line of lines) {
    if (head.length >= 60) break;
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (/^(#{1,6}\s|[-*]\s|\d+\.\s|---)/.test(trimmed)) head.push(trimmed.slice(0, 120));
    else if (head.length < 20) head.push(trimmed.slice(0, 120));
  }
  const body = head.length < lineCount ? `… (${lineCount} lines total — use read_file with a range to see more) …\n` + head.join("\n") : head.join("\n");
  return {
    ok: true,
    relPath,
    language: "text",
    lineCount,
    imports: [],
    symbols: [],
    body,
  };
}

// ---------------------------------------------------------------------------
// read_multiple_files (AC-06)
// ---------------------------------------------------------------------------

export interface ReadMultipleFilesInput {
  files: Array<{ path: string; startLine?: number; endLine?: number }>;
  maxTotalChars?: number;
}

export type ReadMultipleFilesResult =
  | {
      ok: true;
      sections: Array<{
        label: string;
        content: string;
        totalLines: number;
        sliced: boolean;
      }>;
      totalChars: number;
      dropped: number;
      note?: string;
    }
  | { ok: false; error: string; code: "workspace_escape" | "invalid_files"; sections?: never };

/**
 * Batched, labeled section reads in ONE call — the replacement for N
 * separate read_file calls when building cross-file understanding. Parallel
 * (bounded to 8), each section labeled `--- path (lines a-b of N) ---`.
 * Over maxTotalChars (default 12000) tail sections are dropped with an
 * actionable note; never silently swallowed.
 */
export async function readMultipleFilesTool(root: string, input: ReadMultipleFilesInput): Promise<ReadMultipleFilesResult> {
  if (!Array.isArray(input.files) || input.files.length === 0) {
    return { ok: false, code: "invalid_files", error: "read_multiple_files requires a non-empty files[] array of { path, startLine?, endLine? }." };
  }
  const maxChars = input.maxTotalChars ?? 12_000;
  const results = await Promise.all(
    input.files.slice(0, 8).map(async (f) => {
      const read = await readFileTool(root, f.path, { startLine: f.startLine, endLine: f.endLine });
      return { f, read };
    })
  );

  const sections: Array<{
    label: string;
    content: string;
    totalLines: number;
    sliced: boolean;
  }> = [];
  let totalChars = 0;
  let dropped = 0;
  let truncated = false;

  for (const { f, read } of results) {
    if (!read.ok) {
      sections.push({ label: `--- ${f.path} (ERROR) ---`, content: read.error, totalLines: 0, sliced: false });
      continue;
    }
    const lines = read.content.split("\n");
    const posixPath = toPosixPath(f.path);
    const label = `--- ${posixPath} (lines ${f.startLine ?? 1}-${f.endLine ?? lines.length} of ${read.totalLines ?? lines.length}) ---`;
    const sectionText = `${label}\n${read.content}`;
    if (ceilBudgetExceeded(totalChars, sectionText.length, maxChars)) {
      truncated = true;
      dropped += 1;
      continue;
    }
    sections.push({
      label,
      content: read.content,
      totalLines: read.totalLines ?? lines.length,
      sliced: !!(f.startLine !== undefined || f.endLine !== undefined),
    });
    totalChars += sectionText.length;
  }

  const overBudget = input.files.length > 8;
  return {
    ok: true,
    sections: truncated || overBudget ? sections : sections.slice(0, Math.max(1, sections.length)),
    totalChars,
    dropped: dropped + (overBudget ? input.files.length - 8 : 0),
    note:
      truncated || overBudget
        ? `kept ${sections.length} of ${input.files.length} sections under the ${maxChars}-char maxTotalChars budget${overBudget ? " (max 8 files per call)" : ""}. Narrow each file with smaller startLine/endLine ranges or split the batch.`
        : undefined,
  };
}

function ceilBudgetExceeded(current: number, add: number, max: number): boolean {
  return current + add > max;
}

// ---------------------------------------------------------------------------
// read_full_file (AC-07)
// ---------------------------------------------------------------------------

export type ReadFullFileResult =
  | { ok: true; relPath: string; lineCount: number; content: string }
  | {
      ok: false;
      error: string;
      code: "file_not_found" | "workspace_escape" | "read_error" | "file_too_large";
    };

/** read_full_file refuses whole-file reads above this line count unless allowLarge is set. */
export const FULL_FILE_LINE_CEILING = 500;

/**
 * Gated whole-file read: refused above 500 lines unless `allowLarge: true`
 * explicitly opts in. The refusal names the cheaper alternative
 * (read_outline / read_file with a range) instead of silently auto-chunking.
 */
export async function readFullFileTool(root: string, relPath: string, allowLarge = false): Promise<ReadFullFileResult> {
  const raw = await readFileRaw(root, relPath);
  if (!raw.ok) return raw;
  const lineCount = raw.content.split("\n").length;
  if (lineCount > FULL_FILE_LINE_CEILING && !allowLarge) {
    return {
      ok: false,
      code: "file_too_large",
      error: `read_full_file refused: "${relPath}" is ${lineCount} lines > ${FULL_FILE_LINE_CEILING} ceiling. Use read_outline for the skeleton, read_file with a line range for sections, or pass allowLarge: true if you genuinely need the whole file.`,
    };
  }
  return { ok: true, relPath, lineCount, content: raw.content };
}
