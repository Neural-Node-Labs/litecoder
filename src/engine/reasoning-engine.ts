import type { DecisionContext, EngineName, OrchestratorAction, ReasoningEngine } from "../types.js";

/**
 * The Master Orchestrator's own decision-making engine — distinct from the
 * per-subtask engine a Sub Agent runs (see `agents/sub-agent.ts`, which
 * today only implements `react-v1`). This is "Orchestrator ReAct": at every
 * DAG event, decide the next orchestration action.
 *
 * `react-v1` here is fully deterministic on purpose — the decision space
 * (dispatch the next-ready frontier, retry with a hint, escalate past the
 * healing cap) doesn't need an LLM call to get right, and keeping it
 * deterministic means the orchestrator's own behavior is reproducible and
 * cheap to run at swarm scale. The other three names are registered as
 * real extension points (e.g. an LLM-driven `plan-execute-v1` that
 * proactively reshapes the DAG) but are not implemented yet — calling them
 * throws a clear "not implemented" rather than silently falling back.
 */
export class ReactOrchestratorEngine implements ReasoningEngine {
  name: EngineName = "react-v1";

  async decide(context: DecisionContext): Promise<OrchestratorAction> {
    const { triggeringEvent, subtask } = context;

    if (triggeringEvent === "subtask_done") {
      const ready = context.dag.filter((n) => n.status === "ready");
      return ready.length
        ? { type: "dispatch", subtaskIds: ready.map((n) => n.id) }
        : { type: "dispatch", subtaskIds: [] };
    }

    if (triggeringEvent === "subtask_failed" && subtask) {
      if (subtask.healing.attempts >= subtask.healing.maxAttempts) {
        return {
          type: "escalate",
          subtaskId: subtask.id,
          reason: `healing exhausted after ${subtask.healing.attempts}/${subtask.healing.maxAttempts} attempts`,
        };
      }
      const lastReason = subtask.healing.log.at(-1) ?? "validation failed";
      return {
        type: "retry",
        subtaskId: subtask.id,
        hint: `Previous attempt failed validation: ${lastReason}. Address this specifically before re-checking your own work.`,
      };
    }

    if (triggeringEvent === "budget_warning") {
      return { type: "halt", reason: "budget ceiling reached" };
    }

    if (triggeringEvent === "stuck_timeout" && subtask) {
      return {
        type: "escalate",
        subtaskId: subtask.id,
        reason: "subtask exceeded its expected runtime with no progress",
      };
    }

    return { type: "halt", reason: `unhandled triggering event: ${triggeringEvent}` };
  }
}

export function getOrchestratorEngine(name: EngineName): ReasoningEngine {
  if (name === "react-v1") return new ReactOrchestratorEngine();
  throw new Error(
    `orchestrator engine "${name}" is registered as an extension point but not implemented yet. ` +
      `Use "react-v1".`
  );
}
