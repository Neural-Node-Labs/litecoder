// xcoder:version 1 | xcoder:task task-ce0416 | xcoder:updated 2026-08-05T05:33:41.992Z | xcoder:subtask code-st-cc17a9
/**
 * Interface for per-agent terminal output. The real terminal module
 * (terminal.ts) conforms to this implicitly; SilentTerminal is a no-op
 * implementation for UI-submitted tasks.
 */
export interface TerminalOutput {
  startThinking(agentId: string): { stop(thought: string): void; fail(msg: string): void };
  printAction(agentId: string, tool: string, input: unknown): void;
  printObservation(agentId: string, ok: boolean, text: string): void;
  printTokens(
    agentId: string,
    turn: { inputTokens: number; outputTokens: number },
    cumulative: { inputTokens: number; outputTokens: number },
  ): void;
  printProtocolError(agentId: string, message: string): void;
  printDuplicateWarning(agentId: string, message: string): void;
  printCrash(agentId: string, message: string): void;
  printFinalAnswer(agentId: string, summary: string): void;
  taskIntro(taskId: string, goal: string): void;
  taskOutro(status: string): void;
  orchestratorNote(message: string): void;
  printInterruptSummary(summary: { taskId: string; doneCount: number; totalCount: number; command: string; file: string }): void;
}
