// xcoder:version 1 | xcoder:task swarm-swarm-is-b22287 | xcoder:updated 2026-08-04T12:11:06.168Z | xcoder:subtask swarm-swarm-is-b22287/1
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutputPathsConfig {
  /** Base directory for all reports. Defaults to ".reports". */
  reportsDir?: string;
  /** Base directory for all temporary files. Defaults to ".tmp". */
  tmpDir?: string;
  /** Working directory root. Defaults to process.cwd(). */
  cwd?: string;
}

export interface OutputPaths {
  readonly reportsDir: string;
  readonly tmpDir: string;
  /** Sprint gate rejection + retro reports → <reportsDir>/sprint/ */
  sprintReportsDir(): string;
  /** AI chat debate reports → <reportsDir>/ai-chat/ */
  aiChatReportsDir(): string;
  /** Bench reports → <reportsDir>/bench/ */
  benchReportsDir(): string;
  /** Regression output → <reportsDir>/regression/ */
  regressionDir(): string;
  /** Instance swarm output → <reportsDir>/instance-swarms/ */
  instanceSwarmDir(instanceId: string): string;
  /** Atomic-write staging → <tmpDir>/atomic/ */
  atomicDir(): string;
  /** Protocol error log path → <reportsDir>/protocol_error.log */
  protocolErrorLogPath(): string;
  /** Bench report file path → <reportsDir>/bench/report-<ts>.json */
  benchReportPath(ts?: string): string;
  /**
   * Ensures .gitignore contains entries for .reports/ and .tmp/.
   * Lazily called on first write — fire-and-forget, never throws.
   */
  ensureGitignore(): void;
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _instance: OutputPaths | null = null;
let _config: OutputPathsConfig | undefined;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITIGNORE_ENTRIES = [
  "# Kooder generated artifacts (managed by src/util/output-paths.ts)",
  ".reports/",
  ".tmp/",
  ".kooder/",
  ".koober/",
  ".xcoder/",
  "!.kooder/blueprint.md",
  "!.koober/blueprint.md",
  "!.xcoder/blueprint.md",
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class OutputPathsImpl implements OutputPaths {
  readonly reportsDir: string;
  readonly tmpDir: string;
  private readonly cwd: string;
  private _gitignoreEnsured = false;

  constructor(config?: OutputPathsConfig) {
    this.cwd = config?.cwd ?? process.cwd();
    this.reportsDir = path.resolve(this.cwd, config?.reportsDir ?? ".reports");
    this.tmpDir = path.resolve(this.cwd, config?.tmpDir ?? ".tmp");
  }

  sprintReportsDir(): string {
    return path.join(this.reportsDir, "sprint");
  }

  aiChatReportsDir(): string {
    return path.join(this.reportsDir, "ai-chat");
  }

  benchReportsDir(): string {
    return path.join(this.reportsDir, "bench");
  }

  regressionDir(): string {
    return path.join(this.reportsDir, "regression");
  }

  instanceSwarmDir(instanceId: string): string {
    return path.join(this.reportsDir, "instance-swarms", instanceId);
  }

  atomicDir(): string {
    return path.join(this.tmpDir, "atomic");
  }

  protocolErrorLogPath(): string {
    return path.join(this.reportsDir, "protocol_error.log");
  }

  benchReportPath(ts?: string): string {
    const timestamp = ts ?? new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(this.reportsDir, "bench", `report-${timestamp}.json`);
  }

  ensureGitignore(): void {
    if (this._gitignoreEnsured) return;
    this._gitignoreEnsured = true;

    try {
      const gitignorePath = path.join(this.cwd, ".gitignore");
      let existing = "";
      let existingExists = false;

      try {
        existing = fs.readFileSync(gitignorePath, "utf-8");
        existingExists = true;
      } catch {
        // File doesn't exist — that's fine, we'll create it.
      }

      const existingLines = existingExists
        ? existing.split("\n")
        : [];

      // Determine which entries are already present (exact match).
      const missingEntries = GITIGNORE_ENTRIES.filter((entry) => {
        // For the comment line, check if ANY comment about xcoder-managed is present.
        if (entry.startsWith("# Xcoder SDLC")) {
          return !existingLines.some((line) =>
            line.startsWith("# Xcoder SDLC generated artifacts")
          );
        }
        // For dir entries, check exact match.
        return !existingLines.some((line) => line.trim() === entry);
      });

      if (missingEntries.length === 0) return;

      const block = [
        ...(existingExists && existing.length > 0 && !existing.endsWith("\n")
          ? [""]
          : []),
        ...missingEntries,
        "",
      ].join("\n");

      fs.appendFileSync(gitignorePath, block, "utf-8");
    } catch {
      // Silently swallow — gitignore management is best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the singleton OutputPaths instance. On first call, the optional
 * config is applied; subsequent calls ignore the config (singleton pattern).
 */
export function getOutputPaths(config?: OutputPathsConfig): OutputPaths {
  if (!_instance) {
    _config = config;
    _instance = new OutputPathsImpl(config);
  }
  return _instance;
}

/**
 * Resets the singleton. Primarily for test isolation — call in afterEach.
 * After reset, the next getOutputPaths() call creates a fresh instance.
 */
export function resetOutputPaths(): void {
  _instance = null;
  _config = undefined;
}
