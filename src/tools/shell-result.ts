// xcoder:version 1 | xcoder:task task-72d202 | xcoder:updated 2026-08-03T14:45:21.781Z | xcoder:subtask code-st-a4c0ab
/**
 * Shared result interface for shell command execution.
 * Used by both shell-tool.ts (exec-based) and runCommandTool.ts (spawn-based).
 */
export interface ShellResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
