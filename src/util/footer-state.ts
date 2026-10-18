// xcoder:version 1 | xcoder:task task-4f2baf | xcoder:updated 2026-08-05T05:46:03.907Z | xcoder:subtask code-st-11b531
import type { SdlcStage } from "../types.js";

/**
 * The current values for every footer field.
 * Single source of truth — FooterManager writes, FooterRenderer reads.
 */
export interface FooterState {
  /** Current SDLC stage, derived from the DAG. */
  stage: SdlcStage | null;
  /** Agent currently thinking (or null if idle). */
  agentId: string | null;
  /** Task description (shortened goal string). */
  taskDesc: string | null;
  /** Last action tool name. */
  action: string | null;
  /** Whether an observation is in flight. */
  observing: boolean;
  /** Whether the spinner should be active. */
  spinner: boolean;
  /** Cumulative token usage display string. */
  tokens: string | null;
  /** Document count or doc-related info. */
  docs: string | null;
  /** Whether the terminal supports ANSI (TTY + no NO_COLOR). */
  tty: boolean;
}

/**
 * Creates a default, idle footer state.
 */
export function createFooterState(overrides?: Partial<FooterState>): FooterState {
  return {
    stage: null,
    agentId: null,
    taskDesc: null,
    action: null,
    observing: false,
    spinner: false,
    tokens: null,
    docs: null,
    tty: false,
    ...overrides,
  };
}
