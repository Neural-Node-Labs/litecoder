// xcoder:version 1 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T12:59:30.270Z | xcoder:subtask code-st-b3a0c8
import path from "node:path";
import fs from "node:fs";

import { readKooderEnv } from "../config/env.js";

/** Default directory name for new state. */
export const DEFAULT_KOODER_DIR = ".kooder";

/** Post-`koober` directory name, kept only as a read-fallback. */
export const LEGACY_KOOBER_DIR = ".koober";

/** Pre-rebrand directory name, kept only as a read-fallback. */
export const LEGACY_XCODER_DIR = ".xcoder";

/** Which tier of the fallback chain actually supplied the state root. */
export type StateDirTier = "override" | "kooder" | "koober" | "xcoder";

export interface ResolvedStateDir {
  /** Absolute path to the state root. */
  readonly path: string;
  readonly tier: StateDirTier;
  /** True for the "koober" and "xcoder" read-fallback tiers. */
  readonly legacy: boolean;
}

/** Directories already announced, so the notice appears at most once each. */
const announced = new Set<string>();

/**
 * Tells the user, once per process, that state is being read from a legacy
 * directory. Deliberately names the DIRECTORY only — never the absolute path,
 * which would leak the operator's home-directory layout.
 */
function announceLegacy(dir: string): void {
  if (announced.has(dir)) return;
  announced.add(dir);
  process.stderr.write(
    `kooder: using legacy state directory ${dir} — run 'mv ${dir} ${DEFAULT_KOODER_DIR}' to migrate\n`,
  );
}

/** Test seam: clears the one-time legacy-directory notice latch. */
export function resetStateDirNotices(): void {
  announced.clear();
}

/**
 * Resolves the base directory name for Kooder's runtime data.
 *
 * Precedence: KOODER_DIR > KOOBER_DIR > XCODER_DIR (the last two deprecated
 * aliases, warned once on stderr). Absolute paths are used verbatim.
 */
export function kooderBaseName(): string {
  return readKooderEnv("KOODER_DIR") || DEFAULT_KOODER_DIR;
}

/**
 * Resolve the full Kooder state directory given a workspace root.
 *
 * Normative precedence (implementation matches row for row):
 *
 * | # | Condition                                  | Returns       | tier       | legacy |
 * |---|--------------------------------------------|---------------|------------|--------|
 * | 1 | KOODER_DIR (or a legacy alias) set         | that path     | `override` | false  |
 * | 2 | default base and <ws>/.kooder exists       | .kooder       | `kooder`   | false  |
 * | 3 | default base, no .kooder, .koober exists   | .koober       | `koober`   | true   |
 * | 4 | default base, neither, .xcoder exists      | .xcoder       | `xcoder`   | true   |
 * | 5 | default base, none exist                   | .kooder       | `kooder`   | false  |
 *
 * An explicit KOODER_DIR is a deliberate operator choice and is never
 * second-guessed by probing. The resolved root is used for BOTH read and
 * write — there is no split-brain and no automatic migration.
 */
export function resolveStateDir(workspaceRoot: string): ResolvedStateDir {
  const base = kooderBaseName();

  if (path.isAbsolute(base)) {
    return { path: base, tier: "override", legacy: false };
  }

  const modern = path.resolve(workspaceRoot, base);
  if (base !== DEFAULT_KOODER_DIR) {
    return { path: modern, tier: "override", legacy: false };
  }

  if (fs.existsSync(modern)) {
    return { path: modern, tier: "kooder", legacy: false };
  }

  const koober = path.resolve(workspaceRoot, LEGACY_KOOBER_DIR);
  if (fs.existsSync(koober)) {
    announceLegacy(LEGACY_KOOBER_DIR);
    return { path: koober, tier: "koober", legacy: true };
  }

  const xcoder = path.resolve(workspaceRoot, LEGACY_XCODER_DIR);
  if (fs.existsSync(xcoder)) {
    announceLegacy(LEGACY_XCODER_DIR);
    return { path: xcoder, tier: "xcoder", legacy: true };
  }

  return { path: modern, tier: "kooder", legacy: false };
}

// ---------------------------------------------------------------------------
// KooderPaths interface
// ---------------------------------------------------------------------------

/**
 * Canonical sub-paths — every module that reads/writes Kooder state MUST go
 * through these functions and never hardcode a directory name.
 */
export interface KooderPaths {
  /** Root: <workspace>/.kooder/ (or the resolved override/fallback). */
  readonly root: string;
  /** Which tier supplied `root` — makes resolution auditable. */
  readonly tier: StateDirTier;

  /** Task run JSON file: <root>/tasks/<taskId>.json */
  taskFile(taskId: string): string;
  /** Progress markdown: <root>/tasks/<taskId>.md */
  taskProgressFile(taskId: string): string;
  /** Tasks directory: <root>/tasks/ */
  tasksDir(): string;

  /** Config directory: <root>/config/ */
  configDir(): string;
  /** LLM config: <root>/config/llm.yaml */
  llmConfigPath(): string;

  /** Per-task log directory: <root>/logs/<taskId>/ */
  logsDir(taskId: string): string;
  /** Screenshot directory: <root>/screenshots/ */
  screenshotsDir(): string;
  /** Output database: <root>/output.db */
  outputDbPath(): string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a KooderPaths instance bound to a workspace root.
 * This is THE single state factory — every consumer calls this once and
 * passes the instance down.
 */
export function createKooderPaths(workspaceRoot: string): KooderPaths {
  const resolved = resolveStateDir(workspaceRoot);
  const root = resolved.path;
  return {
    root,
    tier: resolved.tier,

    tasksDir: () => path.join(root, "tasks"),
    taskFile: (taskId: string) => path.join(root, "tasks", `${taskId}.json`),
    taskProgressFile: (taskId: string) => path.join(root, "tasks", `${taskId}.md`),

    configDir: () => path.join(root, "config"),
    llmConfigPath: () => path.join(root, "config", "llm.yaml"),

    logsDir: (taskId: string) => path.join(root, "logs", taskId),
    screenshotsDir: () => path.join(root, "screenshots"),
    outputDbPath: () => path.join(root, "output.db"),
  };
}
