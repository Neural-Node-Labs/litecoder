// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:24:57.557Z | xcoder:subtask code-st-39dbde
import type { DocErrorCode } from "./types.js";

/**
 * Redacted, bounded operation log for the document tools (design C6, bylaw
 * PRM-10 and AI-12).
 *
 * What is deliberately NOT recorded: file contents, cell/paragraph text, EXIF,
 * metadata values, or anything the model supplied as data. Only the tool, the
 * operation, the workspace-relative path, the outcome and byte counts — enough
 * to trace "what did the agent touch" during an incident, nothing that would
 * turn this log into a second copy of the user's documents.
 */

export interface DocLogEntry {
  at: string;
  tool: string;
  op: string;
  relPath: string;
  ok: boolean;
  code?: DocErrorCode;
  bytesIn?: number;
  bytesOut?: number;
  durationMs: number;
}

const CAPACITY = 512;
const RING: DocLogEntry[] = [];

/** Absolute paths are stripped so a log line can never leak the host layout. */
function safePath(relPath: unknown): string {
  if (typeof relPath !== "string") return "(none)";
  const cleaned = relPath.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, "").replace(/^\/+/, "");
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
}

export function recordDocOperation(entry: Omit<DocLogEntry, "at">): void {
  const record: DocLogEntry = { at: new Date().toISOString(), ...entry, relPath: safePath(entry.relPath) };
  RING.push(record);
  if (RING.length > CAPACITY) RING.shift();
  if (process.env.XCODER_DOC_LOG === "1") {
    process.stderr.write(`[doc-tool] ${JSON.stringify(record)}\n`);
  }
}

/** Snapshot for tests and diagnostics — copy, so callers cannot mutate the ring. */
export function recentDocOperations(limit = 50): DocLogEntry[] {
  return RING.slice(-limit).map((e) => ({ ...e }));
}

export function clearDocOperations(): void {
  RING.length = 0;
}
