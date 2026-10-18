// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:35:14.939Z | xcoder:subtask code-st-9de79a
/**
 * Core contracts. Everything else in this codebase is built around these
 * shapes — the same principle Agent Factory's `af-shared-contracts` repo
 * follows: one definition, imported everywhere, never hand-copied.
 */

import type { BylawLayer } from "./skills/secure-architect.bylaws.js";

// ---------------------------------------------------------------------------
// SDLC
// ---------------------------------------------------------------------------

export type SdlcStage =
  | "requirements"
  | "design"
  | "code"
  | "refactor"
  | "test"
  | "ui_api_test"
  | "fix_defect"
  | "document"
  | "deploy"
  | "conversation"
  | "quality_gate";

/**
 * Every role, as a runtime tuple.
 *
 * The union is derived from this array rather than declared separately, so
 * the two can never drift. The array exists because model output is
 * validated at a trust boundary (`litecoder/plan-schema.ts`) and `z.enum()`
 * needs a runtime tuple — the same values, same order, type-identical to the
 * hand-written union that used to live here.
 */
export const ROLES = [
  "requirements-analyst",
  "architect",
  "programmer",
  "refactorer",
  "tester",
  "ui-api-tester",
  "technical-writer",
  "devops",
  "conversation",
  "business-analyst",
  "defect-manager",
  "scrum-master",
  "system-architect",
  "security-lead",
] as const;

export type Role = (typeof ROLES)[number];

// The four engines from the wider Agent Factory design. Kooder fully
// implements `react-v1` (the default and the only one every role actually
// runs today). The others are registered as named extension points so a
// role's routing can be swapped later without touching the orchestrator —
// see `src/engine/`.
export type EngineName = "react-v1" | "rewoo-v1" | "plan-execute-v1" | "reflexion-v1";

// ---------------------------------------------------------------------------
// Task intake
// ---------------------------------------------------------------------------

/** Raw inputs as described in the brief: code / design / defect / url / credential. */
export interface TaskInputs {
  code?: string; // path or glob into the workspace, not inlined file content
  design?: string; // path to a design/requirements doc, or inline text
  defectDetail?: string; // free-text defect description, paired with `code`
  url?: string; // target for ui_api_test
  credentialRef?: string; // an ENV VAR NAME, never a raw secret — see tools/credential.ts
  freeText?: string; // anything left over from the CLI task string
}

export interface TaskSpec {
  taskId: string;
  goal: string;
  inputs: TaskInputs;
  constraints: {
    budgetUsd?: number;
    maxHealingAttempts: number;
    concurrency: number;
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The WBS DAG
// ---------------------------------------------------------------------------

export type SubtaskStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "validating"
  | "healing"
  | "escalated"
  | "blocked"
  | "done"
  | "failed";

export interface AcceptanceCriterion {
  id: string;
  type: "schema" | "command" | "rubric" | "file-exists" | "bylaw-review";
  description: string;
  /** For `command` type: a shell command run from the workspace root; exit code 0 = pass. */
  command?: string;
  /** For `file-exists` type: a glob pattern relative to the workspace root. At least one matching file must exist. */
  pathGlob?: string;
  /** For `bylaw-review` type: restrict the review scope to these layers.
   *  Omitted => inferLayers(goal) at validation time. */
  bylawLayers?: BylawLayer[];
}

/**
 * A fully self-contained work order. A Sub Agent must be able to execute
 * this in isolation, with its own memory loop, using nothing beyond this
 * node, the tool registry, and its role's directive/skills.
 */
export interface SubtaskNode {
  id: string;
  stage: SdlcStage;
  role: Role;
  engine: EngineName;
  dependsOn: string[];
  goal: string;
  /** Inlined outputs from upstream nodes — never a lookup id. */
  upstreamContext: Record<string, unknown>;
  /** What this subtask must hand back to the Master Orchestrator. */
  deliverableSpec: string;
  acceptanceCriteria: AcceptanceCriterion[];
  status: SubtaskStatus;
  healing: {
    attempts: number;
    maxAttempts: number;
    log: string[];
  };
  result?: SubtaskResult;
  /** Computed once per attempt by orchestrator/reasoning-score.ts, after validation. Not a pass/fail gate — see that file's doc comment for what this is and isn't for. */
  reasoningScore?: { score: number; breakdown: string[] };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Tracks the operation type for each file touched by a subtask. */
export type FileTouchOperation = "created" | "modified" | "touched";

export interface FileTouchEntry {
  path: string;
  operation: FileTouchOperation;
}

export interface SubtaskResult {
  summary: string;
  deliverable: unknown;
  filesTouched: string[];
  /**
   * Optional additive field carrying operation type per file.
   * Populated alongside filesTouched when context is available.
   * When absent, consumers fall back to `filesTouched: string[]` with a
   * generic `[touched]` label.
   */
  _filesTouchedMeta?: FileTouchEntry[];
  selfCheck?: {
    ran: boolean;
    passed: boolean;
    detail: string;
  };
  raoTrace: RaoStep[];
  tokenUsage: TokenUsage;
  /** Number of ReAct loop turns taken to reach this result — the "iteration count" the benchmark harness and reasoning score both key off. */
  iterations: number;
  /** True if this result is a synthetic stand-in produced after the Sub Agent's
   *  process crashed — the Master Orchestrator never crashes with it (see
   *  `orchestrator/swarm.ts`); it treats a crash as a failed subtask that can
   *  still go through the normal bounded healing/escalation path. */
  crashed?: boolean;
  /** True if the attempt was aborted early because DuplicateActionDetector flagged it as a stuck loop rather than running to the full iteration cap. */
  stuckLoop?: boolean;
  /** True when the sub-agent exhausted its maxIterations without producing a final_answer. Set ONLY by SubAgent.run() in that case; never set in crashResult or stuckLoop returns. */
  iterationsExhausted?: boolean;
}

export interface RaoStep {
  thought: string;
  action: { tool: string; input: unknown } | null;
  observation: string;
}

export interface TaskRun {
  spec: TaskSpec;
  dag: SubtaskNode[];
  status: "planning" | "running" | "done" | "halted" | "escalated";
  escalations: { subtaskId: string; reason: string }[];
  orchestratorTrace: RaoStep[];
  finalDeliverable?: string;
  totalTokenUsage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Orchestrator-level decision contract
// ---------------------------------------------------------------------------

export type OrchestratorAction =
  | { type: "dispatch"; subtaskIds: string[] }
  | { type: "retry"; subtaskId: string; hint: string }
  | { type: "replan"; patch: { addNodes?: SubtaskNode[]; removeNodeIds?: string[] } }
  | { type: "escalate"; subtaskId: string; reason: string }
  | { type: "halt"; reason: string };

export interface DecisionContext {
  dag: SubtaskNode[];
  triggeringEvent: "subtask_failed" | "subtask_done" | "budget_warning" | "stuck_timeout";
  subtask?: SubtaskNode;
}

export interface ReasoningEngine {
  name: EngineName;
  decide(context: DecisionContext): Promise<OrchestratorAction>;
}

export interface LoadedSkill {
  header: SkillHeader;
  body: string; // full markdown body (Process/Strategies/Instructions/Planning/Experience)
  path: string;
}

export interface SkillHeader {
  name: string;
  role: string;
  description: string;
  triggers: string[];
  version: string;
  requires_tools: string[];
  composes_with: string[];
}

// ---------------------------------------------------------------------------
// Lesson-learned module
// ---------------------------------------------------------------------------

/** A single lesson recorded into .kooder/lesson.md. */
export interface LessonEntry {
  /** Who recorded this — "orchestrator" | "sub-agent:<role>" | "samurai" */
  source: string;
  /** The task ID this was learned under, or "N/A" for standalone samurai. */
  taskId: string;
  /** Free-form tags for later categorisation (e.g. ["build-failure", "npm"]). */
  tags: string[];
  /** Brief description of what was happening when the lesson was recorded. */
  context: string;
  /** The actual insight — what was hard, why, and what was figured out. */
  lesson: string;
}
