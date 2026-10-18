import type { HeaderMeta } from "../store/file-version-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommentSyntax = { open: string; close?: string };

export interface InjectResult {
  content: string;
  isNew: boolean;
}

// ---------------------------------------------------------------------------
// Extension → comment syntax lookup
// ---------------------------------------------------------------------------

function ext(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.slice(lastDot).toLowerCase();
}

// prettier-ignore
const LINE_COMMENT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".css", ".scss", ".less",
  ".java", ".swift", ".kt", ".kts", ".go", ".rs",
  ".php",
]);

// prettier-ignore
const HASH_COMMENT_EXTS = new Set([
  ".py", ".pyi", ".pyx",
  ".sh", ".bash", ".zsh",
  ".yaml", ".yml",
  ".toml",
  ".rb", ".rbs",
  ".pl", ".pm",
  ".cfg", ".conf", ".ini",
  ".gitignore", ".dockerignore",
  ".env", ".env.local", ".env.example",
]);

const HTML_COMMENT_EXTS = new Set([".html", ".htm", ".md", ".mdx"]);

// prettier-ignore
const SQL_COMMENT_EXTS = new Set([".sql", ".psql"]);

// Special filenames (no extension or non-standard ext)
const HASH_COMMENT_NAMES = new Set(["dockerfile", "makefile", "gemfile", "rakefile"]);

/**
 * Returns the comment markers and whether the file type supports headers.
 * Maps extensions: .ts/.js/.tsx/.jsx/.css/.scss/.less → //
 * .py/.sh/.yaml/.yml/.toml/Dockerfile/.env → #
 * .html/.md/.mdx → <!-- --> pair
 * .sql → --
 * .json → null (skipped)
 * Unknown extensions → null (skipped)
 */
export function getCommentSyntax(filePath: string): CommentSyntax | null {
  const e = ext(filePath);
  const name = filePath.split("/").pop()?.split("\\").pop()?.toLowerCase() ?? "";

  // JSON files: no comment support — skip headers entirely
  if (e === ".json") return null;

  // Binary / image / audio / video: skip
  if (
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".ico",
      ".webp",
      ".bmp",
      ".mp3",
      ".wav",
      ".ogg",
      ".mp4",
      ".webm",
      ".avi",
      ".mov",
      ".zip",
      ".tar",
      ".gz",
      ".rar",
      ".7z",
      ".pdf",
      ".woff",
      ".woff2",
      ".ttf",
      ".eot",
      ".lock",
    ].includes(e)
  )
    return null;

  if (LINE_COMMENT_EXTS.has(e)) return { open: "//" };
  if (HASH_COMMENT_EXTS.has(e) || HASH_COMMENT_NAMES.has(name)) return { open: "#" };
  if (HTML_COMMENT_EXTS.has(e)) return { open: "<!--", close: "-->" };
  if (SQL_COMMENT_EXTS.has(e)) return { open: "--" };

  // Unknown extension: skip headers (conservative)
  return null;
}

// ---------------------------------------------------------------------------
// Header construction / parsing
// ---------------------------------------------------------------------------

/**
 * Build a single-line xcoder version header using the given comment syntax.
 *
 * Format per syntax:
 *   // xcoder:version 3 | xcoder:task TASK-001 | xcoder:updated 2026-01-23... | xcoder:subtask design-st-7bec8f
 *   # xcoder:version 3 | xcoder:task TASK-001 | xcoder:updated 2026-01-23... | xcoder:subtask design-st-7bec8f
 *   <!-- xcoder:version 3 | xcoder:task TASK-001 | xcoder:updated 2026-01-23... | xcoder:subtask design-st-7bec8f -->
 *   -- xcoder:version 3 | xcoder:task TASK-001 | xcoder:updated 2026-01-23... | xcoder:subtask design-st-7bec8f
 */
function buildHeaderLine(syntax: CommentSyntax, meta: HeaderMeta): string {
  const payload = `xcoder:version ${meta.version} | xcoder:task ${meta.taskId} | xcoder:updated ${meta.timestamp} | xcoder:subtask ${meta.subtaskId}`;
  if (syntax.close) {
    return `${syntax.open} ${payload} ${syntax.close}`;
  }
  return `${syntax.open} ${payload}`;
}

/**
 * Regex that detects a xcoder version header line in any comment syntax.
 * Matches lines like:
 *   // xcoder:version 3 | ...
 *   # xcoder:version 1 | ...
 *   <!-- xcoder:version 5 | ... -->
 *   -- xcoder:version 2 | ...
 */
const XCODER_HEADER_RE = /^\s*\S*\s*xcoder:version\s+\d+/m;

/**
 * Builds a version header block and prepends it to content. If content
 * already begins with a xcoder header block, updates the existing one
 * (version+1, new task/subtask/timestamp). Uses regex to detect xcoder
 * headers. Returns new content and a flag indicating if this was a new
 * header or an update.
 */
export function injectVersionHeader(
  content: string,
  syntax: CommentSyntax,
  meta: HeaderMeta
): InjectResult {
  const newLine = buildHeaderLine(syntax, meta);

  // Check if a xcoder header already exists
  const match = content.match(XCODER_HEADER_RE);
  if (match) {
    // Extract the full matched line (up to the next newline)
    const matchIndex = match.index!;
    const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
    const lineEnd = content.indexOf("\n", matchIndex);
    const fullLine =
      lineEnd === -1 ? content.slice(lineStart) : content.slice(lineStart, lineEnd);

    // Replace the old header line with the new one
    const before = content.slice(0, lineStart);
    const after = lineEnd === -1 ? "" : content.slice(lineEnd);
    return { content: before + newLine + after, isNew: false };
  }

  // No existing header: prepend at top
  // If the file starts with a shebang, insert the header line right after it
  if (content.startsWith("#!")) {
    const shebangEnd = content.indexOf("\n");
    if (shebangEnd !== -1) {
      return {
        content: content.slice(0, shebangEnd + 1) + newLine + "\n" + content.slice(shebangEnd + 1),
        isNew: true,
      };
    }
  }

  // Prepend the header line at the very top
  return { content: newLine + "\n" + content, isNew: true };
}
