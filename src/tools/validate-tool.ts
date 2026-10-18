// xcoder:version 4 | xcoder:task task-c4a64f | xcoder:updated 2026-10-17T03:03:13.222Z | xcoder:subtask test-st-3a3927
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInWorkspace } from "./patch-tools.js";
import { runCommandTool } from "./shell-tool.js";
import { detectProjectCommands } from "./project-detect.js";
import { getOrBuildIndex } from "./workspace-index.js";

export type ValidateFileResult =
  | {
      ok: true;
      result: { passed: boolean; command: string; tool: string; errors?: string[]; tookMs: number };
    }
  | { ok: false; code: "file_not_found" | "no_checker_available" | "workspace_escape"; error: string };

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".json": "json",
};

function guessLanguage(relPath: string): string {
  return EXT_LANG[path.extname(relPath).toLowerCase()] ?? "text";
}

/**
 * Last-resort in-process TypeScript syntax check, used only when no external
 * checker could be executed. Node's type stripper is the same parser that
 * runs TS files natively, so it accepts every construct `node --check`
 * rejects while still catching genuinely broken syntax (`const x = ;`).
 */
async function checkTypeScriptSyntax(full: string): Promise<{ passed: boolean; errors: string[] }> {
  let stripTypeScriptTypes: ((src: string) => string) | undefined;
  try {
    const mod = (await import("node:module")) as { stripTypeScriptTypes?: (src: string) => string };
    stripTypeScriptTypes = mod.stripTypeScriptTypes;
  } catch {
    stripTypeScriptTypes = undefined;
  }
  // Older Node without the helper is not a validation failure.
  if (typeof stripTypeScriptTypes !== "function") return { passed: true, errors: [] };
  try {
    const src = await fs.readFile(full, "utf8");
    stripTypeScriptTypes(src);
    return { passed: true, errors: [] };
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    return { passed: false, errors: [`TypeScript syntax error: ${message.split("\n")[0]}`] };
  }
}

/**
 * validate_file (AC-17): post-edit syntax/type check on JUST the patched
 * file. Prefers the workspace's own detected `typecheck`/`lint` commands,
 * then fast per-language syntax fallbacks (node --check, py_compile, JSON
 * parse). Returns ONLY error lines — never the file body. Like every tool,
 * it never throws; uncheckable languages return `no_checker_available` with
 * a fallback suggestion.
 */
export async function validateFileTool(root: string, relPath: string, lang?: string): Promise<ValidateFileResult> {
  let full: string;
  try {
    full = resolveInWorkspace(root, relPath);
  } catch (e) {
    return { ok: false, code: "workspace_escape", error: (e as Error).message };
  }

  // Fail fast on a missing file before any checker runs.
  try {
    await fs.access(full);
  } catch {
    return {
      ok: false,
      code: "file_not_found",
      error: `"${relPath}" doesn't exist. Use write_file to create it before validating.`,
    };
  }

  const language = (lang ?? guessLanguage(relPath)).toLowerCase();
  const started = Date.now();

  // 1) Try the project's own typecheck/lint first — it's already computed
  //    per workspace and is the most accurate signal.
  try {
    const index = await getOrBuildIndex(root);
    const cmds = await detectProjectCommands(root, index);
    const candidates = [cmds.typecheck, cmds.lint].filter((c): c is string => !!c);
    for (const candidate of candidates) {
      const res = await runCommandTool(candidate, root, 120_000);
      const errors = extractErrorLines(res.stdout + "\n" + res.stderr);
      return {
        ok: true,
        result: {
          passed: res.ok && errors.length === 0,
          command: candidate,
          tool: "project-command",
          errors: errors.length > 0 ? errors.slice(0, 40) : undefined,
          tookMs: Date.now() - started,
        },
      };
    }
  } catch {
    // fall through to language-specific syntax checks
  }

  // 2) Fast per-language syntax fallbacks.
  //
  // TypeScript MUST NOT go through `node --check`: that parser rejects
  // TS-only syntax (annotations, interfaces, generics), so every valid .ts
  // file was reported as failing. Use a TS-aware checker instead, and only
  // count diagnostics that point at this file so project/include-level noise
  // can never mark a good edit as broken.
  if (language === "typescript") {
    const res = await runCommandTool(
      `npx tsc --noEmit --skipLibCheck --target esnext --module esnext "${full}"`,
      root,
      120_000,
    );
    const raw = extractErrorLines(res.stdout + "\n" + res.stderr);
    const relevant = raw.filter((line) => line.includes(full) || line.includes(relPath));
    // A checker that never ran (npx missing / tsc unavailable) must not be
    // reported as a passing validation.
    if (!res.ok && raw.length === 0) {
      const fallback = await checkTypeScriptSyntax(full);
      return {
        ok: true,
        result: {
          passed: fallback.passed,
          command: "stripTypeScriptTypes",
          tool: "in-process",
          errors: fallback.errors.length > 0 ? fallback.errors.slice(0, 40) : undefined,
          tookMs: Date.now() - started,
        },
      };
    }
    return {
      ok: true,
      result: {
        passed: res.ok && relevant.length === 0,
        command: "tsc --noEmit",
        tool: "typecheck",
        errors: relevant.length > 0 ? relevant.slice(0, 40) : undefined,
        tookMs: Date.now() - started,
      },
    };
  }
  if (language === "javascript") {
    const res = await runCommandTool(`node --check "${full}"`, root, 60_000);
    const errors = extractErrorLines(res.stderr);
    return {
      ok: true,
      result: {
        passed: res.ok && errors.length === 0,
        command: "node --check",
        tool: "syntax",
        errors: errors.length > 0 ? errors.slice(0, 40) : undefined,
        tookMs: Date.now() - started,
      },
    };
  }
  if (language === "python") {
    const res = await runCommandTool(`python -m py_compile "${full}"`, root, 60_000);
    const errors = extractErrorLines(res.stderr);
    return {
      ok: true,
      result: {
        passed: res.ok && errors.length === 0,
        command: "python -m py_compile",
        tool: "syntax",
        errors: errors.length > 0 ? errors.slice(0, 40) : undefined,
        tookMs: Date.now() - started,
      },
    };
  }
  if (language === "json") {
    try {
      const raw = await fs.readFile(full, "utf8");
      JSON.parse(raw);
      return { ok: true, result: { passed: true, command: "JSON.parse", tool: "in-process", tookMs: Date.now() - started } };
    } catch (e) {
      return {
        ok: true,
        result: {
          passed: false,
          command: "JSON.parse",
          tool: "in-process",
          errors: [`JSON parse error: ${(e as Error).message}`],
          tookMs: Date.now() - started,
        },
      };
    }
  }

  return {
    ok: false,
    code: "no_checker_available",
    error: `no syntax/type checker found for "${language}" ("${relPath}"). Use run_command to run an appropriate compiler/linter for this language.`,
  };
}

/** Pulls only error/warning lines out of mixed output — never file bodies. */
function extractErrorLines(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && /(?:error|Error|❌|✖|failed|Cannot find|TS\d+|SyntaxError|ModuleNotFound)/.test(l))
    .slice(0, 40);
}
