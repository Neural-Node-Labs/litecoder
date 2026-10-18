// xcoder:version 1 | xcoder:task task-e53af9 | xcoder:updated 2026-08-13T13:58:49.496Z | xcoder:subtask code-st-a2df76
/**
 * Centralized TTY detection for interactive CLI surfaces.
 *
 * The footer (and any ANSI-driven UI) is only safe when stdout is attached
 * to a real terminal AND NO_COLOR is unset. Piped output and NO_COLOR runs
 * must stay raw so downstream tooling and redirected logs never see escape
 * sequences.
 *
 * This is the single source of truth for the gate; SdlcOrchestrator._runLoop
 * calls it when initializing FooterManager, and tests use it to simulate the
 * orchestrator's availability decision.
 */
export function isInteractiveStdout(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}
