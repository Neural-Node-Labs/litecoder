// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:36:48.169Z | xcoder:subtask code-st-9de79a
/**
 * Public surface of the litecoder planner CLI.
 *
 * Kept small on purpose: `no-tools` is exported so a test (or a reviewer) can
 * assert the planner's tool surface is structurally empty without reaching
 * into module internals.
 */
export { NO_TOOLS, OrchestratorHasNoToolsError, isNoToolsRegistry } from "./no-tools.js";
export type { ToolRegistry } from "./no-tools.js";

export {
  PlanSchema,
  PlannedSubtaskSchema,
  RoleSchema,
  MAX_SUBTASKS_HARD_CAP,
  parsePlan,
} from "./plan-schema.js";
export type { Plan, PlannedSubtask } from "./plan-schema.js";

export { MasterOrchestrator } from "./master-orchestrator.js";
export type {
  MasterOrchestratorOptions,
  PlanInput,
  PlanOutcome,
  PlannerFailure,
  PlannerTraceEntry,
} from "./master-orchestrator.js";

export { createSecureGate, BYLAW_GATED_ROLES, SECURE_OFF_ADVISORY } from "./secure-gate.js";
export type { BylawVerdict, SecureGate, SecureMode } from "./secure-gate.js";

export { dispatchPlan } from "./dispatcher.js";
export type {
  DispatchEngine,
  DispatchOptions,
  DispatchOutcome,
  LitecoderSubtaskReport,
  LitecoderSubtaskStatus,
} from "./dispatcher.js";

export {
  deriveStatus,
  describeSubtask,
  emptyTotals,
  exitCodeFor,
  formatHumanReport,
  summariseBylawVerdicts,
} from "./report.js";
export type { BylawSummary, LitecoderRunReport, LitecoderRunStatus } from "./report.js";
