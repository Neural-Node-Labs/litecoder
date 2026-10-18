import fs from "node:fs";
import path from "node:path";

const IGNORE_FILES = [".agent/.agentignore", ".gitignore", ".dockerignore"];
const ALWAYS_IGNORE = ["**/node_modules/**", ".git/**", "dist/**", ".agent/index/**", ".log/**"];

/**
 * Converts a single ignore-line pattern into a fast-glob-compatible pattern.
 *
 * - Trailing slash means directory only -> prefix with double-star-slash and
 *   append double-star so it matches at any depth.
 * - Bare directory name (no path separators, no dots, no glob chars) -> prefix
 *   with double-star-slash and append slash-double-star so it matches the
 *   directory and everything inside at any depth.
 * - Patterns already starting with double-star-slash are left as-is.
 * - Everything else is treated as a literal file/glob pattern.
 */
function normalizePattern(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed;

  // Already a recursive glob -- use as-is
  if (trimmed.startsWith("**/")) return trimmed;

  // Directory-only pattern: "node_modules/" -> "**/node_modules/**"
  if (trimmed.endsWith("/")) return `**/${trimmed}**`;

  // Bare directory name (no path separators, no dots, no glob chars):
  // e.g. "dist" -> "**/dist/**", but "Thumbs.db" stays as-is (has a dot)
  if (
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    !trimmed.includes(".") &&
    !trimmed.includes("*") &&
    !trimmed.includes("?")
  ) {
    return `**/${trimmed}/**`;
  }

  return trimmed;
}

export function loadIgnoreRules(cwd: string = process.cwd()): string[] {
  const rules = new Set<string>(ALWAYS_IGNORE);

  for (const rel of IGNORE_FILES) {
    const p = path.join(cwd, rel);
    if (!fs.existsSync(p)) continue;
    const lines = fs
      .readFileSync(p, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const line of lines) {
      rules.add(normalizePattern(line));
    }
  }
  return [...rules];
}


