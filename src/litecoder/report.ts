// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:36:42.494Z | xcoder:subtask code-st-9de79a
/**
 * The run report — the single printed contract of a litecoder run.
 *
 * Status is derived in exactly one place (`deriveStatus`), as a pure function,
 * so "why did this run exit 1" is always answerable by reading one table
 * instead of tracing an if-chain through the CLI.
 *
 * The `--secure` downgrade lives here too (AC10) because it is a *status*
 * rule, and status has one owner. When `--secure` is off, `bylaw` is null and
 * therefore cannot influence anything (AC11).
 */
import type { Plan } from "./plan-schema.js";
import type { PlannerFailure, PlannerTraceEntry } from "./master-orchestrator.js";
import type { DispatchOutcome, LitecoderSubtaskReport } from "./dispatcher.js";
import { SECURE_OFF_ADVISORY, type SecureMode } from "./secure-gate.js";

export type LitecoderRunStatus = "completed" | "partial" | "failed";

export interface BylawSummary {
  readonly approved: boolean;
  readonly blocking: readonly string[];
  readonly unreviewed: readonly string[];
  readonly invalid: readonly string[];
}

export interface LitecoderRunReport {
  readonly taskId: string;
  readonly goal: string;
  readonly status: LitecoderRunStatus;
  readonly secure: { readonly mode: SecureMode };
  /** Null when planning failed — nothing was dispatched. */
  readonly plan: Plan | null;
  readonly planning: {
    readonly steps: number;
    readonly duplicateDetections: number;
    readonly failure: PlannerFailure | null;
    readonly errors: readonly string[];
    /** AC6: the Action -> Observation evidence. */
    readonly trace: readonly PlannerTraceEntry[];
  };
  readonly subtasks: readonly LitecoderSubtaskReport[];
  readonly totals: DispatchOutcome["totals"];
  /** Null when `--secure` is off. */
  readonly bylaw: BylawSummary | null;
}

export function emptyTotals(): DispatchOutcome["totals"] {
  return {
    subtasks: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    totalAttempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
}

/**
 * The one status rule.
 *
 *   planning failed                        -> failed
 *   all subtasks done                      -> completed
 *   >=1 done and >=1 failed|skipped        -> partial
 *   no subtask done                        -> failed
 *   --secure and the bylaw review failed   -> completed downgrades to partial
 *   --secure off (bylaw === null)          -> cannot influence status
 */
export function deriveStatus(report: {
  readonly plan: Plan | null;
  readonly subtasks: readonly Pick<LitecoderSubtaskReport, "status">[];
  readonly bylaw: BylawSummary | null;
}): LitecoderRunStatus {
  if (report.plan === null) return "failed";

  const done = report.subtasks.filter((s) => s.status === "done").length;
  const total = report.subtasks.length;

  let status: LitecoderRunStatus;
  if (total > 0 && done === total) status = "completed";
  else if (done > 0) status = "partial";
  else status = "failed";

  // AC10: an unapproved review means the run cannot claim success.
  if (report.bylaw && report.bylaw.approved === false && status === "completed") {
    status = "partial";
  }

  return status;
}

/** Exit code convention shared with the existing CLI: 0 only on a full success. */
export function exitCodeFor(status: LitecoderRunStatus): 0 | 1 {
  return status === "completed" ? 0 : 1;
}

/**
 * Folds per-subtask verdicts into one run-level summary.
 * Returns null when nothing was judged — which is exactly the `--secure off`
 * case, so status cannot be influenced by an opt-out (AC11).
 */
export function summariseBylawVerdicts(
  subtasks: readonly Pick<LitecoderSubtaskReport, "bylawVerdict">[],
): BylawSummary | null {
  const verdicts = subtasks
    .map((s) => s.bylawVerdict)
    .filter((v): v is NonNullable<typeof v> => v !== null);
  if (verdicts.length === 0) return null;

  return {
    approved: verdicts.every((v) => v.approved),
    blocking: verdicts.flatMap((v) => v.blocking),
    unreviewed: verdicts.flatMap((v) => v.unreviewed),
    invalid: verdicts.flatMap((v) => v.invalid),
  };
}

/** Deterministic plan-order description, used by both human and JSON output. */
export function describeSubtask(sub: LitecoderSubtaskReport): string {
  const verdict = sub.bylawVerdict;
  if (!verdict) return sub.status;
  return verdict.approved ? `${sub.status} (bylaws ok)` : `${sub.status} (bylaws blocked)`;
}

/** The human-readable report. Never includes prompts or secrets. */
export function formatHumanReport(report: LitecoderRunReport): string {
  const lines: string[] = [];
  lines.push(`litecoder — ${report.taskId}`);
  lines.push(`goal: ${report.goal}`);
  lines.push(`status: ${report.status}   secure: ${report.secure.mode}`);

  if (report.plan) {
    lines.push(`plan: ${report.plan.subtasks.length} subtask(s) — ${report.plan.rationale}`);
  } else {
    lines.push(
      `plan: none (${report.planning.failure ?? "unknown failure"})` +
        (report.planning.errors.length ? ` — ${report.planning.errors[0]}` : ""),
    );
  }

  if (report.planning.trace.length > 0) {
    lines.push("planning trace:");
    for (const entry of report.planning.trace) {
      lines.push(
        `  [${entry.step}] ${entry.ok ? "accepted" : "rejected"}: ${entry.thought.slice(0, 120)}`,
      );
    }
  }

  if (report.subtasks.length > 0) {
    lines.push("subtasks:");
    for (const sub of report.subtasks) {
      lines.push(
        `  ${sub.id} [${sub.role}] ${describeSubtask(sub)}` +
          (sub.error ? ` — ${sub.error}` : "") +
          (sub.filesTouched.length ? ` (files: ${sub.filesTouched.join(", ")})` : ""),
      );
    }
    const t = report.totals;
    lines.push(
      `totals: ${t.done} done, ${t.failed} failed, ${t.skipped} skipped, ` +
        `${t.totalAttempts} attempt(s), ${t.durationMs}ms`,
    );
  }

  if (report.bylaw) {
    const problems = [
      ...report.bylaw.blocking,
      ...report.bylaw.unreviewed,
      ...report.bylaw.invalid,
    ];
    lines.push(
      report.bylaw.approved
        ? "bylaws: approved"
        : `bylaws: BLOCKED (${problems.join(", ")})`,
    );
  }

  if (report.secure.mode === "off") lines.push(SECURE_OFF_ADVISORY);

  return lines.join("\n") + "\n";
}
