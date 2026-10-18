// xcoder:version 1 | xcoder:task task-f1ac77 | xcoder:updated 2026-10-17T04:10:17.952Z | xcoder:subtask code-st-1d0003
/**
 * Verdict adapter for the security bylaws.
 *
 * Turns a gate Sub Agent's deliverable into a `ReviewResult` without inventing
 * approval rules: `evaluateReview()` from the bylaws module is the sole
 * authority. This file only parses shapes and formats descriptions.
 *
 * Failure direction is deliberate: malformed or unparseable findings are
 * dropped, which surfaces the affected bylaws as `unreviewed`, which blocks.
 * A gate that cannot establish compliance must not approve.
 */
import {
  evaluateReview,
  type BylawFinding,
  type BylawLayer,
  type ReviewResult,
} from "./secure-architect.bylaws.js";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pass",
  "fail",
  "not-applicable",
  "accepted-risk",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFinding(entry: unknown): BylawFinding | null {
  if (!isRecord(entry)) return null;
  const bylawId = entry.bylawId;
  const status = entry.status;
  if (typeof bylawId !== "string" || bylawId.length === 0) return null;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) return null;
  const finding: { bylawId: string; status: BylawFinding["status"]; note?: string; riskOwner?: string } = {
    bylawId,
    status: status as BylawFinding["status"],
  };
  if (typeof entry.note === "string") finding.note = entry.note;
  if (typeof entry.riskOwner === "string") finding.riskOwner = entry.riskOwner;
  return finding;
}

/** Flatten findings from however the gate agent shaped them. Never throws. */
export function parseBylawFindings(deliverable: unknown): readonly BylawFinding[] {
  try {
    let raw: unknown;

    if (typeof deliverable === "string") {
      // A JSON string deliverable is common when the agent's final_answer is text.
      try {
        raw = JSON.parse(deliverable);
      } catch {
        return [];
      }
    } else {
      raw = deliverable;
    }

    let entries: unknown[];
    if (Array.isArray(raw)) {
      entries = raw;
    } else if (isRecord(raw) && Array.isArray(raw.findings)) {
      entries = raw.findings;
    } else {
      return [];
    }

    const findings: BylawFinding[] = [];
    for (const entry of entries) {
      const finding = asFinding(entry);
      if (finding) findings.push(finding);
    }
    return findings;
  } catch {
    return [];
  }
}

/** Findings + scope -> verdict. Thin delegate to evaluateReview(). */
export function reviewDeliverable(
  deliverable: unknown,
  layers?: readonly BylawLayer[],
): ReviewResult & { readonly findings: readonly BylawFinding[] } {
  const findings = parseBylawFindings(deliverable);
  const result = evaluateReview(findings, layers);
  return { ...result, findings };
}

/** Human-readable one-liner for `reason` when the gate blocks. */
export function describeReview(result: ReviewResult): string {
  const parts: string[] = [];
  if (result.blocking.length > 0) {
    parts.push(
      `${result.blocking.length} MUST violation(s) [${result.blocking.join(", ")}]`
    );
  }
  if (result.unreviewed.length > 0) {
    parts.push(
      `${result.unreviewed.length} bylaw(s) unreviewed [${result.unreviewed.join(", ")}]`
    );
  }
  if (result.invalid.length > 0) {
    parts.push(
      `${result.invalid.length} finding(s) invalid [${result.invalid.join(", ")}]`
    );
  }
  if (parts.length === 0) return "bylaw review approved";
  return "blocked: " + parts.join("; ");
}
