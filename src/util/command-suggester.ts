// xcoder:version 1 | xcoder:task task-c776f2 | xcoder:updated 2026-08-03T19:28:41.385Z | xcoder:subtask code-st-5c254e
import { levenshtein } from "./levenshtein.js";

/**
 * Given an unknown command name and a list of known commands, return up to
 * `maxSuggestions` (default 3) closest matches sorted by Levenshtein distance
 * then alphabetically, filtered to a maximum distance of `threshold` (default 3).
 */
export function suggestCommands(
  unknown: string,
  known: string[],
  maxSuggestions: number = 3,
  threshold: number = 3,
): string[] {
  const target = unknown.toLowerCase();

  const candidates: Array<{ name: string; distance: number }> = [];

  for (const cmd of known) {
    const distance = levenshtein(target, cmd);
    if (distance <= threshold) {
      candidates.push({ name: cmd, distance });
    }
  }

  // Sort by distance ascending, then alphabetically by command name
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, maxSuggestions).map((c) => c.name);
}
