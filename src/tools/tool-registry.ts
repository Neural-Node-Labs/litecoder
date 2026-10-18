// xcoder:version 7 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:30:55.130Z | xcoder:subtask code-st-1a0810
import { readFileTool, writeFileTool, listDirTool, readOutlineTool, readMultipleFilesTool, readFullFileTool } from "./fs-tools.js";
import { linePatchTool } from "./patch-tools.js";
import { gitDiffTool, gitLogTool, applyUnifiedDiffTool } from "./git-tools.js";
import { getDependencyGraphTool } from "./dependency-graph.js";
import { searchAstTool, updateFunctionTool, renameSymbolTool } from "./ast-tools.js";
import { validateFileTool } from "./validate-tool.js";
import { PROMPT_GUIDANCE } from "./prompt-guidance.js";
import { editFileTool } from "./edit-tool.js";
import { buildIndex, getOrBuildIndex, searchIndex } from "./workspace-index.js";
import { globTool } from "./globTool.js";
import { logFileAccess } from "../util/file-access-log.js";
import { grepTool } from "./grepTool.js";
import { testApiEndpoint } from "./apiTestTool.js";
import { scheduleCron, scheduleOnce, listScheduled, removeScheduled } from "./scheduleTool.js";
import { runCommandTool } from "./shell-tool.js";
import { runPlaywrightTool, runUiTest, type PlaywrightToolInput } from "./playwright-tool.js";
import { runBrowse, type BrowseInput } from "./browse-tool.js";
import { githubCreateRepo, githubClone, githubCommit, githubPush } from "./github-tool.js";
import { loadSkillTool, type LoadSkillInput } from "./load-skill-tool.js";
import { sedTool, type SedToolInput } from "./sed-tool.js";
import { crawlSiteMap, formatSiteMap } from "./siteCrawlerTool.js";

export interface ToolManifestEntry {
  name: string;
  description: string;
  inputHint: string;
}

export const TOOL_MANIFEST: ToolManifestEntry[] = [
  {
    name: "search_workspace",
    description: "Search the workspace index (the source of truth for what files exist) by path substring.",
    inputHint: '{ "query": "src/auth" }',
  },
  {
    name: "glob",
    description: "Pattern-match file paths in the workspace index using *, **, ? — no shell needed, works identically on every OS.",
    inputHint: '{ "pattern": "src/**/*.test.ts" }',
  },
  {
    name: "grep",
    description: "Search file CONTENTS across the workspace for a regex/string. Returns file, line number, and the matching line.",
    inputHint: '{ "pattern": "function login\\\\(", "pathGlob": "src/**/*.ts" }',
  },
  {
    name: "read_file",
    description: "Read a file relative to the workspace root. Auto-reindexes once and retries if the path isn't in the index. Supports an optional line range for large files.",
    inputHint: '{ "path": "src/auth/login.ts", "startLine": 1, "endLine": 200 }',
  },
  {
    name: "edit_file",
    description: "Surgically replace ONE exact, unique occurrence of old_str with new_str in an existing file — the accurate way to refactor part of a large file without rewriting the whole thing. old_str must match exactly once; if it matches 0 or 2+ times, widen it with more surrounding context and retry.",
    inputHint: '{ "path": "src/auth/login.ts", "old_str": "exact existing text, unique in the file", "new_str": "its replacement" }',
  },
  {
    name: "write_file",
    description: "Write (create or fully overwrite) a file relative to the workspace root. Prefer edit_file for changes to an existing file of any real size — write_file is for new files or genuinely full rewrites.",
    inputHint: '{ "path": "src/auth/login.ts", "content": "..." }',
  },
  {
    name: "list_dir",
    description: "List indexed files under a directory prefix.",
    inputHint: '{ "dir": "src" }',
  },
  {
    name: "reindex_workspace",
    description: "Force a full workspace reindex. Use if you suspect the index is stale after many of your own writes.",
    inputHint: "{}",
  },
  {
    name: "run_command",
    description: "Run a shell command from the workspace root (build, run tests, lint, type-check, start a dev server, reproduce a bug, etc.). Denylisted destructive patterns are refused. Mind the runtime-environment note in your system prompt — this may not be a unix shell.",
    inputHint: '{ "command": "npm test", "timeoutMs": 60000 }',
  },
  {
    name: "ui_test",
    description: "Run a Playwright browser test against a URL. Never pass a raw secret — pass a credentialRef (an environment variable name) instead.",
    inputHint: '{ "kind": "ui", "url": "https://...", "credentialRef": "STAGING_PASSWORD", "steps": [ { "op": "click", "selector": "#submit" } ] }',
  },
  {
    name: "browse",
    description: "Drive a real browser through steps and READ what is on the page (ops: goto, click, fill, type, press, select, check, hover, scroll, wait_for, wait, text, attr, links, title, url, back, forward, reload, screenshot, expect_text, expect_url, close). Returns per-step results, extracted text/links and the final page snapshot, so you can decide the next step. Only http(s) URLs (localhost ok; private networks blocked). Use `session` to stay logged in across calls. For passwords pass credentialRef (env var name), never the secret. Screenshots are saved inside the workspace.",
    inputHint: '{ "url": "http://localhost:3000", "session": "app", "steps": [ { "op": "fill", "selector": "#user", "value": "admin" }, { "op": "fill", "selector": "#pass", "credentialRef": "APP_PASSWORD" }, { "op": "click", "selector": "button[type=submit]" }, { "op": "text", "selector": "h1" }, { "op": "screenshot" } ] }',
  },
  {
    name: "api_test",
    description: "Send one HTTP request and assert on status/body. Never pass a raw secret — pass a credentialRef instead.",
    inputHint: '{ "kind": "api", "method": "GET", "url": "https://.../health", "expectStatus": 200 }',
  },
  {
    name: "load_skill",
    description: "Load the full bodies of external skill files (SKILL.md) by role or keyword. Use this when your task requires detailed process/strategy guidance that goes beyond the one-line summaries in your system prompt. Max 5 results for keyword.",
    inputHint: '{ "role": "tester" } or { "keyword": "penetration testing" }',
  },
  {
    name: "github_create_repo",
    description: "Create a new GitHub repository via the API. Requires a GITHUB_TOKEN env var (or a named credentialRef) — never pass a raw token.",
    inputHint: '{ "name": "my-repo", "private": true, "description": "..." }',
  },
  {
    name: "github_clone",
    description: "Clone a GitHub repository into a directory inside the workspace.",
    inputHint: '{ "url": "https://github.com/org/repo.git", "dir": "repo" }',
  },
  {
    name: "github_commit",
    description: "Stage and commit changes in a workspace directory (defaults to the workspace root).",
    inputHint: '{ "message": "fix: patch merges partial updates instead of overwriting" }',
  },
  {
    name: "github_push",
    description: "Push the current branch to a remote. Requires a GITHUB_TOKEN env var (or a named credentialRef) for an https remote — never pass a raw token.",
    inputHint: '{ "remote": "origin", "branch": "main" }',
  },
  {
    name: "sed_tool",
    description:
      "Perform stream-editing operations (substitute, delete, deleteRange, insert, appendAfter) " +
      "on workspace files using regex patterns. Supports multi-file glob, dry-run preview, " +
      "cross-platform line-ending preservation, and JS regex back-references ($1, $&) in replacements. " +
      "Use for bulk find/replace across many files — prefer edit_file for single surgical replacements.",
    inputHint: '{ "path": "src/config.ts", "operation": "substitute", "pattern": "oldValue", "replacement": "newValue", "flags": "g" }',
  },
  {
    name: "schedule",
    description:
      "Manage scheduled jobs — create recurring (cron) or one-off delayed commands, list existing jobs, " +
      "remove a job by id. POSIX uses cron; Windows uses schtasks.",
    inputHint: '{ "operation": "create_cron", "id": "my-job", "cronExpr": "0 9 * * *", "command": "npm run daily" }',
  },
  {
    name: "site_crawler",
    description: "Crawl a website starting from a URL and return a structured sitemap (tree format). Same-domain only. Respects maxPages and maxDepth limits.",
    inputHint: '{ "url": "https://example.com", "maxPages": 10, "maxDepth": 3, "format": "json" }',
  },
  {
    name: "read_outline",
    description:
      "Structural skeleton read (imports, signatures, docstrings, bodies collapsed) — the cheapest first read for files over ~150 lines. " +
      PROMPT_GUIDANCE.readFirst,
    inputHint: '{ "path": "src/auth/login.ts" }',
  },
  {
    name: "read_multiple_files",
    description:
      "Batched, labeled section reads in ONE call — prefer over N read_file calls for cross-file understanding. " +
      PROMPT_GUIDANCE.readFirst,
    inputHint: '{ "files": [{ "path": "src/a.ts", "startLine": 1, "endLine": 40 }], "maxTotalChars": 12000 }',
  },
  {
    name: "read_full_file",
    description:
      "Gated whole-file read — refused above 500 lines unless allowLarge: true. Prefer read_outline / read_file with a range for big files. " +
      PROMPT_GUIDANCE.readFirst,
    inputHint: '{ "path": "src/big.ts", "allowLarge": false }',
  },
  {
    name: "search_ast",
    description:
      "Structural TS/JS search (function/class/call targets) via the scanner — no regex false positives inside strings or comments. " +
      "For arbitrary regex search use grep instead.",
    inputHint: '{ "query": "function login", "pathGlob": "src/**/*.ts" }',
  },
  {
    name: "get_dependency_graph",
    description:
      "Imports + importers for one file, best-effort over the workspace index (TS/JS/Python). Cheaper than grepping import lines by hand.",
    inputHint: '{ "path": "src/auth/login.ts" }',
  },
  {
    name: "git_diff",
    description:
      "Low-token diff summary (git diff --stat by default). Pass rawDiff: true for the full unified diff. " +
      PROMPT_GUIDANCE.gitFirst,
    inputHint: '{ "ref": "HEAD~3", "path": "src/a.ts", "rawDiff": false }',
  },
  {
    name: "git_log",
    description:
      "Recent commit subjects for the workspace or a single file. " +
      PROMPT_GUIDANCE.gitFirst,
    inputHint: '{ "path": "src/a.ts", "maxCount": 10 }',
  },
  {
    name: "line_patch",
    description:
      "Stale-enforced line replacement: replaces lines [startLine..endLine] with newContent, refusing if the file changed since you read it. " +
      "Requires expectedSha1 from a prior read_file range read. " +
      PROMPT_GUIDANCE.editFirst,
    inputHint: '{ "path": "src/a.ts", "startLine": 10, "endLine": 12, "newContent": "...", "expectedSha1": "<from read>" }',
  },
  {
    name: "apply_unified_diff",
    description:
      "Apply a multi-hunk unified diff; inside a git repo it runs git apply --check first (zero writes on failure). " +
      PROMPT_GUIDANCE.editFirst,
    inputHint: '{ "path": "src/a.ts", "diff": "--- a/src/a.ts +++ b/src/a.ts @@ -1,3 +1,4 @@ ..." }',
  },
  {
    name: "update_function",
    description:
      "AST-scoped whole-function rewrite (TS/JS only) — replaces a unique function/class declaration's body range. " +
      PROMPT_GUIDANCE.editFirst,
    inputHint: '{ "path": "src/a.ts", "functionName": "login", "newCode": "export function login(...) {...}" }',
  },
  {
    name: "rename_symbol",
    description:
      "Scope-aware identifier rename (TS/JS only) — replaces only references that resolve to the declared symbol; strings/comments/templates untouched. " +
      "Never a blind sed.",
    inputHint: '{ "path": "src/a.ts", "name": "oldName", "newName": "newName" }',
  },
  {
    name: "validate_file",
    description:
      "Post-edit syntax/type check on just the patched file; returns ONLY error lines. " +
      PROMPT_GUIDANCE.validateAfterEdit,
    inputHint: '{ "path": "src/a.ts", "lang": "typescript" }',
  },
];

/**
 * Build the tool manifest array.
 *
 * A function rather than a mutable global so that the manifest is
 * immutable per call — testable and predictable. It takes no options:
 * the only conditional tool (`record_lesson`) was removed with the SDLC
 * stages, so every caller gets exactly the same 28-tool surface.
 */
export function buildToolManifest(): ToolManifestEntry[] {
  return TOOL_MANIFEST;
}

export interface ToolCallResult {
  tool: string;
  ok: boolean;
  output: unknown;
}

/**
 * Required top-level string fields per tool, checked BEFORE any case tries
 * to destructure `input`. This exists because of a real failure mode: the
 * model calling `glob` with no `input` key at all produced a raw
 * `Cannot destructure property 'pattern' of 'input' as it is undefined`
 * TypeError as the observation — technically caught (nothing crashed) but
 * useless to the model, which had no way to tell from that message what
 * shape was actually expected. This turns that into the same kind of
 * clear, actionable `file_not_found`/`no_match`-style error every other
 * tool already gives, quoting the tool's own manifest `inputHint`.
 */
const REQUIRED_STRING_FIELDS: Record<string, string[]> = {
  search_workspace: ["query"],
  glob: ["pattern"],
  grep: ["pattern"],
  read_file: ["path"],
  edit_file: ["path", "old_str", "new_str"],
  write_file: ["path", "content"],
  list_dir: ["dir"],
  run_command: ["command"],
  ui_test: ["kind", "url"],
  browse: ["steps"],
  api_test: ["url", "method"],
  schedule: ["operation"],
  site_crawler: ["url"],
  github_create_repo: ["name"],
  github_clone: ["url", "dir"],
  github_commit: ["message"],
  read_outline: ["path"],
  read_multiple_files: ["files"],
  read_full_file: ["path"],
  search_ast: ["query"],
  get_dependency_graph: ["path"],
  git_diff: [],
  git_log: ["path"],
  line_patch: ["path", "newContent", "expectedSha1"], // startLine/endLine are numeric — validated post-string in linePatchTool
  apply_unified_diff: ["path", "diff"],
  update_function: ["path", "functionName", "newCode"],
  rename_symbol: ["path", "name", "newName"],
  validate_file: ["path"],
};

function validateInput(toolName: string, input: unknown): string | null {
  const required = REQUIRED_STRING_FIELDS[toolName];
  if (!required) return null; // no declared requirements (e.g. reindex_workspace, github_push — all-optional)

  if (input === null || input === undefined || typeof input !== "object" || Array.isArray(input)) {
    const manifest = TOOL_MANIFEST.find((t) => t.name === toolName);
    return (
      `"${toolName}" requires an input object with ${required.map((f) => `"${f}"`).join(", ")} fields. ` +
      `Expected shape: ${manifest?.inputHint ?? "(see tool manifest)"}`
    );
  }

  const obj = input as Record<string, unknown>;
  const missing = required.filter((f) => {
    if (toolName === "read_multiple_files" && f === "files") {
      return !Array.isArray(obj[f]) || (obj[f] as unknown[]).length === 0;
    }
    return typeof obj[f] !== "string" || obj[f] === "";
  });
  if (missing.length) {
    const manifest = TOOL_MANIFEST.find((t) => t.name === toolName);
    return (
      `"${toolName}" is missing required field(s): ${missing.map((f) => `"${f}"`).join(", ")}. ` +
      `Expected shape: ${manifest?.inputHint ?? "(see tool manifest)"}`
    );
  }
  return null;
}

/**
 * The one place a subtask's tool call actually executes.
 * filesystem/shell action to this task's workspace — a subtask can never
 * reach outside it (see `fs-tools.ts`'s `resolveInWorkspace`).
 *
 * Every branch is wrapped in try/catch here in addition to the caller's own
 * try/catch (see `agents/sub-agent.ts`) — deliberate defense in depth: a
 * tool throwing should never bring down the Sub Agent's loop, and a Sub
 * Agent throwing should never bring down the Master Orchestrator (see
 * `orchestrator/swarm.ts`).
 */
export async function dispatchTool(
  root: string,
  toolName: string,
  input: unknown,
  ctx?: { taskId: string; subtaskId: string }
): Promise<ToolCallResult> {
  const result = await dispatchToolInner(root, toolName, input, ctx);
  // Every file / shell command any tool touched goes to files.log (with rollover).
  await logFileAccess(root, toolName, input, result.ok, ctx);
  return result;
}

async function dispatchToolInner(
  root: string,
  toolName: string,
  input: unknown,
  ctx?: { taskId: string; subtaskId: string }
): Promise<ToolCallResult> {
  const validationError = validateInput(toolName, input);
  if (validationError) {
    return { tool: toolName, ok: false, output: { error: validationError } };
  }

  try {
    switch (toolName) {
      case "search_workspace": {
        const { query } = input as { query: string };
        const index = await getOrBuildIndex(root);
        return { tool: toolName, ok: true, output: searchIndex(index, query) };
      }
      case "glob": {
        const { pattern } = input as { pattern: string };
        const matches = await globTool(pattern, root);
        return { tool: toolName, ok: true, output: { ok: true, matches } };
      }
      case "grep": {
        const { pattern, pathGlob, contextLines } = input as {
          pattern: string;
          pathGlob?: string;
          contextLines?: number;
        };
        const result =
          contextLines !== undefined
            ? await grepTool(pattern, pathGlob ?? "**/*", root, { contextLines })
            : await grepTool(pattern, pathGlob ?? "**/*", root);
        return { tool: toolName, ok: true, output: { ok: true, matches: result } };
      }
      case "read_file": {
        const { path, startLine, endLine } = input as { path: string; startLine?: number; endLine?: number };
        const result = await readFileTool(root, path, { startLine, endLine });
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "edit_file": {
        const { path, old_str, new_str } = input as { path: string; old_str: string; new_str: string };
        const result = await editFileTool(root, { path, old_str, new_str }, ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "write_file": {
        const { path, content, force } = input as { path: string; content: string; force?: boolean };
        const result =
          force === true
            ? await writeFileTool(root, path, content, ctx, { force: true })
            : await writeFileTool(root, path, content, ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "list_dir": {
        const { dir } = input as { dir: string };
        const index = await getOrBuildIndex(root);
        const result = await listDirTool(index, dir);
        return { tool: toolName, ok: true, output: result };
      }
      case "reindex_workspace": {
        const index = await buildIndex(root);
        return { tool: toolName, ok: true, output: { fileCount: index.entries.length, builtAt: index.builtAt } };
      }
      case "run_command": {
        const { command, timeoutMs } = input as { command: string; timeoutMs?: number };
        const result = await runCommandTool(command, root, timeoutMs);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "ui_test": {
        const uiInput = input as Parameters<typeof runUiTest>[0];
        const result = await runUiTest(uiInput);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "browse": {
        const result = await runBrowse(root, input as BrowseInput);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "api_test": {
        const { url, method, headers, body, bodyType, queryParams, maxBodyLength, timeout, expectStatus, expectBodyContains, credentialRef } = input as {
          url: string;
          method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
          headers?: Record<string, string>;
          body?: string | Record<string, unknown>;
          bodyType?: "json" | "text" | "form";
          queryParams?: Record<string, string>;
          maxBodyLength?: number;
          timeout?: number;
          expectStatus?: number;
          expectBodyContains?: string;
          credentialRef?: string;
        };
        try {
          const result = await testApiEndpoint({
            url, method, headers, body, bodyType, queryParams,
            maxBodyLength, timeout, expectStatus, expectBodyContains, credentialRef,
          });
          return { tool: toolName, ok: true, output: result };
        } catch (e) {
          return { tool: toolName, ok: false, output: { error: (e as Error).message } };
        }
      }
      case "github_create_repo": {
        const result = await githubCreateRepo(input as Parameters<typeof githubCreateRepo>[0]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "github_clone": {
        const result = await githubClone(root, input as Parameters<typeof githubClone>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "github_commit": {
        const result = await githubCommit(root, input as Parameters<typeof githubCommit>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "github_push": {
        const result = await githubPush(root, input as Parameters<typeof githubPush>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "sed_tool": {
        const result = await sedTool(root, input as SedToolInput, ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "load_skill": {
        const result = await loadSkillTool(input as LoadSkillInput, {});
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "schedule": {
        const schedInput = input as { operation: string; id?: string; cronExpr?: string; command?: string; delaySeconds?: number };
        const { operation } = schedInput;
        switch (operation) {
          case "create_cron": {
            if (!schedInput.id || !schedInput.cronExpr || !schedInput.command) {
              return { tool: toolName, ok: false, output: { error: `"schedule" "create_cron" requires fields: "id", "cronExpr", "command"` } };
            }
            const result = await scheduleCron(schedInput.id, schedInput.cronExpr, schedInput.command);
            return { tool: toolName, ok: true, output: result };
          }
          case "create_once": {
            if (schedInput.delaySeconds === undefined || !schedInput.command) {
              return { tool: toolName, ok: false, output: { error: `"schedule" "create_once" requires fields: "delaySeconds", "command"` } };
            }
            const result = await scheduleOnce(schedInput.delaySeconds, schedInput.command);
            return { tool: toolName, ok: true, output: result };
          }
          case "list": {
            const result = await listScheduled();
            return { tool: toolName, ok: true, output: result };
          }
          case "remove": {
            if (!schedInput.id) {
              return { tool: toolName, ok: false, output: { error: `"schedule" "remove" requires field: "id"` } };
            }
            const result = await removeScheduled(schedInput.id);
            return { tool: toolName, ok: true, output: result };
          }
          default:
            return { tool: toolName, ok: false, output: { error: `unknown schedule operation "${operation}". Expected: create_cron, create_once, list, remove.` } };
        }
      }
      case "site_crawler": {
        const { url, maxPages, maxDepth, format } = input as {
          url: string;
          maxPages?: number;
          maxDepth?: number;
          format?: "json" | "tree";
        };
        const sitemap = await crawlSiteMap(url, { maxPages, maxDepth });
        if (format === "tree") {
          const tree = formatSiteMap(sitemap);
          return { tool: toolName, ok: true, output: tree };
        }
        return { tool: toolName, ok: true, output: sitemap };
      }
      case "read_outline": {
        const { path } = input as { path: string };
        const result = await readOutlineTool(root, path);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "read_multiple_files": {
        const result = await readMultipleFilesTool(root, input as Parameters<typeof readMultipleFilesTool>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "read_full_file": {
        const { path, allowLarge } = input as { path: string; allowLarge?: boolean };
        const result = await readFullFileTool(root, path, allowLarge === true);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "search_ast": {
        const result = await searchAstTool(root, input as Parameters<typeof searchAstTool>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "get_dependency_graph": {
        const { path } = input as { path: string };
        const result = await getDependencyGraphTool(root, path);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "git_diff": {
        const result = await gitDiffTool(root, input as Parameters<typeof gitDiffTool>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "git_log": {
        const result = await gitLogTool(root, input as Parameters<typeof gitLogTool>[1]);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "line_patch": {
        const result = await linePatchTool(root, input as Parameters<typeof linePatchTool>[1], ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "apply_unified_diff": {
        const result = await applyUnifiedDiffTool(root, input as Parameters<typeof applyUnifiedDiffTool>[1], ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "update_function": {
        const result = await updateFunctionTool(root, input as Parameters<typeof updateFunctionTool>[1], ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "rename_symbol": {
        const result = await renameSymbolTool(root, input as Parameters<typeof renameSymbolTool>[1], ctx);
        return { tool: toolName, ok: result.ok, output: result };
      }
      case "validate_file": {
        const { path, lang } = input as { path: string; lang?: string };
        const result = await validateFileTool(root, path, lang);
        return { tool: toolName, ok: result.ok, output: result };
      }
      default:
        return { tool: toolName, ok: false, output: { error: `unknown tool "${toolName}"` } };
    }
  } catch (e) {
    return { tool: toolName, ok: false, output: { error: `tool threw unexpectedly: ${(e as Error).message}` } };
  }
}
