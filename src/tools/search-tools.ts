// xcoder:version 2 | xcoder:task task-456d3f | xcoder:updated 2026-08-03T15:41:32.148Z | xcoder:subtask code-st-97a4d4
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceIndex } from "./workspace-index.js";
import { toPosixPath } from "./workspace-index.js";

/** Minimal glob → RegExp: supports `**`, `*`, `?`. No external dependency needed for this scope. */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++; // swallow the following slash, `**/` matches zero-or-more dirs
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export interface GlobResult {
  ok: true;
  matches: string[];
}

export function indexGlobTool(index: WorkspaceIndex, pattern: string, limit = 200): GlobResult {
  const re = globToRegExp(toPosixPath(pattern));
  const matches = index.entries.map((e) => e.relPath).filter((p) => re.test(p)).slice(0, limit);
  return { ok: true, matches };
}

export interface GrepMatch {
  relPath: string;
  line: number;
  text: string;
}

export interface GrepResult {
  ok: true;
  matches: GrepMatch[];
  truncated: boolean;
}

const BINARY_LOOKING = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|woff2?|ttf|eot|mp4|mov|exe|dll|so|bin)$/i;

/**
 * Content search across every indexed text file. Bounded by both a
 * per-file size guard (the index already excludes anything over 5MB) and
 * an overall match cap, so a broad pattern against a large repo returns
 * a useful sample rather than flooding the model's context.
 */
export async function indexGrepTool(
  root: string,
  index: WorkspaceIndex,
  pattern: string,
  opts: { pathGlob?: string; caseSensitive?: boolean; limit?: number } = {}
): Promise<GrepResult> {
  const limit = opts.limit ?? 100;
  const flags = opts.caseSensitive ? "g" : "gi";
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }

  const candidates = index.entries.filter((e) => !BINARY_LOOKING.test(e.relPath));
  const filtered = opts.pathGlob
    ? candidates.filter((e) => globToRegExp(toPosixPath(opts.pathGlob!)).test(e.relPath))
    : candidates;

  const matches: GrepMatch[] = [];
  for (const entry of filtered) {
    if (matches.length >= limit) break;
    try {
      const content = await fs.readFile(path.join(root, entry.relPath), "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && matches.length < limit; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          matches.push({ relPath: entry.relPath, line: i + 1, text: lines[i].trim().slice(0, 300) });
        }
      }
    } catch {
      continue; // unreadable/binary — skip
    }
  }

  return { ok: true, matches, truncated: matches.length >= limit };
}
