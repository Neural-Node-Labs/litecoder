// xcoder:version 2 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:08:43.878Z | xcoder:subtask code-st-b3a0c8
import { EventEmitter } from "node:events";

export type KooderEventType =
  | "task:intro"
  | "task:outro"
  | "task:dag"
  | "orchestrator:note"
  | "footer:update"
  | "agent:thinking-start"
  | "agent:thought"
  | "agent:action"
  | "agent:observation"
  | "agent:tokens"
  | "agent:final"
  | "agent:crash"
  | "agent:protocol-error"
  | "agent:score"
  | "agent:duplicate"
  | "agent:exhausted"
  | "debate:intro"
  | "debate:turn-start"
  | "debate:agent-thought"
  | "debate:agent-action"
  | "debate:agent-observation"
  | "debate:agent-final"
  | "debate:agent-tokens"
  | "debate:outro";

export interface KooderEvent {
  type: KooderEventType;
  taskId: string;
  subtaskId?: string;
  ts: string;
  data?: unknown;
}

/**
 * A single EventEmitter every RAO-producing part of the system emits to —
 * `agents/sub-agent.ts` and `orchestrator/swarm.ts`.
 *
 * The payload shape is frozen: `emitKooderEvent` is fire-and-forget and must
 * never throw into an agent loop (a throwing logger would violate the
 * non-throwing contract in `agents/sub-agent.ts`). `data` must never carry
 * API keys, full prompts containing secrets, or file contents.
 */
export const kooderEvents = new EventEmitter();
kooderEvents.setMaxListeners(200);

export function emitKooderEvent(ev: Omit<KooderEvent, "ts">): void {
  kooderEvents.emit("event", { ...ev, ts: new Date().toISOString() } satisfies KooderEvent);
}
