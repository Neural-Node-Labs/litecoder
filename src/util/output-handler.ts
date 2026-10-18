// xcoder:version 10 | xcoder:task task-7f2823 | xcoder:updated 2026-08-03T09:31:58.357Z | xcoder:subtask code-st-e8e2bf
/**
 * OutputHandler — centralized output sink for ReAct signals.
 *
 * Provides flag-gated terminal output and optional SQLite persistence
 * for Thought, Reason, Action, Observation, and raw/error signals.
 *
 * Singleton pattern: use getOutputHandler() to obtain the instance.
 * Call reset() in tests to clear the singleton between test cases.
 *
 * SQLite support is via sql.js (wasm-based, zero native deps) as an
 * optional dependency. It is lazy-loaded on first logToSqlite:true call
 * and falls back gracefully if the package is not installed.
 */

import { createKooderPaths } from "./kooder-paths.js";

export interface OutputHandlerOptions {
  /** Whether to print signals to stdout (default: true). */
  printToTerminal: boolean;
  /** Whether to persist signals to SQLite (default: false). */
  logToSqlite?: boolean;
  /** Path to the SQLite database file (default: <state-root>/output.db). */
  dbPath?: string;
}

/**
 * SQLite row inserted into the output_log table.
 */
interface OutputLogRow {
  level: "thought" | "reason" | "action" | "observation" | "raw" | "error";
  content: string;
  metadata?: string;
}

/**
 * Mutable singleton reference — reset between tests via reset().
 */
let _instance: OutputHandler | null = null;

/**
 * Obtain the singleton OutputHandler instance.
 * On first call, the instance is created with the provided options.
 * Subsequent calls return the same instance (options are ignored).
 */
export function getOutputHandler(
  opts?: OutputHandlerOptions,
): OutputHandler {
  if (!_instance) {
    _instance = new OutputHandler(
      opts ?? { printToTerminal: true },
    );
  }
  return _instance;
}

/**
 * Reset the singleton instance — for test use only.
 */
export function resetOutputHandler(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

export class OutputHandler {
  private printToTerminal: boolean;
  private logToSqlite: boolean;
  private dbPath: string;
  private db: unknown = null; // sql.js Database | null
  private initPromise: Promise<unknown> | null = null;

  constructor(opts: OutputHandlerOptions) {
    this.printToTerminal = opts.printToTerminal;
    this.logToSqlite = opts.logToSqlite ?? false;
    this.dbPath = opts.dbPath ?? createKooderPaths(process.cwd()).outputDbPath();
  }

  /**
   * Lazy-initialize the SQLite database.
   * Uses sql.js (wasm-based, zero native deps).
   * Falls back gracefully if sql.js is not installed.
   */
  private async ensureDb(): Promise<unknown> {
    if (this.db !== null) return this.db;

    if (!this.initPromise) {
      this.initPromise = this._initDb();
    }
    const db = await this.initPromise;
    this.db = db;
    this.initPromise = null;
    return db;
  }

  private async _initDb(): Promise<unknown> {
    try {
      // Dynamic import — sql.js is an optionalDependency.
      // Falls back gracefully if not installed.
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs();

      const db = new SQL.Database();

      // Create schema
      db.run(`
        CREATE TABLE IF NOT EXISTS output_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL DEFAULT (datetime('now')),
          level TEXT NOT NULL CHECK(level IN ('thought','reason','action','observation','raw','error')),
          content TEXT NOT NULL,
          metadata TEXT
        )
      `);

      return db;
    } catch (err) {
      // sql.js not installed — emit a warning once and fall back
      console.warn(
        "[output-handler] sql.js not available — SQLite logging disabled. " +
          "Install with: npm install sql.js",
      );
      return null;
    }
  }

  /**
   * Emit a thought signal.
   */
  thought(msg: string): void {
    this.emit("thought", msg);
  }

  /**
   * Emit a reasoning step.
   */
  reason(msg: string): void {
    this.emit("reason", msg);
  }

  /**
   * Emit an action invocation.
   */
  action(tool: string, input: unknown): void {
    const meta =
      input !== undefined
        ? JSON.stringify(typeof input === "string" ? input.slice(0, 200) : input).slice(0, 500)
        : undefined;
    this.emit("action", tool, meta);
  }

  /**
   * Emit a tool observation.
   */
  observation(msg: string): void {
    this.emit("observation", msg);
  }

  /**
   * Generic fallback output.
   */
  raw(msg: string): void {
    this.emit("raw", msg);
  }

  /**
   * Emit an error signal.
   */
  error(msg: string): void {
    this.emit("error", msg);
  }

  /**
   * Core emit logic — prints to terminal if flag is on,
   * and persists to SQLite if enabled.
   */
  private emit(
    level: OutputLogRow["level"],
    content: string,
    metadata?: string,
  ): void {
    if (this.printToTerminal) {
      this.printSignal(level, content, metadata);
    }

    if (this.logToSqlite) {
      this.persistSignal(level, content, metadata);
    }
  }

  /**
   * Print a formatted signal to stdout.
   */
  private printSignal(
    level: OutputLogRow["level"],
    content: string,
    metadata?: string,
  ): void {
    const now = new Date().toISOString();
    const metaStr = metadata ? ` | ${metadata}` : "";
    console.log(`[${now}] [${level.toUpperCase()}] ${content}${metaStr}`);
  }

  /**
   * Persist a signal to the SQLite database.
   * Fire-and-forget — does not throw on failure.
   */
  private persistSignal(
    level: OutputLogRow["level"],
    content: string,
    metadata?: string,
  ): void {
    this.ensureDb()
      .then((db) => {
        if (!db) return;
        const stmt = (db as { run: (sql: string, params: unknown[]) => void }).run.bind(db);
        // Build INSERT via raw SQL to avoid prepared-statement API differences
        const safeContent = content.replace(/'/g, "''");
        const safeMeta = metadata ? metadata.replace(/'/g, "''") : "";
        const sql = safeMeta
          ? `INSERT INTO output_log (level, content, metadata) VALUES ('${level}', '${safeContent}', '${safeMeta}')`
          : `INSERT INTO output_log (level, content) VALUES ('${level}', '${safeContent}')`;
        try {
          (db as { run: (sql: string) => void }).run(sql);
        } catch {
          // Silently ignore DB write errors — log persistence is best-effort
        }
      })
      .catch(() => {
        // Silently ignore — sql.js load failed (already warned)
      });
  }

  /**
   * Close the SQLite database connection.
   * Call on process exit or when the handler is no longer needed.
   */
  close(): void {
    if (this.db) {
      try {
        (this.db as { close: () => void }).close();
      } catch {
        // Ignore
      }
      this.db = null;
    }
  }
}
