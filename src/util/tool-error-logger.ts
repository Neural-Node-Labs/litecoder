// xcoder:version 1 | xcoder:task task-54c54e | xcoder:updated 2026-08-04T15:30:04.218Z | xcoder:subtask code-st-43fc58
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

// ── Module-level state ──

let enabled = false;
let logPath: string | null = null;

/** Serialises writes so parallel agents don't interleave lines. */
let writeChain: Promise<void> = Promise.resolve();

let headerWritten = false;

// ── Public API ──

/**
 * Called once at startup by the CLI preAction hook when --debug-tools
 * or DEBUG_TOOLS is active. Sets module-level enabled flag. If customPath
 * is provided, uses it; otherwise defaults to <cwd>/tools.log.
 */
export function enableToolErrorLogging(customPath?: string, opts?: { silent?: boolean }): void {
  enabled = true;
  logPath = customPath
    ? path.resolve(customPath)
    : path.join(process.cwd(), "tools.log");
  if (!opts?.silent) {
    log.dim(`tool_error diagnostic log: ${logPath}`);
  }
}

/** Read-only guard so call sites can skip data collection when disabled. */
export function isToolErrorLoggingEnabled(): boolean {
  return enabled;
}

/** The data contract for each ndjson line. */
export interface ToolErrorLogEntry {
  ts: string;
  tool: string;
  error: string;
  ok: false;
  taskId?: string;
  subtaskId?: string;
  input?: string;
  iteration?: number;
}

/** Maximum length of input before truncation. */
const MAX_INPUT_LENGTH = 2000;

/**
 * Appends one ndjson line to the log file. Never throws — all write
 * failures are silently swallowed. Uses an internal promise-chain mutex to
 * serialise appends without blocking the caller.
 *
 * On the FIRST call, writes a `#`-prefixed header block if the file
 * doesn't already exist (checked via synchronous existsSync — cheap,
 * and only happens on the first error which is rare).
 *
 * Truncates entry.input to MAX_INPUT_LENGTH + "...[truncated]" suffix.
 */
export function logToolError(entry: ToolErrorLogEntry): void {
  if (!enabled || !logPath) return;

  writeChain = writeChain.then(async () => {
    try {
      // Write header once, before the first entry.
      if (!headerWritten) {
        const fileExists = fs.existsSync(logPath!);
        if (!fileExists) {
          const header = [
            "# Xcoder SDLC tool_error diagnostic log",
            `# Created: ${new Date().toISOString()}`,
            "# Fields: ts, tool, error, ok, taskId, subtaskId, input, iteration",
            "# Enabled by: --debug-tools flag | DEBUG_TOOLS env var",
            "# Only tool errors (ok=false) are logged — successful calls are omitted.",
            "",
          ].join("\n");
          await fsp.appendFile(logPath!, header, "utf-8");
        }
        headerWritten = true;
      }

      // Truncate input if necessary
      const entryToWrite = { ...entry };
      if (entryToWrite.input && entryToWrite.input.length > MAX_INPUT_LENGTH) {
        entryToWrite.input = entryToWrite.input.slice(0, MAX_INPUT_LENGTH) + "...[truncated]";
      }

      const line = JSON.stringify(entryToWrite) + "\n";
      await fsp.appendFile(logPath!, line, "utf-8");
    } catch {
      // Silently swallow — diagnostic logging must never break the agent loop.
    }
  });
}
