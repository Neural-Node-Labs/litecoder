// xcoder:version 1 | xcoder:task task-c776f2 | xcoder:updated 2026-08-03T19:28:35.957Z | xcoder:subtask code-st-5c254e
/**
 * Compute the Levenshtein distance between two case-folded strings.
 * The distance is the minimum number of single-character insertions,
 * deletions, or substitutions required to transform `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();

  // Ensure s is the shorter string (O(min(n,m)) space)
  if (s.length > t.length) {
    return levenshtein(b, a);
  }

  const m = s.length;
  const n = t.length;

  // Two-row DP arrays
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);

  for (let i = 0; i <= m; i++) {
    prev[i] = i;
  }

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const substitutionCost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,          // deletion
        curr[i - 1] + 1,      // insertion
        prev[i - 1] + substitutionCost, // substitution
      );
    }
    // Swap rows
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}
