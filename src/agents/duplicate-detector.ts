/**
 * Built directly from real evidence, not speculation: a production run's
 * `code` subtask re-read the same design document 11 times across its
 * attempts (multiple times WITHIN a single attempt, not just once per
 * fresh retry) and repeatedly re-checked for files it hadn't created yet,
 * leaving almost none of its 25-iteration budget for actual file writing.
 * That pattern — the exact same (thought, action) pair recurring — is
 * cheap to detect and, left unflagged, silently burns the entire
 * iteration budget on zero net progress.
 *
 * Scope: per SubAgent.run() call (one attempt), not persisted across
 * healing retries — a fresh attempt gets a fresh detector, since a brand
 * new transcript legitimately has no memory of the previous attempt's
 * actions anyway (that's `sdlc-orchestrator.ts`'s file-carryover
 * healing hint's job, not this one's).
 */

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  priorIterations: number[];
  /** True once total duplicate incidents in this attempt cross the abort threshold — the caller should stop the attempt rather than keep burning budget. */
  stuck: boolean;
  /** Non-null whenever isDuplicate is true — meant to be surfaced back to the model as part of the observation. */
  warning: string | null;
}

/** Recursively sorts object keys before stringifying, so two structurally-identical inputs compare equal regardless of key order the model happened to emit them in. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function normalizeThought(thought: string): string {
  return thought.trim().toLowerCase().replace(/\s+/g, " ");
}

export function actionKey(tool: string, input: unknown): string {
  return `${tool}::${stableStringify(input)}`;
}

export class DuplicateActionDetector {
  private seen = new Map<string, number[]>(); // "thought|||tool::input" -> iteration numbers where it occurred
  private totalDuplicates = 0;

  /**
   * @param abortAfterTotalDuplicates total duplicate incidents (not
   *   necessarily of the same action — any repeats, summed) across the
   *   whole attempt before it's treated as a stuck loop. 5 is deliberately
   *   generous: a couple of legitimate re-checks shouldn't trip this, but
   *   the 11-repeat pattern that motivated this class would trip it early
   *   instead of running to the full 25-iteration cap.
   */
  constructor(private abortAfterTotalDuplicates = 5) {}

  check(thought: string, tool: string, input: unknown, iteration: number): DuplicateCheckResult {
    const key = `${normalizeThought(thought)}|||${actionKey(tool, input)}`;
    const prior = this.seen.get(key) ?? [];
    const isDuplicate = prior.length > 0;

    if (isDuplicate) this.totalDuplicates++;
    this.seen.set(key, [...prior, iteration]);

    const stuck = this.totalDuplicates >= this.abortAfterTotalDuplicates;
    const warning = isDuplicate
      ? `duplicate detected: this exact reasoning + action ("${tool}") was already tried at iteration ${prior.at(-1)}` +
        `${prior.length > 1 ? ` (and ${prior.length - 1} time(s) before that)` : ""} — it produced no new information ` +
        `last time. Try a genuinely different approach instead of repeating it.`
      : null;

    return { isDuplicate, priorIterations: prior, stuck, warning };
  }

  get duplicateCount(): number {
    return this.totalDuplicates;
  }
}
