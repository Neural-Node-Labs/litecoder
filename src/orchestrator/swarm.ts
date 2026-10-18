// xcoder:version 3 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:31:56.429Z | xcoder:subtask code-st-1a0810
import type { SubtaskNode, SubtaskResult } from "../types.js";
import type { WksProtocolMap } from "../protocol/wks-protocol-manager.js";
import { SubAgent } from "../agents/sub-agent.js";
import { LlmClient } from "../llm/client.js";
import { appendSys } from "../util/logs.js";
import { emitKooderEvent } from "../events/bus.js";
import * as term from "../util/terminal.js";
import { silentTerminal } from "../util/terminal-silent.js";

export interface SwarmDispatchResult {
  subtaskId: string;
  result: SubtaskResult;
}

/**
 * The "swarm" the brief asked for: when more than one subtask is `ready`
 * at once, Kooder runs a Sub Agent for each concurrently rather than one at
 * a time, bounded by `concurrency`.
 *
 * ISOLATION CONTRACT: this function itself never throws because of
 * anything a single Sub Agent does. `SubAgent.run()` is already designed
 * not to throw (see `agents/sub-agent.ts`), but the `try/catch` below is a
 * deliberate second layer — if a future change to `SubAgent` or a Node-
 * level failure (e.g. an out-of-memory kill translated into a rejected
 * promise) ever does throw, this is where it's caught, logged, and turned
 * into a `crashed: true` result that flows through the SAME validate →
 * heal → escalate pipeline as any other failed subtask, rather than
 * aborting the whole `Promise.all` and taking every other in-flight Sub
 * Agent — and the Master Orchestrator itself — down with it.
 */
export async function dispatchSwarm(
  ready: SubtaskNode[],
  opts: { taskId: string; workspaceRoot: string; llm: LlmClient; subAgentLlm?: LlmClient; concurrency: number; healingHints?: Record<string, string>; protocolOverrides?: WksProtocolMap; signal?: AbortSignal; quiet?: boolean }
): Promise<SwarmDispatchResult[]> {
  const results: SwarmDispatchResult[] = [];
  const queue = [...ready];
  const concurrency = Math.max(1, opts.concurrency);
  const resolvedTerm = opts.quiet ? silentTerminal : term;

  async function worker(): Promise<void> {
    while (queue.length) {
      // Stop pulling new nodes from the queue when the abort signal fires.
      // In-flight agents complete naturally — no real-time cancellation of
      // in-progress LLM calls (explicit non-goal).
      if (opts.signal?.aborted) return;

      const node = queue.shift();
      if (!node) return;
      resolvedTerm.orchestratorNote(`dispatching ${node.id} (${node.role} / ${node.engine})`);
      emitKooderEvent({ type: "orchestrator:note", taskId: opts.taskId, subtaskId: node.id, data: { message: `dispatching ${node.id} (${node.role} / ${node.engine})` } });

      const agent = new SubAgent({
        taskId: opts.taskId,
        workspaceRoot: opts.workspaceRoot,
        llm: opts.subAgentLlm ?? opts.llm,
        healingHint: opts.healingHints?.[node.id],
        protocolOverrides: opts.protocolOverrides,
        quiet: opts.quiet,
      });

      let result: SubtaskResult;
      try {
        result = await agent.run(node);
      } catch (e) {
        // The safety net described above. This branch existing at all means
        // a bug somewhere else — it should never fire in practice — but if
        // it does, the orchestrator keeps running instead of the whole CLI
        // process dying with no report.
        const message = (e as Error).stack ?? String(e);
        await appendSys(opts.workspaceRoot, opts.taskId, `[${node.id}] UNCAUGHT crash in swarm worker: ${message}`);
        resolvedTerm.printCrash(node.id, `uncaught exception, isolated at the swarm boundary: ${(e as Error).message}`);
        emitKooderEvent({ type: "agent:crash", taskId: opts.taskId, subtaskId: node.id, data: { message: (e as Error).message, recoverable: false } });
        result = {
          summary: `Sub Agent crashed unexpectedly: ${(e as Error).message}`,
          deliverable: null,
          filesTouched: [],
          raoTrace: [],
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          iterations: 0,
          crashed: true,
        };
      }

      results.push({ subtaskId: node.id, result });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return results;
}
