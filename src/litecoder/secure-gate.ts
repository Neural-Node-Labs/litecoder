// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:35:37.768Z | xcoder:subtask code-st-9de79a
/**
 * The only place in litecoder that reads `--secure`.
 *
 * It is a *delegate*, not a policy engine. Whether a design is approved is
 * decided by `evaluateReview()` in the frozen bylaws module; this file only
 * decides (a) whether to ask, and (b) which layers of the question apply.
 * That is deliberate: if this file invented an approval rule, `--secure`
 * could drift from the bylaws every time one was edited.
 *
 * Opt-in by default (design tradeoff T3, an accepted + owned risk against
 * CORE-04): bylaw approval is strict — every in-scope bylaw with no finding
 * is `unreviewed`, and unreviewed blocks — so enforcing by default would
 * reject the brief's own `litecoder "Hello World"` first run. The risk is
 * mitigated by always printing `secure.mode`, by an advisory line when off,
 * and by this being the single line to flip.
 */
import type { Role } from "../types.js";
import {
  inferLayers,
  renderBylaws,
  type BylawFinding,
  type BylawLayer,
  type ReviewResult,
} from "../skills/secure-architect.bylaws.js";
import { BYLAW_SECTION_HEADER } from "../skills/bylaw-context.js";
import { reviewDeliverable } from "../skills/bylaw-review.js";

export type SecureMode = "enforce" | "off";

/**
 * Roles whose subtasks design or judge, so the laws apply.
 *
 * Mirrors `BYLAW_GATED_STAGES` (design | quality_gate) from the prompt
 * adapter: this path has no `SdlcStage` to gate on (`WorkerSubtask` has no
 * stage), so the equivalent set is expressed in the dimension it does have.
 * Gating on `inferLayers(goal)` alone was rejected — a goal that happens to
 * mention "api" would drag bylaws into a `technical-writer` subtask.
 */
export const BYLAW_GATED_ROLES: readonly Role[] = [
  "architect",
  "system-architect",
  "security-lead",
];

export interface BylawVerdict extends ReviewResult {
  readonly layers: readonly BylawLayer[];
  readonly findings: readonly BylawFinding[];
}

export interface SecureGate {
  readonly mode: SecureMode;
  /**
   * Markdown to inject into this subtask's prompt, or null.
   * Null when `mode === 'off'` (AC11) or the role is not bylaw-gated.
   */
  promptBlock(role: Role, goal: string): string | null;
  /** Verdict for a finished deliverable, or null when there is nothing to judge. */
  judge(role: Role, goal: string, deliverable: unknown): BylawVerdict | null;
}

function isGated(role: Role): boolean {
  return BYLAW_GATED_ROLES.includes(role);
}

/**
 * Builds the gate for a run.
 *
 * `off` is a hard opt-out: no bylaw text reaches any prompt and no verdict is
 * ever produced, so security state cannot influence the run's status.
 */
export function createSecureGate(mode: SecureMode): SecureGate {
  if (mode === "off") {
    return {
      mode,
      promptBlock: () => null,
      judge: () => null,
    };
  }

  return {
    mode,
    promptBlock(role: Role, goal: string): string | null {
      if (!isGated(role)) return null;
      try {
        const layers = inferLayers(goal ?? "");
        return BYLAW_SECTION_HEADER + "\n\n" + renderBylaws(layers);
      } catch {
        // A prompt path must never crash a run; degrade to "no bylaws".
        return null;
      }
    },
    judge(role: Role, goal: string, deliverable: unknown): BylawVerdict | null {
      if (!isGated(role)) return null;
      try {
        const layers = inferLayers(goal ?? "");
        const result = reviewDeliverable(deliverable, layers);
        return { ...result, layers };
      } catch {
        // A gate that cannot establish compliance must not approve. Surfacing
        // an empty verdict makes every in-scope bylaw `unreviewed`, which blocks.
        return {
          approved: false,
          blocking: [],
          unreviewed: [],
          invalid: ["bylaw review could not be performed"],
          layers: [],
          findings: [],
        };
      }
    },
  };
}

/** One-line advisory shown whenever scrutiny was opted out of (T3 mitigation b). */
export const SECURE_OFF_ADVISORY =
  "security note: --secure was not set, so no secure-architect bylaw review was performed.";
