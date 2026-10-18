// xcoder:version 2 | xcoder:task task-456d3f | xcoder:updated 2026-08-03T15:41:37.782Z | xcoder:subtask code-st-97a4d4
import { promises as fs } from "node:fs";
import { resolveInWorkspaceSafe } from "./workspace-path.js";
import path from "node:path";
import { getOrBuildIndex, upsertEntry, toPosixPath } from "./workspace-index.js";
import { indexGlobTool } from "./search-tools.js";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import { incrementFileVersion } from "../store/file-version-store.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface SedToolInput {
  /** Single file path, workspace-relative. */
  path?: string;

  /** Glob pattern resolved against the workspace index. */
  glob?: string;

  operation: "substitute" | "delete" | "deleteRange" | "insert" | "appendAfter";

  /** Regex pattern (for substitute, delete, appendAfter). */
  pattern?: string;

  /** Replacement string for substitute. Supports $1, $2, $& back-references. */
  replacement?: string;

  /**
   * Regex flags. Whitelist: g, i, m, s only.
   * - g: global (replace all matches)
   * - i: case-insensitive
   * - m: multiline (^/$ match line boundaries)
   * - s: dotall (. matches \n)
   */
  flags?: string;

  /** 1-indexed inclusive start line for deleteRange. Must be >= 1. */
  startLine?: number;

  /** 1-indexed inclusive end line for deleteRange. Must be >= startLine. */
  endLine?: number;

  /** The line of text to insert/append. */
  text?: string;

  /**
   * Line number to insert after (insert only).
   * 0 = insert at the very beginning (before line 1).
   * N = insert after line N.
   * If afterLine exceeds the file's line count, text is appended at end.
   */
  afterLine?: number;

  /**
   * When true: apply transformation, return the would-be output in the result,
   * but DO NOT write to disk. Default: false (write to disk).
   */
  dryRun?: boolean;
}

export interface SedFileResult {
  /** Workspace-relative path of the file that was (or would be) modified. */
  relPath: string;

  /** True if the operation actually changed the file content. */
  matched: boolean;

  /** Number of changes made. */
  changes: number;

  /**
   * The full transformed file content.
   * Present ONLY when `dryRun: true`. Not included in write-mode responses.
   */
  output?: string;
}

export type SedToolResult =
  | {
      ok: true;
      results: SedFileResult[];
    }
  | {
      ok: false;
      code:
        | "file_not_found"
        | "workspace_escape"
        | "invalid_regex"
        | "invalid_operation"
        | "no_target"
        | "io_error";
      error: string;
    };

// ── Constants ────────────────────────────────────────────────────────────

const ALLOWED_FLAGS = new Set(["g", "i", "m", "s"]);
const MAX_PATTERN_LENGTH = 500;

// ── Helpers ──────────────────────────────────────────────────────────────

class WorkspaceEscapeError extends Error {}

function resolveInWorkspace(root: string, relPath: string): string {
  return resolveInWorkspaceSafe(root, relPath, (m) => new WorkspaceEscapeError(m));
}

// ── Input Validation ─────────────────────────────────────────────────────

type LineEndingStyle = "CRLF" | "LF" | "mixed";

/**
 * Validate the SedToolInput before processing.
 * Returns an error string if invalid, null if valid.
 */
function validateInput(input: SedToolInput): string | null {
  // Operation must be valid
  const validOps = ["substitute", "delete", "deleteRange", "insert", "appendAfter"];
  if (!validOps.includes(input.operation)) {
    return `invalid_operation: "${input.operation}" is not a valid operation. Must be one of: ${validOps.join(", ")}`;
  }

  // Target: glob takes precedence, then path, then neither → no_target
  const hasPath = input.path !== undefined && input.path !== "";
  const hasGlob = input.glob !== undefined && input.glob !== "";
  if (!hasPath && !hasGlob) {
    return "no_target: neither 'path' nor 'glob' was provided. Provide at least one target.";
  }

  // Operation-specific validation
  switch (input.operation) {
    case "substitute":
      if (input.pattern === undefined || input.pattern === "") {
        return "invalid_operation: 'substitute' requires a 'pattern' field.";
      }
      if (input.replacement === undefined) {
        return "invalid_operation: 'substitute' requires a 'replacement' field.";
      }
      break;
    case "delete":
      if (input.pattern === undefined || input.pattern === "") {
        return "invalid_operation: 'delete' requires a 'pattern' field.";
      }
      break;
    case "deleteRange":
      if (input.startLine === undefined || input.endLine === undefined) {
        return "invalid_operation: 'deleteRange' requires both 'startLine' and 'endLine'.";
      }
      if (!Number.isInteger(input.startLine) || input.startLine < 1) {
        return "invalid_operation: 'startLine' must be an integer >= 1.";
      }
      if (!Number.isInteger(input.endLine) || input.endLine < 1) {
        return "invalid_operation: 'endLine' must be an integer >= 1.";
      }
      if (input.endLine < input.startLine) {
        return "invalid_operation: 'endLine' must be >= 'startLine'.";
      }
      break;
    case "insert":
      if (input.text === undefined) {
        return "invalid_operation: 'insert' requires a 'text' field.";
      }
      if (input.afterLine !== undefined && (!Number.isInteger(input.afterLine) || input.afterLine < 0)) {
        return "invalid_operation: 'afterLine' must be an integer >= 0.";
      }
      break;
    case "appendAfter":
      if (input.pattern === undefined || input.pattern === "") {
        return "invalid_operation: 'appendAfter' requires a 'pattern' field.";
      }
      if (input.text === undefined) {
        return "invalid_operation: 'appendAfter' requires a 'text' field.";
      }
      break;
  }

  // Flags validation (if provided)
  if (input.flags !== undefined) {
    for (const ch of input.flags) {
      if (!ALLOWED_FLAGS.has(ch)) {
        return `invalid_regex: flag "${ch}" is not allowed. Allowed flags: ${[...ALLOWED_FLAGS].join("")}`;
      }
    }
  }

  // Regex validation (if pattern provided)
  if (input.pattern) {
    if (input.pattern.length > MAX_PATTERN_LENGTH) {
      return `invalid_regex: pattern is ${input.pattern.length} chars (max ${MAX_PATTERN_LENGTH}).`;
    }
    // Crude catastrophic-backtracking screen: a quantified group that itself contains a
    // quantifier, e.g. (a+)+  (.*)*  (\\w+\\s*)+ — the classic ReDoS shape.
    if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(input.pattern)) {
      return "invalid_regex: nested quantifiers (e.g. '(a+)+') risk catastrophic backtracking; simplify the pattern.";
    }
    try {
      new RegExp(input.pattern, input.flags ?? "");
    } catch (e) {
      return `invalid_regex: ${(e as Error).message}`;
    }
  }

  return null; // valid
}

// ── Target Resolution ────────────────────────────────────────────────────

/**
 * Resolve target files: glob takes precedence over path.
 */
async function resolveTargetFiles(
  root: string,
  input: SedToolInput
): Promise<string[]> {
  if (input.glob !== undefined && input.glob !== "") {
    const index = await getOrBuildIndex(root);
    const result = indexGlobTool(index, input.glob);
    return result.matches;
  }

  if (input.path !== undefined && input.path !== "") {
    return [input.path];
  }

  return [];
}

// ── Line Ending Detection & Normalization ────────────────────────────────

function detectLineEndings(content: string): LineEndingStyle {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  // Match LF not preceded by CR (pure LF lines)
  const lfOnlyCount = (content.match(/(?<!\r)\n/g) || []).length;

  if (crlfCount > 0 && lfOnlyCount === 0) return "CRLF";
  if (lfOnlyCount > 0 && crlfCount === 0) return "LF";
  if (crlfCount === 0 && lfOnlyCount === 0) return "LF"; // empty or single line without newline
  return "mixed";
}

function normalizeToLF(content: string, _style: LineEndingStyle): string {
  return content.replace(/\r\n/g, "\n");
}

function restoreLineEndings(normalized: string, style: LineEndingStyle): string {
  if (style === "CRLF") {
    return normalized.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  }
  return normalized;
}

// ── Operations ───────────────────────────────────────────────────────────

function buildRegex(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags);
}

/**
 * Replace back-reference placeholders in the replacement string.
 * Supports $& (full match), $1-$9 (capture groups), and $$ (literal $).
 */
function expandReplacement(
  replacement: string,
  match: string,
  ...groups: string[]
): string {
  return replacement.replace(/\$([&1-9]|\$)/g, (_, ref) => {
    if (ref === "&") return match;
    if (ref === "$") return "$";
    const idx = parseInt(ref, 10);
    return groups[idx - 1] ?? "$" + ref;
  });
}

function applySubstitute(
  lines: string[],
  pattern: string,
  replacement: string,
  flags: string
): { lines: string[]; changes: number } {
  const re = buildRegex(pattern, flags);
  let changes = 0;

  const result = lines.map((line) => {
    let changed = false;
    const newLine = line.replace(re, (...args) => {
      changed = true;
      const match = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      return expandReplacement(replacement, match, ...groups);
    });
    if (changed) changes++;
    return newLine;
  });

  return { lines: result, changes };
}

function applyDelete(
  lines: string[],
  pattern: string,
  flags: string
): { lines: string[]; changes: number } {
  const re = buildRegex(pattern, flags);
  let changes = 0;
  const result = lines.filter((line) => {
    const match = re.test(line);
    if (match) changes++;
    return !match;
  });
  return { lines: result, changes };
}

function applyDeleteRange(
  lines: string[],
  startLine: number,
  endLine: number
): { lines: string[]; changes: number } {
  const max = lines.length;
  const start = Math.max(1, startLine);
  const end = Math.min(max, endLine);

  if (start > max || end < start) {
    return { lines, changes: 0 };
  }

  const count = end - start + 1;
  const result = [...lines.slice(0, start - 1), ...lines.slice(end)];
  return { lines: result, changes: count };
}

function applyInsert(
  lines: string[],
  afterLine: number,
  text: string
): { lines: string[]; changes: number } {
  // afterLine 0 = before first line
  // Clamp: if afterLine > lines.length, append at end
  const pos = Math.min(afterLine, lines.length);
  const result = [...lines.slice(0, pos), text, ...lines.slice(pos)];
  return { lines: result, changes: 1 };
}

function applyAppendAfter(
  lines: string[],
  pattern: string,
  text: string,
  flags: string
): { lines: string[]; changes: number } {
  const re = buildRegex(pattern, flags);
  let changes = 0;
  const result: string[] = [];

  for (const line of lines) {
    result.push(line);
    if (re.test(line)) {
      result.push(text);
      changes++;
    }
  }

  return { lines: result, changes };
}

// ── Per-File Processing ──────────────────────────────────────────────────

async function processFile(
  root: string,
  relPath: string,
  input: SedToolInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<SedFileResult> {
  let full: string;
  try {
    full = resolveInWorkspace(root, relPath);
  } catch {
    return {
      relPath,
      matched: false,
      changes: 0,
      output: undefined,
    };
  }

  // Read file
  let content: string;
  try {
    content = await fs.readFile(full, "utf8");
  } catch {
    return {
      relPath,
      matched: false,
      changes: 0,
      output: undefined,
    };
  }

  // Detect and normalize line endings
  const lineEndingStyle = detectLineEndings(content);
  const normalized = normalizeToLF(content, lineEndingStyle);

  // Split into lines. A trailing empty string from split("\n") represents
  // a trailing newline in the file — we strip it before operating on
  // "real" lines (so line counts match user expectations), then re-add it
  // after the join so the file's trailing-newline convention is preserved.
  const rawLines = normalized.split("\n");
  const hasTrailingNewline = rawLines.length > 0 && rawLines[rawLines.length - 1] === "";
  const lines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines;

  // Apply operation
  let resultLines: string[];
  let changes: number;

  switch (input.operation) {
    case "substitute": {
      const r = applySubstitute(lines, input.pattern!, input.replacement!, input.flags ?? "g");
      resultLines = r.lines;
      changes = r.changes;
      break;
    }
    case "delete": {
      const r = applyDelete(lines, input.pattern!, input.flags ?? "");
      resultLines = r.lines;
      changes = r.changes;
      break;
    }
    case "deleteRange": {
      const r = applyDeleteRange(lines, input.startLine!, input.endLine!);
      resultLines = r.lines;
      changes = r.changes;
      break;
    }
    case "insert": {
      const r = applyInsert(lines, input.afterLine ?? lines.length, input.text!);
      resultLines = r.lines;
      changes = r.changes;
      break;
    }
    case "appendAfter": {
      const r = applyAppendAfter(lines, input.pattern!, input.text!, input.flags ?? "");
      resultLines = r.lines;
      changes = r.changes;
      break;
    }
    default:
      return { relPath, matched: false, changes: 0 };
  }

  // Rejoin and restore line endings. Preserve trailing newline convention.
  const joined = resultLines.join("\n") + (hasTrailingNewline ? "\n" : "");
  const outputContent = restoreLineEndings(joined, lineEndingStyle);
  const matched = changes > 0;

  // Dry run: return output but don't write
  if (input.dryRun) {
    return { relPath, matched, changes, output: outputContent };
  }

  // Write back (with optional header injection)
  try {
    let finalContent = outputContent;
    if (matched && ctx) {
      const syntax = getCommentSyntax(relPath);
      if (syntax) {
        const meta = await incrementFileVersion(root, relPath, ctx.taskId, ctx.subtaskId);
        const injected = injectVersionHeader(finalContent, syntax, meta);
        finalContent = injected.content;
      }
    }
    await fs.writeFile(full, finalContent, "utf8");
    await upsertEntry(root, path.relative(root, full));
    return { relPath, matched, changes };
  } catch {
    return { relPath, matched: false, changes: 0 };
  }
}

// ── Main Export ──────────────────────────────────────────────────────────

/**
 * Perform stream-editing operations on workspace files.
 * Supports substitute, delete, deleteRange, insert, and appendAfter operations.
 */
export async function sedTool(
  root: string,
  input: SedToolInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<SedToolResult> {
  // Validate input
  const validationError = validateInput(input);
  if (validationError) {
    const code = validationError.startsWith("no_target")
      ? "no_target"
      : validationError.startsWith("invalid_regex")
        ? "invalid_regex"
        : "invalid_operation";
    return { ok: false, code, error: validationError };
  }

  // Resolve target files
  let targetFiles: string[];
  try {
    targetFiles = await resolveTargetFiles(root, input);
  } catch (e) {
    return { ok: false, code: "io_error", error: `Failed to resolve target files: ${(e as Error).message}` };
  }

  if (targetFiles.length === 0) {
    const target = input.glob ? `glob "${input.glob}"` : `path "${input.path}"`;
    return {
      ok: false,
      code: "file_not_found",
      error: `No files matched ${target}. Check the pattern or run reindex_workspace to refresh the index.`,
    };
  }

  // When using a single path (not glob), verify the file actually exists
  // on disk before proceeding.
  if (!input.glob && input.path) {
    try {
      const full = resolveInWorkspace(root, input.path);
      try {
        await fs.access(full);
      } catch {
        return {
          ok: false,
          code: "file_not_found",
          error: `File "${input.path}" does not exist in the workspace.`,
        };
      }
    } catch {
      return {
        ok: false,
        code: "workspace_escape",
        error: `Path "${input.path}" resolves outside the workspace root.`,
      };
    }
  }

  // Process each file
  const results: SedFileResult[] = [];
  let workspaceEscape = false;

  for (const relPath of targetFiles) {
    // Check for workspace escape
    try {
      resolveInWorkspace(root, relPath);
    } catch {
      workspaceEscape = true;
      continue;
    }

    const posixPath = toPosixPath(relPath).replace(/^\.\//, "");

    try {
      const result = await processFile(root, posixPath, input, ctx);
      results.push(result);
    } catch {
      results.push({ relPath: posixPath, matched: false, changes: 0 });
    }
  }

  if (workspaceEscape && results.length === 0) {
    return {
      ok: false,
      code: "workspace_escape",
      error: `One or more target paths resolve outside the workspace root.`,
    };
  }

  return { ok: true, results };
}
