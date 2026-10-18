// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:35:23.517Z | xcoder:subtask code-st-9de79a
/**
 * The planner's tool registry.
 *
 * A Master Orchestrator plans; it does not act. Rather than *telling* the
 * model it has no tools (PRM-09: a prompt instruction is not a security
 * boundary), the registry it is handed is structurally empty and frozen:
 * there is no capability to reach for. Every lookup — by name, by index,
 * by iteration — throws `OrchestratorHasNoToolsError`.
 *
 * Exported as a `ToolRegistry` rather than "absence of a registry" so the
 * emptiness is something a test can assert on directly (`toolCount === 0`,
 * `Object.keys(reg.tools).length === 0`) instead of an implicit convention.
 */
import type { ToolManifestEntry } from "../tools/tool-registry.js";

/** Raised whenever anything tries to reach a tool through the planner's registry. */
export class OrchestratorHasNoToolsError extends Error {
  constructor(readonly attempted: string) {
    super(
      `the litecoder planner has no tools; '${attempted}' cannot be called. ` +
        `Planning produces a plan — execution is the dispatcher's job.`,
    );
    this.name = "OrchestratorHasNoToolsError";
  }
}

/** A tool entry as the planner would see it: name + schema-ish hint. */
export interface NoToolEntry {
  readonly name: string;
  readonly description: string;
  readonly inputHint: string;
}

export interface ToolRegistry {
  /** Always 0. Present so callers can assert emptiness without guessing. */
  readonly toolCount: number;
  /** Always empty (frozen). */
  readonly tools: Readonly<Record<string, NoToolEntry>>;
  /** Always empty (frozen). */
  readonly manifest: readonly ToolManifestEntry[];
  /** Always throws `OrchestratorHasNoToolsError`. */
  get(name: string): never;
  /** Always throws `OrchestratorHasNoToolsError`. */
  call(name: string, _input?: unknown): never;
  /** Always false. */
  has(name: string): boolean;
  /** Always empty. */
  names(): readonly string[];
}

function refuse(attempted: string): never {
  throw new OrchestratorHasNoToolsError(attempted);
}

/**
 * The frozen, empty registry handed to `MasterOrchestrator`.
 *
 * `Object.freeze` on the object and on each collection is what makes this a
 * structural guarantee rather than a convention: a later `reg.tools.glob = …`
 * either throws (strict mode / ESM) or silently no-ops, and neither path can
 * hand the planner a capability.
 */
export const NO_TOOLS: ToolRegistry = Object.freeze({
  toolCount: 0,
  tools: Object.freeze({}),
  manifest: Object.freeze([] as ToolManifestEntry[]),
  get: (name: string): never => refuse(name),
  call: (name: string, _input?: unknown): never => refuse(name),
  has: (_name: string): boolean => false,
  names: (): readonly string[] => Object.freeze([] as string[]),
});

/** True only for the singleton above — the constructor guard's predicate. */
export function isNoToolsRegistry(registry: unknown): boolean {
  return registry === NO_TOOLS;
}
