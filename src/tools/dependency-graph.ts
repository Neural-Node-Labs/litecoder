// xcoder:version 6 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:41:56.324Z | xcoder:subtask code-st-cd4444
import { promises as fs } from "node:fs";
import path from "node:path";
import { getOrBuildIndex, toPosixPath, type WorkspaceIndex } from "./workspace-index.js";
import { resolveInWorkspace } from "./patch-tools.js";
import { scanFile } from "./ast-tools.js";
import { tokenize } from "./ast-tools.js";

export interface DependencyGraphResultOk {
  ok: true;
  relPath: string;
  imports: Array<{ specifier: string; resolved: string | null; isExternal: boolean }>;
  importers: string[];
  parseMethod: "regex" | "tokenizer" | "none";
  note?: string;
}

export type DependencyGraphResult =
  | DependencyGraphResultOk
  | { ok: false; code: "file_not_found" | "workspace_escape" | "unsupported"; error: string };

interface ImportIndex {
  builtAt: string;
  /** relPath (posix) → resolved local file paths (posix) that it imports. */
  importsByFile: Map<string, string[]>;
}

const memo = new Map<string, ImportIndex>();

const EXT_IMPORTABLE = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".go", ".java", ".rs", ".rb",
]);

function guessScanLanguages(relPath: string): "typescript" | "javascript" | "python" | "none" {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".py")) return "python";
  return "none";
}

/**
 * Best-effort import index over `WorkspaceIndex.entries`, memoized by index
 * `builtAt` so repeated calls in one run don't re-scan the tree.
 */
async function buildImportIndex(root: string, index: WorkspaceIndex): Promise<ImportIndex> {
  const cached = memo.get(index.builtAt);
  if (cached) return cached;

  const importsByFile = new Map<string, string[]>();
  for (const entry of index.entries) {
    if (!EXT_IMPORTABLE.has(path.extname(entry.relPath))) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(root, entry.relPath), "utf8");
    } catch {
      continue;
    }
    const lang = guessScanLanguages(entry.relPath);
    let specifiers: string[] = [];
    if (lang === "typescript" || lang === "javascript") {
      const scan = scanFile(content, lang);
      if (!("ok" in scan)) {
        specifiers = scan.imports;
      } else {
        specifiers = regexImports(content);
      }
    } else if (lang === "python") {
      specifiers = regexImports(content);
    }
    importsByFile.set(
      entry.relPath,
      specifiers
        .map((s) => resolveSpecifier(s, entry.relPath, index) ?? s)
        .filter((s) => s !== "")
    );
  }

  const built: ImportIndex = { builtAt: index.builtAt, importsByFile };
  memo.set(index.builtAt, built);
  return built;
}

/** Regex fallback for non-TS/JS: Python `import x` / `from y import z`, etc. */
function regexImports(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Converts an import specifier to a relative path candidates list (TS/JS only). */
function resolveSpecifier(specifier: string, fromFile: string, index: WorkspaceIndex): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const fromDir = path.posix.dirname(fromFile);
    const candidates = [
      specifier,
      `${specifier}.ts`, `${specifier}.tsx`, `${specifier}.js`, `${specifier}.jsx`,
      `${specifier}/index.ts`, `${specifier}/index.tsx`, `${specifier}/index.js`, `${specifier}/index.jsx`,
    ];
    for (const c of candidates) {
      const joined = toPosixPath(path.posix.normalize(path.posix.join(fromDir === "." ? "" : fromDir, c)));
      if (index.entries.some((e) => e.relPath === joined)) return joined;
    }
    return null;
  }
  return null; // bare specifier = external package
}

/**
 * get_dependency_graph — imports + importers for one file, best-effort.
 * Never throws: unknown extensions (or unparseable files) return typed
 * `unsupported`, missing files `file_not_found`.
 */
export async function getDependencyGraphTool(root: string, relPath: string): Promise<DependencyGraphResult> {
  let full: string;
  try {
    full = resolveInWorkspace(root, relPath);
  } catch (e) {
    return { ok: false, code: "workspace_escape", error: (e as Error).message };
  }

  const index = await getOrBuildIndex(root);
  const posix = toPosixPath(relPath).replace(/^\.\//, "");
  if (!index.entries.some((e) => e.relPath === posix)) {
    return {
      ok: false,
      code: "file_not_found",
      error: `"${relPath}" is not in the workspace index. Use write_file to create it, or search the index for the right path.`,
    };
  }

  const ext = path.extname(posix).toLowerCase();
  const lang = guessScanLanguages(posix);
  if (lang === "none" && !EXT_IMPORTABLE.has(ext)) {
    return {
      ok: false,
      code: "unsupported",
      error: `get_dependency_graph has no import scanner for "${ext}" files — supported: TS/JS/Python. Fall back to grep/read_file.`,
    };
  }

  let content: string;
  try {
    content = await fs.readFile(full, "utf8");
  } catch (e) {
    return { ok: false, code: "file_not_found", error: (e as Error).message };
  }

  let specifiers: string[] = [];
  let parseMethod: "regex" | "tokenizer" | "none" = "none";
  if (lang === "typescript" || lang === "javascript") {
    const scan = scanFile(content, lang);
    if (!("ok" in scan)) {
      specifiers = scan.imports;
      parseMethod = "tokenizer";
    } else {
      specifiers = regexImports(content);
      parseMethod = "regex";
    }
  } else {
    specifiers = regexImports(content);
    parseMethod = "regex";
  }

  const imports = specifiers.map((specifier) => ({
    specifier,
    resolved: resolveSpecifier(specifier, posix, index),
    isExternal: !specifier.startsWith(".") && !specifier.startsWith("/"),
  }));

  const note =
    content.includes("import(") || content.includes("require(")
      ? "dynamic imports (import()/require()) are documented, not resolved."
      : undefined;

  // Importers: files whose resolved import set includes this file.
  const impIndex = await buildImportIndex(root, index);
  const importers: string[] = [];
  for (const [fromFile, fromImports] of impIndex.importsByFile) {
    if (fromFile === posix) continue;
    if (fromImports.includes(posix)) importers.push(fromFile);
  }

  return { ok: true, relPath: posix, imports, importers, parseMethod: parseMethod, note };
}
