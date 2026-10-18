// xcoder:version 1 | xcoder:task task-f1ac77 | xcoder:updated 2026-10-17T04:10:13.858Z | xcoder:subtask code-st-1d0003
/**
 * Prompt-scope adapter for the security bylaws.
 *
 * Decides WHETHER a subtask gets bylaws at all (design and quality_gate only —
 * see design tradeoff T1) and, if so, renders exactly the layers its own goal
 * implicates. All inference is delegated to `inferLayers()` in the bylaws
 * module; there is deliberately no second keyword table here.
 */
import type { Role, SdlcStage } from "../types.js";
import { inferLayers, renderBylaws, type BylawLayer } from "./secure-architect.bylaws.js";

/** Stages whose Sub Agents are made to design or judge, so the laws apply. */
export const BYLAW_GATED_STAGES: readonly SdlcStage[] = ["design", "quality_gate"];

/** Section header used verbatim, so a test can locate the block unambiguously. */
export const BYLAW_SECTION_HEADER = "## Security bylaws (mandatory)";

export interface BylawContextInput {
  readonly stage: SdlcStage;
  readonly role: Role;
  /** The subtask goal as the Sub Agent will actually see it (post-healing-hint). */
  readonly goal: string;
}

export interface BylawContext {
  /** Markdown ready to paste into the system prompt. Byte-identical for identical input. */
  readonly text: string;
  /** The scope actually rendered - core + inferred hits + cross-cutting. */
  readonly layers: readonly BylawLayer[];
}

/** Returns null for every non-gated stage. Never throws. */
export function buildBylawContext(input: BylawContextInput): BylawContext | null {
  try {
    if (!BYLAW_GATED_STAGES.includes(input.stage)) return null;
    const layers = inferLayers(input.goal ?? "");
    const text = BYLAW_SECTION_HEADER + "\n\n" + renderBylaws(layers);
    return { text, layers };
  } catch {
    // The prompt path must never crash a Sub Agent; degrade to "no bylaws".
    return null;
  }
}
