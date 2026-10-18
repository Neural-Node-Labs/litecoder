// xcoder:version 1 | xcoder:task task-ce0416 | xcoder:updated 2026-08-05T05:33:47.113Z | xcoder:subtask code-st-cc17a9
import type { TerminalOutput } from "./terminal-output.js";

/**
 * No-op terminal adapter for `quiet` runs (swarm / sub-agent).
 * Suppresses all per-agent console output; events still flow on the bus.
 */
export const silentTerminal: TerminalOutput = {
  startThinking(_agentId: string) {
    return { stop: () => {}, fail: () => {} };
  },
  printAction(..._args: unknown[]): void {},
  printObservation(..._args: unknown[]): void {},
  printTokens(..._args: unknown[]): void {},
  printProtocolError(..._args: unknown[]): void {},
  printDuplicateWarning(..._args: unknown[]): void {},
  printCrash(..._args: unknown[]): void {},
  printFinalAnswer(..._args: unknown[]): void {},
  taskIntro(..._args: unknown[]): void {},
  taskOutro(..._args: unknown[]): void {},
  orchestratorNote(..._args: unknown[]): void {},
  printInterruptSummary(..._args: unknown[]): void {},
};
