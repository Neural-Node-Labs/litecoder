// xcoder:version 17 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:39:47.708Z | xcoder:subtask code-st-cd4444
import { promises as fs } from "node:fs";
import path from "node:path";
import { upsertEntry } from "./workspace-index.js";
import { resolveInWorkspace, hashFile } from "./patch-tools.js";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import { incrementFileVersion } from "../store/file-version-store.js";

/**
 * A small, dependency-free tokenizer + scope tracker for TypeScript and
 * JavaScript, powering `read_outline`, `search_ast`, `update_function`,
 * `rename_symbol`, and the TS/JS import extraction used by
 * `get_dependency_graph`.
 *
 * Deliberately NOT a full parser and NOT type-aware (tradeoff T1): it
 * tokenizes identifiers / strings / templates / comments / punctuation,
 * tracks brace nesting to delimit scopes and function bodies, and records
 * declarations and identifier references. Exotic edge cases (destructuring
 * with shadowing, hoisting, complex generics) may mis-scope, but every
 * failure path returns a typed `parse_error`, never silent corruption.
 */

export const MAX_SCAN_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  "function", "class", "const", "let", "var", "interface", "type", "import",
  "export", "from", "return", "if", "else", "for", "while", "do", "switch",
  "case", "default", "new", "typeof", "instanceof", "in", "of", "async",
  "await", "yield", "extends", "implements", "enum", "namespace", "declare",
  "abstract", "public", "private", "protected", "static", "readonly", "get",
  "set", "void", "null", "undefined", "true", "false", "this", "super",
  "break", "continue", "throw", "try", "catch", "finally", "delete", "with",
  "debugger", "as", "satisfies", "keyof", "infer", "is", "any", "unknown",
  "never", "string", "number", "boolean", "symbol", "bigint", "object",
  "module", "require", "global", "NaN", "Infinity", "constructor",
]);

export type TokenType =
  | "identifier"
  | "string"
  | "template"
  | "comment"
  | "punct"
  | "number";

export interface Token {
  type: TokenType;
  value: string;
  line: number; // 1-based
  startCol: number; // 0-based
  endCol: number; // exclusive
  offset: number; // absolute char offset
}

/**
 * Tokenizes into a small vocabulary. Handles line/block comments, quoted
 * strings with escapes, template literals (incl. nested ${}), numbers,
 * identifiers, and single-char punctuation. Returns `{ error }` on
 * unterminated constructs instead of throwing.
 */
export function tokenize(content: string): { tokens: Token[] } | { error: string } {
  const tokens: Token[] = [];
  const n = content.length;
  let i = 0;
  let line = 1;
  let col = 0;

  const advance = (by: number): void => {
    for (let k = 0; k < by && i < n; k++) {
      if (content[i] === "\n") {
        line++;
        col = 0;
      } else {
        col++;
      }
      i++;
    }
  };

  const push = (type: TokenType, value: string, startLine: number, startCol: number, startOffset: number): void => {
    tokens.push({ type, value, line: startLine, startCol, endCol: col, offset: startOffset });
  };

  while (i < n) {
    const ch = content[i];
    const startLine = line;
    const startCol = col;
    const startOffset = i;

    if (/\s/.test(ch)) {
      advance(1);
      continue;
    }

    if (ch === "/" && content[i + 1] === "/") {
      let end = i + 2;
      while (end < n && content[end] !== "\n") end++;
      advance(end - i);
      push("comment", content.slice(startOffset, end), startLine, startCol, startOffset);
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      if (close === -1) return { error: "unterminated block comment" };
      const end = close + 2;
      advance(end - i);
      push("comment", content.slice(startOffset, end), startLine, startCol, startOffset);
      continue;
    }

    if (ch === "'" || ch === '"') {
      let end = i + 1;
      let closed = false;
      while (end < n) {
        if (content[end] === "\\") {
          end += 2;
          continue;
        }
        if (content[end] === ch) {
          end++;
          closed = true;
          break;
        }
        if (content[end] === "\n") break;
        end++;
      }
      if (!closed) return { error: "unterminated string literal" };
      advance(end - i);
      push("string", content.slice(startOffset, end), startLine, startCol, startOffset);
      continue;
    }

    if (ch === "`") {
      let end = i + 1;
      let depth = 0;
      let closed = false;
      while (end < n) {
        if (content[end] === "\\") {
          end += 2;
          continue;
        }
        if (content[end] === "$" && content[end + 1] === "{") {
          depth++;
          end += 2;
          continue;
        }
        if (content[end] === "}" && depth > 0) {
          depth--;
          end++;
          continue;
        }
        if (content[end] === "`") {
          end++;
          closed = true;
          break;
        }
        if (content[end] === "\n" && depth === 0) break;
        end++;
      }
      if (!closed) return { error: "unterminated template literal" };
      advance(end - i);
      push("template", content.slice(startOffset, end), startLine, startCol, startOffset);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(content[i + 1] ?? ""))) {
      let end = i + 1;
      while (end < n && /[0-9a-zA-Z_.]/.test(content[end])) end++;
      advance(end - i);
      push("number", content.slice(startOffset, end), startLine, startCol, startOffset);
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < n && /[A-Za-z0-9_$]/.test(content[end])) end++;
      advance(end - i);
      push("identifier", content.slice(startOffset, end), startLine, startCol, startOffset);
      continue;
    }

    advance(1);
    push("punct", ch, startLine, startCol, startOffset);
  }

  return { tokens };
}

// ---------------------------------------------------------------------------
// Scanner / scope tracker
// ---------------------------------------------------------------------------

export interface ScopeDecl {
  name: string;
  kind: "function" | "class" | "const" | "let" | "var" | "param" | "interface" | "type";
  startLine: number;
  startCol: number;
  endLine: number;
  /** Internal: brace depth at declaration — used by shadowing-aware resolution. */
  depth?: number;
}

export interface ScanResult {
  language: "typescript" | "javascript";
  imports: string[];
  declarations: ScopeDecl[];
  references: Array<{ name: string; startLine: number; startCol: number; endCol: number }>;
  parseError?: string;
}

export type ScanFileResult = ScanResult | { ok: false; error: string };

interface ScopeFrame {
  depth: number;
  decls: ScopeDecl[];
}

/**
 * Tokenizes + scans TS/JS source for imports, declarations, and identifier
 * references. Single pass with an explicit brace-depth scope stack. Never
 * throws: all failure modes fold into a typed `{ ok: false, error }` or a
 * `parseError` on the result.
 */
export function scanFile(content: string, language: "typescript" | "javascript"): ScanFileResult {
  const tok = tokenize(content);
  if ("error" in tok) return { ok: false, error: tok.error };
  const { tokens } = tok;

  const imports: string[] = [];
  const declarations: ScopeDecl[] = [];
  const references: ScanResult["references"] = [];
  const referenceOffsets: number[] = [];
  let parseError: string | undefined;

  // Offsets that must NOT be treated as references (decl names, bindings, params).
  const nonRefOffsets = new Set<number>();

  let braceDepth = 0;
  const scopeStack: ScopeFrame[] = [{ depth: 0, decls: [] }];
  const currentScope = (): ScopeFrame => scopeStack[scopeStack.length - 1];

  // Set when a declaration header has been seen and its body `{` is pending.
  // `openDepth` is the brace depth AFTER the body `{` was pushed, so the
  // body closes only when the matching `}` pops that exact depth — return
  // type annotations like `: { ok: boolean }` never close it prematurely.
  interface PendingBody {
    decl: ScopeDecl;
    seenOpenBrace: boolean;
    openDepth: number;
    /** Token index of the parameter list's closing `)` — the body `{` must come after this. */
    paramCloseIdx: number;
  }
  let pendingBodyDecl: PendingBody | null = null;

  /** Finds the index of the `)` that closes the parameter list starting after `openParenIdx`. */
  const findParamClose = (openParenIdx: number): number => {
    let depth = 0;
    for (let j = openParenIdx; j < tokens.length; j++) {
      if (tokens[j].type !== "punct") continue;
      if (tokens[j].value === "(") depth++;
      else if (tokens[j].value === ")") {
        depth--;
        if (depth === 0) return j;
      }
    }
    return openParenIdx; // unbalanced — degrade to no restriction
  };
  let prevSignificant: Token | null = null;

  // Import-statement state.
  let inImportStatement = false;
  let importNeedsSpecifier = false;
  let importBracesDepth = 0;
  let pendingImportFrom = false;

  const registerDecl = (name: string, kind: ScopeDecl["kind"], startLine: number, startCol: number, endLine: number): void => {
    if (!name || KEYWORDS.has(name)) return;
    const decl: ScopeDecl = { name, kind, startLine, startCol, endLine, depth: braceDepth };
    declarations.push(decl);
    currentScope().decls.push(decl);
  };

  const pushRef = (t: Token): void => {
    references.push({ name: t.value, startLine: t.line, startCol: t.startCol, endCol: t.endCol });
    referenceOffsets.push(t.offset);
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    const next = tokens[idx + 1] ?? null;
    const prev = prevSignificant;

    // ── Braces / scopes ──
    if (t.type === "punct" && t.value === "{") {
      braceDepth++;
      scopeStack.push({ depth: braceDepth, decls: [] });
      // A declaration body's `{` must come after the param list's `)` and must
      // NOT be a type-annotation object (`: { ... }`, `Promise<{ ... }>`) —
      // those are preceded by `:` or `<` and are never a function body.
      const prevIsAnnotationStart =
        prev?.type === "punct" && (prev.value === ":" || prev.value === "<");
      if (
        pendingBodyDecl &&
        !pendingBodyDecl.seenOpenBrace &&
        idx > pendingBodyDecl.paramCloseIdx &&
        !prevIsAnnotationStart
      ) {
        pendingBodyDecl.seenOpenBrace = true;
        pendingBodyDecl.openDepth = braceDepth;
      }
      prevSignificant = t;
      continue;
    }
    if (t.type === "punct" && t.value === "}") {
      if (
        pendingBodyDecl &&
        pendingBodyDecl.seenOpenBrace &&
        pendingBodyDecl.openDepth === braceDepth
      ) {
        pendingBodyDecl.decl.endLine = t.line;
        pendingBodyDecl = null;
      }
      if (braceDepth === 0) {
        parseError = parseError ?? "unbalanced closing brace";
      } else {
        braceDepth--;
        scopeStack.pop();
      }
      prevSignificant = t;
      continue;
    }
    if (t.type === "punct" && t.value === ";") {
      importNeedsSpecifier = false;
      pendingImportFrom = false;
      prevSignificant = t;
      continue;
    }

    // ── arrow-function params: `a =>` and `(a, b) =>` ──
    if (t.type === "punct" && t.value === "=" && next && next.type === "punct" && next.value === ">") {
      const prevTok = tokens[idx - 1];
      if (prevTok && prevTok.type === "identifier" && !KEYWORDS.has(prevTok.value)) {
        nonRefOffsets.add(prevTok.offset);
        registerDecl(prevTok.value, "param", prevTok.line, prevTok.startCol, braceDepth);
      } else if (prevTok && prevTok.type === "punct" && prevTok.value === ")") {
        for (let j = idx - 2; j >= 0 && tokens[j].value !== "("; j--) {
          const tk = tokens[j];
          if (tk.type === "identifier" && !KEYWORDS.has(tk.value)) {
            const before = tokens[j - 1];
            if (!(before?.type === "punct" && before.value === ":")) {
              nonRefOffsets.add(tk.offset);
              registerDecl(tk.value, "param", tk.line, tk.startCol, braceDepth);
            }
          }
        }
      }
      prevSignificant = next;
      idx++; // consume the '>' token
      continue;
    }

    // ── Strings ──
    if (t.type === "string") {
      const inner = t.value.length >= 2 ? t.value.slice(1, -1) : t.value;
      if (inImportStatement && (pendingImportFrom || importBracesDepth === 0)) {
        imports.push(inner);
        inImportStatement = false;
        pendingImportFrom = false;
        importNeedsSpecifier = false;
        importBracesDepth = 0;
        prevSignificant = null;
        continue;
      }
      if (
        prev && prev.type === "punct" && prev.value === "(" &&
        tokens[idx - 2] && tokens[idx - 2].type === "identifier" &&
        (tokens[idx - 2].value === "require" || tokens[idx - 2].value === "import")
      ) {
        imports.push(inner);
      }
      prevSignificant = t;
      continue;
    }

    // ── import statements ──
    if (t.type === "identifier" && t.value === "import" && !inImportStatement) {
      inImportStatement = true;
      importNeedsSpecifier = false;
      importBracesDepth = 0;
      pendingImportFrom = false;
      prevSignificant = t;
      continue;
    }
    if (inImportStatement && t.type === "identifier") {
      if (t.value === "from") {
        pendingImportFrom = true;
        importNeedsSpecifier = false;
      } else if (t.value === "as" || t.value === "*") {
        // skip — handled naturally by the binding branch below
      } else {
        // Any other identifier inside an import clause is a local binding.
        nonRefOffsets.add(t.offset);
        registerDecl(t.value, "const", t.line, t.startCol, t.line);
      }
      prevSignificant = t;
      continue;
    }
    if (inImportStatement && t.type === "punct") {
      if (t.value === "{") {
        importBracesDepth = 1;
        importNeedsSpecifier = true;
      } else if (t.value === "}") {
        importBracesDepth = 0;
        importNeedsSpecifier = true;
      } else if (t.value === ",") {
        importNeedsSpecifier = true;
      }
      prevSignificant = t;
      continue;
    }

    // ── declarations ──
    if (t.type === "identifier") {
      const v = t.value;

      if (v === "function") {
        let nameTok = next;
        if (nameTok && nameTok.type === "punct" && nameTok.value === "*") {
          nameTok = tokens[idx + 2] ?? null;
        }
        if (nameTok && nameTok.type === "identifier" && !KEYWORDS.has(nameTok.value)) {
          nonRefOffsets.add(nameTok.offset);
          const decl: ScopeDecl = {
            name: nameTok.value, kind: "function",
            startLine: nameTok.line, startCol: nameTok.startCol,
            endLine: t.line, depth: braceDepth,
          };
          declarations.push(decl);
          currentScope().decls.push(decl);
          pendingBodyDecl = { decl, seenOpenBrace: false, openDepth: 0, paramCloseIdx: idx };
          prevSignificant = t;
          continue;
        }
      }

      if (v === "class") {
        const nameTok = next;
        if (nameTok && nameTok.type === "identifier" && !KEYWORDS.has(nameTok.value)) {
          nonRefOffsets.add(nameTok.offset);
          const decl: ScopeDecl = {
            name: nameTok.value, kind: "class",
            startLine: nameTok.line, startCol: nameTok.startCol,
            endLine: t.line, depth: braceDepth,
          };
          declarations.push(decl);
          currentScope().decls.push(decl);
          pendingBodyDecl = { decl, seenOpenBrace: false, openDepth: 0, paramCloseIdx: idx };
          prevSignificant = t;
          continue;
        }
      }

      if (v === "interface") {
        const nameTok = next;
        if (nameTok && nameTok.type === "identifier") {
          nonRefOffsets.add(nameTok.offset);
          const decl: ScopeDecl = {
            name: nameTok.value, kind: "interface",
            startLine: nameTok.line, startCol: nameTok.startCol,
            endLine: t.line, depth: braceDepth,
          };
          declarations.push(decl);
          currentScope().decls.push(decl);
          pendingBodyDecl = { decl, seenOpenBrace: false, openDepth: 0, paramCloseIdx: idx };
          prevSignificant = t;
          continue;
        }
      }

      if (v === "type") {
        const nameTok = next;
        if (nameTok && nameTok.type === "identifier") {
          nonRefOffsets.add(nameTok.offset);
          const decl: ScopeDecl = {
            name: nameTok.value, kind: "type",
            startLine: nameTok.line, startCol: nameTok.startCol,
            endLine: t.line, depth: braceDepth,
          };
          declarations.push(decl);
          currentScope().decls.push(decl);
          prevSignificant = t;
          continue;
        }
      }

      if (v === "const" || v === "let" || v === "var") {
        const kind = v as "const" | "let" | "var";
        const first = next;
        if (first && first.type === "identifier" && !KEYWORDS.has(first.value)) {
          nonRefOffsets.add(first.offset);
          registerDecl(first.value, kind, first.line, first.startCol, t.line);
        } else if (first && first.type === "punct" && (first.value === "{" || first.value === "[")) {
          const open = first.value;
          const close = open === "{" ? "}" : "]";
          let depth = 0;
          let k = idx + 1;
          for (; k < tokens.length; k++) {
            const tk = tokens[k];
            if (tk.type === "punct") {
              if (tk.value === open) depth++;
              else if (tk.value === close && depth > 0) {
                depth--;
                if (depth === 0) break;
              }
            } else if (tk.type === "identifier" && !KEYWORDS.has(tk.value)) {
              const before = tokens[k - 1];
              if (!(before?.type === "punct" && before.value === ":")) {
                nonRefOffsets.add(tk.offset);
                registerDecl(tk.value, kind, tk.line, tk.startCol, t.line);
              }
            }
          }
        }
        prevSignificant = t;
        continue;
      }

      // ── function parameters: `function name(a, b)` ──
      if (prev && prev.type === "punct" && prev.value === "(") {
        const beforeParen = tokens[idx - 2];
        const isFunctionParens =
          beforeParen?.type === "identifier" &&
          (beforeParen.value === "function" ||
            (tokens[idx - 3]?.type === "identifier" && tokens[idx - 3].value === "function"));
        if (isFunctionParens) {
          nonRefOffsets.add(t.offset);
          registerDecl(v, "param", t.line, t.startCol, braceDepth);
          prevSignificant = t;
          continue;
        }
      }

      // ── plain identifier: reference or declaration-handling above ──
      if (!KEYWORDS.has(v) && !nonRefOffsets.has(t.offset) && !inImportStatement) {
        const isPropAccess = prev?.type === "punct" && prev.value === ".";
        const isObjectKey =
          prev?.type === "punct" && (prev.value === "{" || prev.value === ",") &&
          next?.type === "punct" && (next.value === ":" || next.value === "?");
        if (!isPropAccess && !isObjectKey) {
          pushRef(t);
        }
      }
      prevSignificant = t;
      continue;
    }

    // Arrow detection lives inside the identifier branch above (t.value === "=").
    // Non-identifier tokens: track but otherwise ignore.
    prevSignificant = t;
  }

  // A declaration whose body never closed still carries a usable start.
  if (pendingBodyDecl) {
    pendingBodyDecl.decl.endLine = tokens.length ? tokens[tokens.length - 1].line : pendingBodyDecl.decl.endLine;
  }

  // Drop any reference that ended up being a param/declaration after all
  // (e.g. arrow params collected on `=>` after the identifier was pushed).
  const kept: ScanResult["references"] = [];
  for (let i = 0; i < referenceOffsets.length; i++) {
    if (!nonRefOffsets.has(referenceOffsets[i])) kept.push(references[i]);
  }

  return { language, imports, declarations, references: kept, parseError };
}

// ---------------------------------------------------------------------------
// Shadowing-aware reference resolution (AC-10 / AC-14)
// ---------------------------------------------------------------------------

export interface RefToken {
  name: string;
  startLine: number;
  startCol: number;
  endCol: number;
}

/**
 * Resolves a reference to the innermost visible declaration with the same
 * name. Shadowing-aware: a declaration at a deeper brace depth wins over an
 * outer one; among declarations at the same depth, the most recent one seen
 * before the reference wins. Returns null when nothing is visible.
 */
export function resolveReference(ref: RefToken, decls: ScopeDecl[]): ScopeDecl | null {
  const sameName = decls.filter((d) => d.name === ref.name && d.startLine <= ref.startLine);
  if (sameName.length === 0) return null;

  sameName.sort((a, b) => {
    const dA = a.depth ?? 0;
    const dB = b.depth ?? 0;
    if (dA !== dB) return dB - dA;
    return b.startLine - a.startLine;
  });

  return sameName[0];
}

/**
 * Returns the unique declaration for `name` or a typed failure. Used by
 * update_function / rename_symbol to enforce the no-match / not-unique
 * contract before any write happens.
 */
export function findUniqueDeclaration(
  name: string,
  decls: ScopeDecl[],
  kinds?: Set<string>
): { ok: true; decl: ScopeDecl } | { ok: false; code: "no_match" | "not_unique"; error: string; candidates?: number[] } {
  const matches = decls.filter((d) => d.name === name && (!kinds || kinds.has(d.kind)));
  if (matches.length === 0) {
    return {
      ok: false,
      code: "no_match",
      error: `no declaration named "${name}" found${kinds ? ` (kind: ${[...kinds].join("/")})` : ""}. ` +
        `Search the file with search_ast or grep to confirm the exact name, then retry.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: "not_unique",
      error: `"${name}" is declared ${matches.length} times in this file — update_function/rename_symbol require a unique declaration. Candidate lines: ${matches.map((m) => m.startLine).join(", ")}. Use a more specific path or rename the shadowing declarations first.`,
      candidates: matches.map((m) => m.startLine),
    };
  }
  return { ok: true, decl: matches[0] };
}

// ---------------------------------------------------------------------------
// search_ast (AC-10)
// ---------------------------------------------------------------------------

export interface SearchAstInput {
  query: string;
  pathGlob?: string;
}

export interface SearchAstMatch {
  file: string;
  kind: "function" | "class" | "call";
  name: string;
  startLine: number;
  endLine: number;
  signature: string;
  line: number;
}

export type SearchAstResult =
  | { ok: true; matches: SearchAstMatch[]; total: number; language: "typescript" | "javascript" | "mixed"; note?: string }
  | { ok: false; error: string; code: "unsupported_language" | "invalid_query" | "read_error" | "file_not_found" | "workspace_escape" };

const SEARCH_QUERY_RE = /^(function|class|call)\s+([A-Za-z_$][A-Za-z0-9_$]*)$/;

function guessJsLanguage(relPath: string): "typescript" | "javascript" | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  return null;
}

function signatureForLine(content: string, line: number): string {
  const lines = content.split("\n");
  return (lines[line - 1] ?? "").trim().slice(0, 200);
}

/**
 * Structural TS/JS search over the workspace. Supported queries:
 * - "function Name" → function declarations named Name
 * - "class Name"    → class declarations named Name
 * - "call Name"     → identifier references to Name (call sites), shadowing-aware
 * Uses the scanner — no regex false positives inside strings/comments.
 */
export async function searchAstTool(root: string, input: SearchAstInput): Promise<SearchAstResult> {
  const m = SEARCH_QUERY_RE.exec(input.query.trim());
  if (!m) {
    return {
      ok: false,
      code: "invalid_query",
      error: `search_ast query must be one of: "function <Name>", "class <Name>", "call <Name>" — got "${input.query}". Use grep for arbitrary regex searches.`,
    };
  }
  const [, kind, name] = m;

  const { globTool } = await import("./globTool.js");
  const { readFileTool } = await import("./fs-tools.js");
  const { getOrBuildIndex } = await import("./workspace-index.js");

  let files: string[];
  if (input.pathGlob && input.pathGlob.trim() !== "") {
    files = await globTool(input.pathGlob, root);
  } else {
    const index = await getOrBuildIndex(root);
    files = index.entries.map((e) => e.relPath).filter((p) => guessJsLanguage(p) !== null);
  }

  const matches: SearchAstMatch[] = [];
  const languages = new Set<string>();
  let scanned = 0;

  for (const file of files) {
    const lang = guessJsLanguage(file);
    if (!lang) continue;
    languages.add(lang);
    const read = await readFileTool(root, file);
    if (!read.ok) continue;
    if (Buffer.byteLength(read.content, "utf8") > MAX_SCAN_BYTES) continue;
    scanned++;

    const scan = scanFile(read.content, lang);
    if ("ok" in scan) continue;

    if (kind === "function") {
      for (const d of scan.declarations) {
        if (d.kind === "function" && d.name === name) {
          matches.push({
            file, kind: "function", name: d.name,
            startLine: d.startLine, endLine: d.endLine,
            signature: signatureForLine(read.content, d.startLine),
            line: d.startLine,
          });
        }
      }
    } else if (kind === "class") {
      for (const d of scan.declarations) {
        if (d.kind === "class" && d.name === name) {
          matches.push({
            file, kind: "class", name: d.name,
            startLine: d.startLine, endLine: d.endLine,
            signature: signatureForLine(read.content, d.startLine),
            line: d.startLine,
          });
        }
      }
    } else {
      const decls = scan.declarations.filter((d) => d.name === name);
      for (const ref of scan.references) {
        if (ref.name !== name) continue;
        if (resolveReference(ref, decls)) {
          matches.push({
            file, kind: "call", name,
            startLine: ref.startLine, endLine: ref.startLine,
            signature: signatureForLine(read.content, ref.startLine),
            line: ref.startLine,
          });
        }
      }
    }
  }

  return {
    ok: true,
    matches,
    total: matches.length,
    language: (languages.size === 0 ? "typescript" : languages.size === 1 ? [...languages][0] : "mixed") as "typescript" | "javascript" | "mixed",
    note: scanned === 0 ? "no supported TS/JS files matched — try a different pathGlob." : undefined,
  };
}

// ---------------------------------------------------------------------------
// update_function (AC-13)
// ---------------------------------------------------------------------------

export interface UpdateFunctionInput {
  path: string;
  functionName: string;
  newCode: string;
}

export type UpdateFunctionResult =
  | {
      ok: true;
      relPath: string;
      functionName: string;
      oldLineRange: [number, number];
      newLineRange: [number, number];
      sha1After: string;
    }
  | {
      ok: false;
      error: string;
      code: "no_match" | "not_unique" | "unsupported_language" | "parse_error" | "file_not_found" | "workspace_escape";
      candidates?: number[];
    };

/**
 * Whole-function rewrite (TS/JS only): replaces the declaration's line range
 * with `newCode`. Refuses when the name is not unique, when the file can't
 * be scanned, or for non-TS/JS files — never partial.
 */
export async function updateFunctionTool(
  root: string,
  input: UpdateFunctionInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<UpdateFunctionResult> {
  const lang = guessJsLanguage(input.path);
  if (!lang) {
    return {
      ok: false,
      code: "unsupported_language",
      error: `update_function supports TypeScript/JavaScript only — "${input.path}" is not a TS/JS file. Fall back to edit_file/line_patch/sed_tool for other languages.`,
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
      error: `"${input.path}" doesn't exist or can't be read. Use write_file to create it first.`,
    };
  }

  if (Buffer.byteLength(content, "utf8") > MAX_SCAN_BYTES) {
    return {
      ok: false,
      code: "parse_error",
      error: `"${input.path}" exceeds the ${MAX_SCAN_BYTES}-byte scan ceiling — use edit_file/line_patch with a tight range instead.`,
    };
  }

  const scan = scanFile(content, lang);
  if ("ok" in scan) {
    return { ok: false, code: "parse_error", error: `couldn't scan "${input.path}": ${scan.error}` };
  }
  if (scan.parseError) {
    return { ok: false, code: "parse_error", error: `scan of "${input.path}" reported: ${scan.parseError}. Fix the syntax issue or use edit_file instead.` };
  }

  const unique = findUniqueDeclaration(input.functionName, scan.declarations, new Set(["function", "class"]));
  if (!unique.ok) return { ...unique };
  const { decl } = unique;

  const lines = content.split("\n");
  const start = decl.startLine;
  const end = Math.max(decl.startLine, Math.min(decl.endLine, lines.length));
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);
  let next = [...before, ...input.newCode.split("\n"), ...after].join("\n");

  if (ctx) {
    const syntax = getCommentSyntax(input.path);
    if (syntax) {
      try {
        const meta = await incrementFileVersion(root, input.path, ctx.taskId, ctx.subtaskId);
        const injected = injectVersionHeader(next, syntax, meta);
        next = injected.content;
      } catch (e) {
        return { ok: false, error: (e as Error).message, code: "parse_error" };
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
      functionName: input.functionName,
      oldLineRange: [start, end],
      newLineRange: [start, start + input.newCode.split("\n").length - 1],
      sha1After,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "parse_error" };
  }
}

// ---------------------------------------------------------------------------
// rename_symbol (AC-14)
// ---------------------------------------------------------------------------

export interface RenameSymbolInput {
  path: string;
  name: string;
  newName: string;
}

export type RenameSymbolResult =
  | {
      ok: true;
      relPath: string;
      renames: Array<{ line: number; column: number; to: string }>;
      count: number;
      sha1After: string;
    }
  | {
      ok: false;
      error: string;
      code: "unsupported_language" | "no_match" | "not_unique" | "parse_error" | "file_not_found" | "workspace_escape";
      candidates?: number[];
    };

/**
 * Scope-aware identifier rename (TS/JS only): replaces exactly the
 * identifier tokens whose binding resolves to the declared symbol. Strings,
 * comments, template literals, and property access targets are never
 * touched. Blind sed is NOT used.
 */
export async function renameSymbolTool(
  root: string,
  input: RenameSymbolInput,
  ctx?: { taskId: string; subtaskId: string }
): Promise<RenameSymbolResult> {
  const lang = guessJsLanguage(input.path);
  if (!lang) {
    return {
      ok: false,
      code: "unsupported_language",
      error: `rename_symbol supports TypeScript/JavaScript only — "${input.path}" is not a TS/JS file. Use sed_tool for other languages (with careful boundaries).`,
    };
  }
  if (typeof input.newName !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.newName)) {
    return {
      ok: false,
      code: "no_match",
      error: `"${String(input.newName)}" is not a valid identifier. newName must be a plain identifier (letters, digits, _, $).`,
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
      error: `"${input.path}" doesn't exist or can't be read. Use write_file to create it first.`,
    };
  }

  if (Buffer.byteLength(content, "utf8") > MAX_SCAN_BYTES) {
    return {
      ok: false,
      code: "parse_error",
      error: `"${input.path}" exceeds the ${MAX_SCAN_BYTES}-byte scan ceiling — use sed_tool with precise boundaries instead.`,
    };
  }

  const scan = scanFile(content, lang);
  if ("ok" in scan) {
    return { ok: false, code: "parse_error", error: `couldn't scan "${input.path}": ${scan.error}` };
  }
  if (scan.parseError) {
    return { ok: false, code: "parse_error", error: `scan of "${input.path}" reported: ${scan.parseError}. Fix the syntax issue or use sed_tool instead.` };
  }

  const unique = findUniqueDeclaration(input.name, scan.declarations);
  if (!unique.ok) return { ...unique };

  const renames: Array<{ line: number; column: number; to: string }> = [];
  renames.push({ line: unique.decl.startLine, column: unique.decl.startCol, to: input.newName });

  for (const ref of scan.references) {
    if (ref.name !== input.name) continue;
    const resolved = resolveReference(ref, scan.declarations);
    if (resolved && resolved === unique.decl) {
      renames.push({ line: ref.startLine, column: ref.startCol, to: input.newName });
    }
  }

  if (renames.length === 0) {
    return {
      ok: false,
      code: "no_match",
      error: `"${input.name}" was declared but no rename targets were found — this is unexpected; re-check the file content.`,
    };
  }

  const lines = content.split("\n");
  const byLine = new Map<number, Array<{ column: number; to: string; length: number }>>();
  for (const r of renames) {
    const list = byLine.get(r.line) ?? [];
    list.push({ column: r.column, to: r.to, length: input.name.length });
    byLine.set(r.line, list);
  }

  for (const [lineNo, edits] of byLine) {
    const idx = lineNo - 1;
    const line = lines[idx] ?? "";
    const sorted = [...edits].sort((a, b) => b.column - a.column);
    let next = line;
    for (const edit of sorted) {
      next = next.slice(0, edit.column) + edit.to + next.slice(edit.column + edit.length);
    }
    lines[idx] = next;
  }
  let nextContent = lines.join("\n");

  if (ctx) {
    const syntax = getCommentSyntax(input.path);
    if (syntax) {
      try {
        const meta = await incrementFileVersion(root, input.path, ctx.taskId, ctx.subtaskId);
        const injected = injectVersionHeader(nextContent, syntax, meta);
        nextContent = injected.content;
      } catch (e) {
        return { ok: false, error: (e as Error).message, code: "parse_error" };
      }
    }
  }

  try {
    await fs.writeFile(full, nextContent, "utf8");
    await upsertEntry(root, path.relative(root, full));
    const sha1After = await hashFile(full);
    return {
      ok: true,
      relPath: path.relative(root, full).split(path.sep).join("/"),
      renames,
      count: renames.length,
      sha1After,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: "parse_error" };
  }
}
