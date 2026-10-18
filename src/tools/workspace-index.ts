import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { createKooderPaths } from "../util/kooder-paths.js";

export interface IndexEntry {
  relPath: string;
  sizeBytes: number;
  mtimeMs: number;
  sha1: string;
  language: string;
}

export interface WorkspaceIndex {
  root: string;
  builtAt: string;
  entries: IndexEntry[];
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".kooder",
  ".koober",
  ".xcoder",
  ".next",
  ".venv",
  "__pycache__",
  "coverage",
  ".turbo",
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".rs": "rust",
  ".json": "json",
  ".md": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sql": "sql",
  ".sh": "shell",
};

function indexPath(root: string): string {
  return path.join(createKooderPaths(root).root, "workspace-index.json");
}

/**
 * Every path this module stores or compares goes through this first.
 *
 * `path.relative()` uses the OS-native separator — backslashes on Windows.
 * The model, quite reasonably, tends to write and request paths with
 * forward slashes regardless of platform (it's the universal convention
 * in code, docs, and every other tool's examples). Without normalization,
 * a Windows index stores `requirements\design.md` while the model asks
 * for `requirements/design.md`, the exact-string lookup in `findInIndex`
 * fails, and `read_file` reports a false `file_not_found` for a file that
 * genuinely exists — burning iterations on rediscovery instead of actual
 * work. Storing (and comparing against) forward-slash-normalized paths
 * everywhere makes every lookup, glob, and grep work identically
 * regardless of which slash style either side happens to use.
 */
export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/").replace(/\\/g, "/");
}

function guessLanguage(p: string): string {
  return LANGUAGE_BY_EXT[path.extname(p)] ?? "text";
}

async function hashFile(fullPath: string): Promise<string> {
  const buf = await fs.readFile(fullPath);
  return crypto.createHash("sha1").update(buf).digest("hex");
}

async function walk(dir: string, root: string, acc: IndexEntry[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") {
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) {
        // allow hidden dirs the user explicitly wants scanned in the future;
        // for now, skip all dotfiles/dotdirs except the explicit allowlist above.
      }
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(full, root, acc);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(full);
        // Skip anything absurdly large — it has no business being hashed
        // wholesale and inlined-by-reference is the right pattern anyway.
        if (stat.size > 5_000_000) continue;
        const sha1 = await hashFile(full);
        acc.push({
          relPath: toPosixPath(path.relative(root, full)),
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          sha1,
          language: guessLanguage(full),
        });
      } catch {
        // unreadable file (permissions, race with a concurrent delete) — skip it
      }
    }
  }
}

/** Full rebuild. This is the expensive path — call it, don't call it often. */
export async function buildIndex(root: string): Promise<WorkspaceIndex> {
  const entries: IndexEntry[] = [];
  await walk(root, root, entries);
  const index: WorkspaceIndex = { root, builtAt: new Date().toISOString(), entries };
  await fs.mkdir(createKooderPaths(root).root, { recursive: true });
  await fs.writeFile(indexPath(root), JSON.stringify(index, null, 2), "utf8");
  return index;
}

export async function loadIndex(root: string): Promise<WorkspaceIndex | null> {
  try {
    const raw = await fs.readFile(indexPath(root), "utf8");
    return JSON.parse(raw) as WorkspaceIndex;
  } catch {
    return null;
  }
}

export async function getOrBuildIndex(root: string): Promise<WorkspaceIndex> {
  const existing = await loadIndex(root);
  if (existing) return existing;
  return buildIndex(root);
}

/** Cheap incremental update after a single write — avoids a full rescan per file. */
export async function upsertEntry(root: string, relPath: string): Promise<void> {
  const index = (await loadIndex(root)) ?? { root, builtAt: new Date().toISOString(), entries: [] };
  const normalizedRelPath = toPosixPath(relPath);
  const full = path.join(root, relPath); // path.join/resolve handle forward slashes fine on every OS, including Windows
  try {
    const stat = await fs.stat(full);
    const sha1 = await hashFile(full);
    const next: IndexEntry = {
      relPath: normalizedRelPath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      sha1,
      language: guessLanguage(full),
    };
    const idx = index.entries.findIndex((e) => e.relPath === normalizedRelPath);
    if (idx >= 0) index.entries[idx] = next;
    else index.entries.push(next);
    await fs.writeFile(indexPath(root), JSON.stringify(index, null, 2), "utf8");
  } catch {
    // file vanished between write and index update — ignore, next full
    // reindex will reconcile it.
  }
}

/** Normalizes the lookup path the same way stored paths are normalized, so a lookup succeeds regardless of which slash style the caller used. */
export function findInIndex(index: WorkspaceIndex, relPath: string): IndexEntry | undefined {
  const normalized = toPosixPath(relPath).replace(/^\.\//, "");
  return index.entries.find((e) => e.relPath === normalized);
}

export function searchIndex(index: WorkspaceIndex, query: string, limit = 30): IndexEntry[] {
  const q = toPosixPath(query).toLowerCase();
  return index.entries.filter((e) => e.relPath.toLowerCase().includes(q)).slice(0, limit);
}
