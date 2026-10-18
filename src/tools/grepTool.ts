// xcoder:version 2 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:24:56.096Z | xcoder:subtask code-st-cd4444
import fs from "node:fs";
import { globTool } from "./globTool.js";

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  /** Number of surrounding context lines to include around each match (default 0). */
  contextLines?: number;
}

export async function grepTool(
  regex: string,
  globPattern: string = "**/*",
  cwd: string = process.cwd(),
  opts?: GrepOptions
): Promise<GrepMatch[]> {
  const files = await globTool(globPattern, cwd);
  const re = new RegExp(regex);
  const context = Math.max(0, opts?.contextLines ?? 0);
  const matches: GrepMatch[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(`${cwd}/${file}`, "utf-8");
    } catch {
      continue; // binary or unreadable file — skip
    }
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      if (re.test(line)) {
        matches.push({ file, line: idx + 1, text: line.trim() });
        for (let c = 1; c <= context; c++) {
          const before = lines[idx - c];
          if (before !== undefined) {
            matches.push({ file, line: idx - c + 1, text: before.trim() });
          }
          const after = lines[idx + c];
          if (after !== undefined) {
            matches.push({ file, line: idx + c + 1, text: after.trim() });
          }
        }
      }
    });
  }
  return matches;
}


