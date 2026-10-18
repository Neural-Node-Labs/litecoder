// xcoder:version 1 | xcoder:task task-c4a64f | xcoder:updated 2026-10-17T02:20:28.200Z | xcoder:subtask code-st-348a21
import type { Role, SubtaskNode } from "../types.js";
import type { WorkerSubtask } from "./worker-orchestrator.js";

/**
 * Context handed to the adapter for one attempt. Everything here is
 * traceability-only except `maxAttempts`, which is carried into the node's
 * `healing` block purely so downstream logs read correctly.
 */
export interface ToSubtaskNodeContext {
  taskId: string;
  /** 1-based attempt number of the wave being dispatched. */
  attempt: number;
  maxAttempts: number;
  /** Errors from previous attempts, folded into `healing.log` for traceability only. */
  priorErrors: string[];
}

/**
 * Adapts a generic `WorkerSubtask` onto the `SubtaskNode` shape every Sub
 * Agent already understands.
 *
 * Every constant below is justified by reading `agents/sub-agent.ts`, not
 * guessed:
 *
 * - `engine: "react-v1"` — hard requirement. `SubAgent.run()` synthesises a
 *   not-implemented result for any other engine name, so this is not
 *   caller-controllable and is deliberately absent from `WorkerSubtask`.
 * - `stage: "code"` — cosmetic on this path. `SubAgent` reads `stage` only
 *   when tagging a lesson/text for a stuck loop; it gates nothing. If that
 *   ever changes, this constant becomes a real bug (design tradeoff T4).
 * - `role` — genuinely matters: it indexes the role directives and per-role
 *   protocol overrides. Caller-controllable, defaulting to `programmer`.
 * - `dependsOn: []` — worker subtasks are independent (design tradeoff T3).
 * - `acceptanceCriteria: []` — there is no SDLC validation gate on this path,
 *   and `SubAgent` does not read the field.
 */
export function toSubtaskNode(sub: WorkerSubtask, ctx: ToSubtaskNodeContext): SubtaskNode {
  const goal = (sub.goal ?? "").trim();
  const deliverableSpec = (sub.deliverableSpec ?? "").trim() || goal;
  const role: Role = sub.role ?? "programmer";

  return {
    id: sub.id,
    stage: "code",
    role,
    engine: "react-v1",
    dependsOn: [],
    goal,
    upstreamContext: sub.upstreamContext ?? {},
    deliverableSpec,
    acceptanceCriteria: [],
    status: "ready",
    healing: {
      attempts: Math.max(0, ctx.attempt - 1),
      maxAttempts: ctx.maxAttempts,
      log: [...ctx.priorErrors],
    },
  };
}
