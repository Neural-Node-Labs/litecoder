// xcoder:version 2 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:02:04.171Z | xcoder:subtask code-st-b3a0c8
import { promises as fs } from "node:fs";
import path from "node:path";

import { createKooderPaths } from "../util/kooder-paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Keyed by workspace-relative posix path. Timestamps in ISO 8601. */
export type FileVersionsIndex = Record<
  string,
  { version: number; lastTask: string; lastSubtask: string; lastUpdated: string }
>;

export interface HeaderMeta {
  version: number;
  taskId: string;
  subtaskId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function versionsPath(workspaceRoot: string): string {
  return path.join(createKooderPaths(workspaceRoot).root, "file-versions.json");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads .kooder/file-versions.json, parses it, returns the index.
 * Returns an empty index if the file doesn't exist or is malformed.
 */
export async function loadFileVersions(
  workspaceRoot: string
): Promise<FileVersionsIndex> {
  try {
    const raw = await fs.readFile(versionsPath(workspaceRoot), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    // Validate entries have the expected shape
    const sanitized: FileVersionsIndex = {};
    for (const [k, v] of Object.entries(parsed)) {
      const entry = v as Record<string, unknown>;
      if (
        typeof entry?.version === "number" &&
        typeof entry?.lastTask === "string" &&
        typeof entry?.lastSubtask === "string"
      ) {
        sanitized[k] = {
          version: entry.version,
          lastTask: entry.lastTask,
          lastSubtask: entry.lastSubtask,
          lastUpdated: typeof entry.lastUpdated === "string" ? entry.lastUpdated : new Date().toISOString(),
        };
      }
    }
    return sanitized;
  } catch {
    return {};
  }
}

/**
 * Loads the index, looks up relPath, increments version by 1 (or sets to 1
 * if new), updates lastTask/lastSubtask/lastUpdated, saves the index
 * atomically (temp + rename), returns the new HeaderMeta.
 */
export async function incrementFileVersion(
  workspaceRoot: string,
  relPath: string,
  taskId: string,
  subtaskId: string
): Promise<HeaderMeta> {
  const index = await loadFileVersions(workspaceRoot);
  const posix = relPath.replace(/\\/g, "/");
  const existing = index[posix];
  const newVersion = existing ? existing.version + 1 : 1;
  const timestamp = new Date().toISOString();

  index[posix] = {
    version: newVersion,
    lastTask: taskId,
    lastSubtask: subtaskId,
    lastUpdated: timestamp,
  };

  await atomicWrite(workspaceRoot, index);
  return { version: newVersion, taskId, subtaskId, timestamp };
}

// ---------------------------------------------------------------------------
// Internal: atomic write
// ---------------------------------------------------------------------------

async function atomicWrite(workspaceRoot: string, index: FileVersionsIndex): Promise<void> {
  const target = versionsPath(workspaceRoot);
  const tmp = target + ".tmp." + Date.now();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
  await fs.rename(tmp, target);
}
