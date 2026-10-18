// xcoder:version 1 | xcoder:task task-54c54e | xcoder:updated 2026-08-04T15:30:01.164Z | xcoder:subtask code-st-43fc58
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";
import { getOutputPaths } from "./output-paths.js";

// ── Module-level state ──

let enabled = false;
let logPath: string | null = null;

/** Serialises writes so parallel agents don't interleave lines. */
let writeChain: Promise<void> = Promise.resolve();

let headerWritten = false;

// ── Public API ──

/**
 * Called once at startup by the CLI action handler when --debug-protocol-error
 * or PROTOCOL_ERROR_LOG is active. Sets module-level enabled flag. If logPath
 * is provided, uses it; otherwise defaults to <cwd>/protocol_error.log.
 */
export function enableProtocolErrorLogging(customPath?: string, opts?: { silent?: boolean }): void {
  enabled = true;
  if (customPath) {
    logPath = path.resolve(customPath);
  } else {
    const outputs = getOutputPaths();
    outputs.ensureGitignore();
    logPath = outputs.protocolErrorLogPath();
  }
  if (!opts?.silent) {
    log.dim(`protocol_error diagnostic log: ${logPath}`);
  }
}

/** Read-only guard so call sites can conditionally gather data. */
export function isProtocolErrorLoggingEnabled(): boolean {
  return enabled;
}

/** The data contract for each ndjson line. */
export interface ProtocolErrorLogEntry {
  ts: string;
  taskId: string;
  agentId: string;
  iteration: number;
  error: string;
  raw: string;
  model: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Appends one ndjson line to the log file. Never throws — all write
 * failures are silently swallowed. Uses an internal promise-chain mutex to
 * serialise appends without blocking the caller.
 *
 * On the FIRST call, writes a `#`-prefixed header block if the file
 * doesn't already exist (checked via synchronous existsSync — cheap,
 * and only happens on the first error which is rare).
 */
export function logProtocolError(entry: ProtocolErrorLogEntry): void {
  if (!enabled || !logPath) return;

  writeChain = writeChain.then(async () => {
    try {
      // Write header once, before the first entry.
      if (!headerWritten) {
        const fileExists = fs.existsSync(logPath!);
        if (!fileExists) {
          const header = [
            "# Xcoder SDLC protocol_error diagnostic log",
            `# Created: ${new Date().toISOString()}`,
            "# Fields: ts, taskId, agentId, iteration, error, raw, model, stopReason, inputTokens, outputTokens",
            "# Enabled by: --debug-protocol-error flag | PROTOCOL_ERROR_LOG env var",
            "",
          ].join("\n");
          await fsp.appendFile(logPath!, header, "utf-8");
        }
        headerWritten = true;
      }

      const line = JSON.stringify(entry) + "\n";
      await fsp.appendFile(logPath!, line, "utf-8");
    } catch {
      // Silently swallow — diagnostic logging must never break the agent loop.
    }
  });
}
