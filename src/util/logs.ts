import { promises as fs } from "node:fs";
import path from "node:path";

import { createKooderPaths } from "./kooder-paths.js";

const MAX_BYTES = 1_000_000; // 1MB, per the brief

function logDir(root: string, taskId: string): string {
  return createKooderPaths(root).logsDir(taskId);
}

function logFile(root: string, taskId: string, name: string): string {
  return path.join(logDir(root, taskId), name);
}

/**
 * Single-generation size-based rollover: once appending would push a log
 * file past 1MB, the current file is renamed to `<name>.1` (clobbering
 * whatever was there before) and a fresh file is started. Simple and
 * bounded — never accumulates unbounded history, never grows past ~2MB
 * per log per task.
 */
async function appendWithRollover(filePath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const entry = line.endsWith("\n") ? line : line + "\n";

  let currentSize = 0;
  try {
    currentSize = (await fs.stat(filePath)).size;
  } catch {
    currentSize = 0;
  }

  if (currentSize + Buffer.byteLength(entry, "utf8") > MAX_BYTES) {
    const rolled = filePath.replace(/(\.[^.]+)$/, ".1$1");
    try {
      await fs.rm(rolled, { force: true });
      await fs.rename(filePath, rolled);
    } catch {
      // best-effort; if the rename fails just keep appending to the current file
    }
  }

  await fs.appendFile(filePath, entry, "utf8");
}

function ts(): string {
  return new Date().toISOString();
}

/** Reason (Thought) → Action → Observation trace, one line per step, human-readable. */
export async function appendThink(root: string, taskId: string, subtaskId: string, line: string): Promise<void> {
  await appendWithRollover(logFile(root, taskId, "think.log"), `[${ts()}] [${subtaskId}] ${line}`);
}

/** System-level errors: crashes, tool exceptions, anything that would otherwise vanish silently. */
export async function appendSys(root: string, taskId: string, line: string): Promise<void> {
  await appendWithRollover(logFile(root, taskId, "sys.log"), `[${ts()}] ${line}`);
}

/** Raw LLM request/response pairs, one JSON line each. */
export async function appendLlm(
  root: string,
  taskId: string,
  subtaskId: string,
  entry: { direction: "request" | "response"; content: string; stopReason?: string | null }
): Promise<void> {
  const stopSeg = entry.stopReason ? ` [stop=${entry.stopReason}]` : "";
  await appendWithRollover(
    logFile(root, taskId, "llm.log"),
    `[${ts()}] [${subtaskId}]${stopSeg} [${entry.direction}] ${entry.content.replace(/\n/g, "\\n")}`
  );
}

/** Token usage per LLM call, plus running totals — one line per call. */
export async function appendToken(
  root: string,
  taskId: string,
  subtaskId: string,
  usage: { inputTokens: number; outputTokens: number; cumulativeInput: number; cumulativeOutput: number }
): Promise<void> {
  await appendWithRollover(
    logFile(root, taskId, "token.log"),
    `[${ts()}] [${subtaskId}] in=${usage.inputTokens} out=${usage.outputTokens} ` +
      `(task-cumulative in=${usage.cumulativeInput} out=${usage.cumulativeOutput})`
  );
}

/** Reasoning-effectiveness score per subtask attempt, with its full breakdown — see orchestrator/reasoning-score.ts for what this is and isn't. */
export async function appendScore(
  root: string,
  taskId: string,
  subtaskId: string,
  score: { score: number; breakdown: string[] }
): Promise<void> {
  await appendWithRollover(
    logFile(root, taskId, "score.log"),
    `[${ts()}] [${subtaskId}] score=${score.score}/100\n  ` + score.breakdown.join("\n  ")
  );
}

/**
 * Every file (or shell command) any tool touched: one line per access,
 * `[ts] [subtask] tool=… op=… ok=… path=…` (or `cmd=…` for shell commands).
 * Same 1 MB single-generation rollover (`files.log` → `files.1.log`) as the
 * other logs. Writes are serialised so parallel agents can't race the
 * stat/rename in `appendWithRollover`.
 */
let filesChain: Promise<void> = Promise.resolve();
export function appendFiles(root: string, taskId: string, subtaskId: string, line: string): Promise<void> {
  filesChain = filesChain
    .then(() => appendWithRollover(logFile(root, taskId, "files.log"), `[${ts()}] [${subtaskId}] ${line}`))
    .catch(() => {
      // logging must never break a tool call
    });
  return filesChain;
}

export function taskLogDir(root: string, taskId: string): string {
  return logDir(root, taskId);
}
