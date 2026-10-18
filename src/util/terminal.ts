// xcoder:version 4 | xcoder:task task-4f2baf | xcoder:updated 2026-08-05T05:48:55.314Z | xcoder:subtask code-st-11b531
import * as clack from "@clack/prompts";
import { createSpinner } from "./spinner.js";
import { FooterManager } from "./footer-manager.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  amber: "\x1b[38;5;214m",
  cyan: "\x1b[38;5;80m",
  green: "\x1b[38;5;78m",
  coral: "\x1b[38;5;203m",
  violet: "\x1b[38;5;140m",
};

function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}
function paint(code: string, text: string): string {
  return useColor() ? `${code}${text}${C.reset}` : text;
}

/**
 * One spinner per Sub Agent turn — "thinking" while the LLM call is in
 * flight. This is the piece that makes a long silent wait (previously
 * indistinguishable from a hang, which is part of what made a crash look
 * like nothing was happening) visibly alive. Backend/style is selectable
 * via `--spinner` — see `util/spinner.ts`.
 */
export function startThinking(agentId: string): { stop: (thought: string) => void; fail: (message: string) => void } {
  const s = createSpinner(paint(C.dim, `[${agentId}] thinking…`));
  FooterManager.instance()?.updateThinkingStart(agentId);
  return {
    stop: (thought: string) => {
      const preview = thought.length > 100 ? thought.slice(0, 97) + "..." : thought;
      s.stop(`${paint(C.violet, `[${agentId}] Thought`)} ${preview}`);
      FooterManager.instance()?.updateThinkingStop();
    },
    fail: (message: string) => {
      s.fail(paint(C.coral, `[${agentId}] ${message}`));
      FooterManager.instance()?.updateThinkingStop();
    },
  };
}

export function printAction(agentId: string, tool: string, input: unknown): void {
  const inputPreview = JSON.stringify(input);
  const truncated = inputPreview && inputPreview.length > 160 ? inputPreview.slice(0, 157) + "..." : inputPreview;
  clack.log.info(`${paint(C.amber, `[${agentId}] Action`)} ${paint(C.bold, tool)} ${paint(C.dim, truncated ?? "")}`);
  FooterManager.instance()?.updateAction(tool);
}

export function printObservation(agentId: string, ok: boolean, text: string): void {
  const preview = text.length > 220 ? text.slice(0, 217) + "..." : text;
  const label = ok ? paint(C.green, `[${agentId}] Observation ✓`) : paint(C.coral, `[${agentId}] Observation ✗`);
  (ok ? clack.log.success : clack.log.error)(`${label} ${preview}`);
  FooterManager.instance()?.updateObservation(ok, text);
}

export function printTokens(
  agentId: string,
  turn: { inputTokens: number; outputTokens: number },
  cumulative: { inputTokens: number; outputTokens: number }
): void {
  clack.log.message(
    paint(
      C.dim,
      `  ↳ tokens: +${turn.inputTokens} in / +${turn.outputTokens} out` +
        `  (task total: ${cumulative.inputTokens} in / ${cumulative.outputTokens} out)`
    )
  );
  FooterManager.instance()?.updateTokens(cumulative.inputTokens, cumulative.outputTokens);
}

export function printProtocolError(agentId: string, message: string): void {
  clack.log.warn(paint(C.coral, `[${agentId}] protocol_error: ${message}`));
}

export function printDuplicateWarning(agentId: string, message: string): void {
  clack.log.warn(paint(C.amber, `[${agentId}] ⟲ ${message}`));
}

export function printCrash(agentId: string, message: string): void {
  clack.log.error(paint(C.coral, `[${agentId}] CRASHED (isolated — orchestrator continues): ${message}`));
}

export function printFinalAnswer(agentId: string, summary: string): void {
  clack.log.success(paint(C.green, `[${agentId}] final_answer`) + ` ${summary}`);
}

export function taskIntro(taskId: string, goal: string): void {
  clack.intro(paint(C.bold, `xcoder · ${taskId}`));
  clack.log.step(goal);
}

export function taskOutro(status: string): void {
  const color = status === "done" ? C.green : status === "escalated" ? C.coral : C.amber;
  clack.outro(paint(color, `run finished: ${status}`));
}

export function orchestratorNote(message: string): void {
  clack.log.step(paint(C.amber, "[orchestrator] ") + message);
}

/**
 * Printed exactly once per interrupt, after state is flushed to disk.
 * Shows task ID, done/total count, exact --resume command, and file path.
 */
export function printInterruptSummary(summary: {
  taskId: string;
  doneCount: number;
  totalCount: number;
  resumeCommand: string;
  taskFilePath: string;
}): void {
  clack.log.message(
    paint(C.bold, `\nInterrupted — progress saved.`) +
      `\n  Task:         ${summary.taskId}` +
      `\n  Done:         ${summary.doneCount}/${summary.totalCount} subtasks` +
      `\n  Resume with:  ${paint(C.cyan, summary.resumeCommand)}` +
      `\n  Task file:    ${paint(C.dim, summary.taskFilePath)}`
  );
}

/**
 * Print a color-coded summary of an Instance Swarm run.
 * Uses the same palette as the rest of the terminal module:
 * - green for completed workers
 * - coral for crashed/failed workers
 * - amber for the swarm-level status line
 * - dim for metadata (tokens, output dir)
 */
export function printSwarmSummary(result: {
  instanceId: string;
  status: "completed" | "failed" | "timeout";
  errors: string[];
  workerCount: number;
  crashedCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  outputDir: string;
}): void {
  const statusColor =
    result.status === "completed" ? C.green : result.status === "timeout" ? C.amber : C.coral;
  const statusIcon = result.status === "completed" ? "✓" : result.status === "timeout" ? "⏱" : "✗";

  clack.log.message(
    paint(C.bold, `\nSwarm finished`) +
      `  ${paint(statusColor, `${statusIcon} ${result.status}`)}`
  );

  clack.log.message(
    `  ${paint(C.cyan, "instanceId:")} ${paint(C.dim, result.instanceId)}`
  );

  const workerLine =
    `  ${paint(C.cyan, "workers:")} ` +
    `${paint(C.green, String(result.workerCount - result.crashedCount))} completed`;
  if (result.crashedCount > 0) {
    clack.log.message(
      workerLine + `, ${paint(C.coral, String(result.crashedCount))} crashed`
    );
  } else {
    clack.log.message(workerLine);
  }

  clack.log.message(
    `  ${paint(C.cyan, "tokens:")} ${paint(C.dim, `${result.totalInputTokens} in / ${result.totalOutputTokens} out`)}`
  );

  clack.log.message(
    `  ${paint(C.cyan, "outputDir:")} ${paint(C.dim, result.outputDir)}`
  );

  if (result.errors.length > 0) {
    clack.log.message(paint(C.bold, `\n  Errors:`));
    for (const err of result.errors) {
      clack.log.error(paint(C.coral, `    ✗ ${err}`));
    }
  }
}
