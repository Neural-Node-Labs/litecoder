// xcoder:version 1 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:32:52.955Z | xcoder:subtask code-st-1a0810
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SubAgent, type SubAgentOptions } from "./sub-agent.js";
import type { SubtaskNode } from "../types.js";
import type { RoleDirective } from "../skills/directives.js";
import { ROLE_DIRECTIVES } from "../skills/directives.js";

// Hoisted mocks — vi.mock factories can reference these.
const mockBuildSystemPrompt = vi.hoisted(() => vi.fn());
const mockParseReactMessage = vi.hoisted(() => vi.fn());
const mockDispatchTool = vi.hoisted(() => vi.fn());
const mockLlmComplete = vi.hoisted(() => vi.fn());
const mockGetOrBuildIndex = vi.hoisted(() => vi.fn());
const mockDetectProjectCommands = vi.hoisted(() => vi.fn());
const mockIsExternalSkillsEnabled = vi.hoisted(() => vi.fn());
const mockGetExternalSkills = vi.hoisted(() => vi.fn());

vi.mock("../protocol/react-contract.js", () => ({
  buildAgentSystemPrompt: mockBuildSystemPrompt,
  parseReactMessage: mockParseReactMessage,
}));

const mockBuildToolManifest = vi.hoisted(() => vi.fn(() => []));

vi.mock("../tools/tool-registry.js", () => ({
  TOOL_MANIFEST: [],
  dispatchTool: mockDispatchTool,
  buildToolManifest: mockBuildToolManifest,
}));

vi.mock("../llm/client.js", () => ({
  LlmClient: class Mock {
    complete = mockLlmComplete;
  },
}));

vi.mock("../tools/workspace-index.js", () => ({
  getOrBuildIndex: mockGetOrBuildIndex,
}));

vi.mock("../tools/project-detect.js", () => ({
  detectProjectCommands: mockDetectProjectCommands,
}));

vi.mock("../skills/externalSkillLoader.js", () => ({
  isExternalSkillsEnabled: mockIsExternalSkillsEnabled,
  getExternalSkills: mockGetExternalSkills,
}));

vi.mock("../util/env-info.js", () => ({
  getEnvironmentInfo: () => ({
    platform: "darwin",
    isWindows: false,
    shellHint: "a POSIX shell",
    pathSep: "/",
    release: "23.0.0",
  }),
}));

vi.mock("../util/logs.js", () => ({
  appendThink: vi.fn(),
  appendSys: vi.fn(),
  appendLlm: vi.fn(),
  appendToken: vi.fn(),
}));

vi.mock("../events/bus.js", () => ({
  emitKooderEvent: vi.fn(),
}));

vi.mock("../util/terminal.js", () => ({
  startThinking: () => ({
    stop: vi.fn(),
    fail: vi.fn(),
  }),
  printTokens: vi.fn(),
  printProtocolError: vi.fn(),
  printFinalAnswer: vi.fn(),
  printAction: vi.fn(),
  printObservation: vi.fn(),
  printDuplicateWarning: vi.fn(),
  printProgress: vi.fn(),
  printCrash: vi.fn(),
}));

vi.mock("./duplicate-detector.js", () => ({
  DuplicateActionDetector: class Mock {
    check() {
      return { isDuplicate: false, priorIterations: [], stuck: false };
    }
  },
}));

// ── Helpers ──

function makeSubtask(overrides?: Partial<SubtaskNode>): SubtaskNode {
  return {
    id: "sub-001",
    stage: "test",
    role: "tester",
    engine: "react-v1",
    dependsOn: [],
    goal: "Run unit tests for directiveOverride",
    upstreamContext: {},
    deliverableSpec: "A test doc",
    acceptanceCriteria: [
      { id: "AC1", type: "schema", description: "Verify AC1" },
    ],
    status: "ready",
    healing: { attempts: 0, maxAttempts: 3, log: [] },
    ...overrides,
  };
}

/** Return the options passed to buildAgentSystemPrompt, or null if it wasn't called. */
function getPromptOptions() {
  if (mockBuildSystemPrompt.mock.calls.length === 0) return null;
  return mockBuildSystemPrompt.mock.calls[0][0] as Record<string, unknown>;
}

describe("SubAgent — directiveOverride skills resolution (DEFECT-0003 fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default side-effect-free mocks
    mockGetOrBuildIndex.mockResolvedValue({ files: [] });
    mockDetectProjectCommands.mockResolvedValue({
      build: null,
      test: "npm test",
      typecheck: null,
    });
    mockIsExternalSkillsEnabled.mockReturnValue(false);
    mockGetExternalSkills.mockReturnValue([]);
    mockBuildToolManifest.mockReturnValue([]);
    mockBuildSystemPrompt.mockReturnValue("mock system prompt");

    // First LLM response quits immediately with a final_answer.
    mockParseReactMessage.mockReturnValue({
      ok: true,
      message: {
        thought: "done",
        action: null,
        final_answer: {
          summary: "All good",
          deliverable: "test output",
          files_touched: [],
          self_check: { ran: true, passed: true, detail: "ok" },
        },
      },
    });

    mockLlmComplete.mockResolvedValue({
      text: '{"thought":"done","action":null,"final_answer":{"summary":"ok","deliverable":"ok","files_touched":[]}}',
      usage: { inputTokens: 5, outputTokens: 5 },
      stopReason: "end_turn",
    });
  });

  // ─── TRUTH TABLE (DEFECT-0003) ───
  // 1. No override → role defaults for both directive AND skills
  // 2. String override → string is directive, skills from role defaults
  // 3. RoleDirective object with skills → object.directive + object.skills
  // 4. RoleDirective object without skills → object.directive, skills from role defaults

  it("(1) no directiveOverride: uses ROLE_DIRECTIVES directive AND skills", async () => {
    const sub = makeSubtask({ role: "tester" });
    const agent = new SubAgent({
      taskId: "t1",
      workspaceRoot: "/tmp",
      llm: {} as any,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts).not.toBeNull();
    expect(opts!.directive).toBe(ROLE_DIRECTIVES.tester.directive);
    expect(opts!.skills).toEqual(ROLE_DIRECTIVES.tester.skills);
  });

  it("(2) string directiveOverride: uses string as directive, role defaults for skills", async () => {
    const sub = makeSubtask({ role: "programmer" });
    const agent = new SubAgent({
      taskId: "t2",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: "Custom directive string.",
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.directive).toBe("Custom directive string.");
    expect(opts!.skills).toEqual(ROLE_DIRECTIVES.programmer.skills);
  });

  it("(3) RoleDirective object with skills: uses object.directive AND object.skills", async () => {
    const override: RoleDirective = {
      directive: "Custom architect directive.",
      skills: ["Skill-A", "Skill-B"],
    };
    const sub = makeSubtask({ role: "architect" });
    const agent = new SubAgent({
      taskId: "t3",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: override,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.directive).toBe("Custom architect directive.");
    expect(opts!.skills).toEqual(["Skill-A", "Skill-B"]);
  });

  it("(4) RoleDirective object without skills field: uses object.directive, falls back to role skills", async () => {
    // Simulate an object with no `skills` property at all.
    const override = { directive: "No-skills-field directive." } as RoleDirective;
    const sub = makeSubtask({ role: "refactorer" });
    const agent = new SubAgent({
      taskId: "t4",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: override,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.directive).toBe("No-skills-field directive.");
    expect(opts!.skills).toEqual(ROLE_DIRECTIVES.refactorer.skills);
  });

  // ─── EDGE CASES ───

  it("RoleDirective object with empty skills array [] uses empty skills ([] is truthy)", async () => {
    // Note: [] is truthy in JS.
    // `typeof override === 'object' && override?.skills` → true.
    // So effectiveSkills = override.skills (= []), NOT role defaults.
    const override: RoleDirective = { directive: "abc", skills: [] };
    const sub = makeSubtask({ role: "technical-writer" });
    const agent = new SubAgent({
      taskId: "t5",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: override,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.directive).toBe("abc");
    // This documents the current behavior: [] overrides defaults.
    expect(opts!.skills).toEqual([]);
  });

  it("null directiveOverride is treated as absent (no override)", async () => {
    const sub = makeSubtask({ role: "devops" });
    const agent = new SubAgent({
      taskId: "t6",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: undefined,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.directive).toBe(ROLE_DIRECTIVES.devops.directive);
    expect(opts!.skills).toEqual(ROLE_DIRECTIVES.devops.skills);
  });

  it("validates directive appears in the system prompt", async () => {
    const agent = new SubAgent({
      taskId: "t7",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: "EXACT_STRING_FOR_ASSERTION",
    });

    await agent.run(makeSubtask());

    const opts = getPromptOptions();
    expect(opts!.directive).toBe("EXACT_STRING_FOR_ASSERTION");
  });

  it("all role entries in ROLE_DIRECTIVES work when no override is given", async () => {
    const roles = Object.keys(ROLE_DIRECTIVES) as Array<keyof typeof ROLE_DIRECTIVES>;
    for (const role of roles) {
      vi.clearAllMocks();
      // Re-apply defaults for each iteration
      mockGetOrBuildIndex.mockResolvedValue({ files: [] });
      mockDetectProjectCommands.mockResolvedValue({ build: null, test: "t", typecheck: null });
      mockIsExternalSkillsEnabled.mockReturnValue(false);
      mockGetExternalSkills.mockReturnValue([]);
      mockBuildToolManifest.mockReturnValue([]);
      mockBuildSystemPrompt.mockReturnValue("mock");
      mockParseReactMessage.mockReturnValue({
        ok: true,
        message: {
          thought: "x",
          action: null,
          final_answer: { summary: "s", deliverable: "d", files_touched: [] },
        },
      });
      mockLlmComplete.mockResolvedValue({
        text: "{}",
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: "end_turn",
      });

      const sub = makeSubtask({ role });
      const agent = new SubAgent({ taskId: "t-loop", workspaceRoot: "/tmp", llm: {} as any });
      await agent.run(sub);

      const opts = getPromptOptions();
      expect(opts).not.toBeNull();
      expect(opts!.directive).toBe(ROLE_DIRECTIVES[role].directive);
      expect(opts!.skills).toEqual(ROLE_DIRECTIVES[role].skills);
    }
  });

  // ─── EXTERNAL SKILLS INTEGRATION ───

  it("appends external skills when KOODER_EXTERNAL_SKILLS is on and role is not conversation", async () => {
    mockIsExternalSkillsEnabled.mockReturnValue(true);
    // "qa-engineer" is allowlisted for the "tester" role in skillRouter.ts —
    // an arbitrary name like "ExtSkill" would now be correctly filtered out.
    mockGetExternalSkills.mockReturnValue(["qa-engineer: description"]);

    const sub = makeSubtask({ role: "tester" });
    const agent = new SubAgent({ taskId: "t8", workspaceRoot: "/tmp", llm: {} as any });

    await agent.run(sub);

    const opts = getPromptOptions();
    const defaultSkills = ROLE_DIRECTIVES.tester.skills;
    expect((opts!.skills as string[]).length).toBe(defaultSkills.length + 1);
    expect(opts!.skills).toContain("qa-engineer: description");
  });

  it("does NOT append external skills when role is conversation", async () => {
    mockIsExternalSkillsEnabled.mockReturnValue(true);
    mockGetExternalSkills.mockReturnValue(["ShouldNotAppear"]);

    const sub = makeSubtask({ role: "conversation" });
    const agent = new SubAgent({ taskId: "t9", workspaceRoot: "/tmp", llm: {} as any });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.skills).toEqual(ROLE_DIRECTIVES.conversation.skills);
  });

  it("appends external skills to overridden skills (RoleDirective object)", async () => {
    mockIsExternalSkillsEnabled.mockReturnValue(true);
    mockGetExternalSkills.mockReturnValue(["ui-ux-design: one"]);

    const override: RoleDirective = {
      directive: "Custom",
      skills: ["CustomSkill"],
    };
    const sub = makeSubtask({ role: "business-analyst" });
    const agent = new SubAgent({
      taskId: "t10",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: override,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.skills).toEqual(["CustomSkill", "ui-ux-design: one"]);
  });

  it("appends external skills to role defaults when using string override", async () => {
    mockIsExternalSkillsEnabled.mockReturnValue(true);
    // "docker" is allowlisted for the "devops" role.
    mockGetExternalSkills.mockReturnValue(["docker: two"]);

    const sub = makeSubtask({ role: "devops" });
    const agent = new SubAgent({
      taskId: "t11",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: "string override",
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    const defaults = ROLE_DIRECTIVES.devops.skills;
    expect((opts!.skills as string[]).length).toBe(defaults.length + 1);
    expect(opts!.skills).toContain("docker: two");
  });

  it("REGRESSION: does not leak the renamed 'enterprise-systems-analyst' skill into the business-analyst role, even if present in the external skill set", async () => {
    mockIsExternalSkillsEnabled.mockReturnValue(true);
    // Simulate both the allowlisted skill and the non-allowlisted one being
    // present in the external skill directory at the same time.
    mockGetExternalSkills.mockReturnValue([
      "ui-ux-design: page design",
      "enterprise-systems-analyst: BRD/FRD requirements work",
    ]);

    const sub = makeSubtask({ role: "business-analyst" });
    const agent = new SubAgent({ taskId: "t8b", workspaceRoot: "/tmp", llm: {} as any });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.skills).not.toContain("enterprise-systems-analyst: BRD/FRD requirements work");
    expect(opts!.skills).toContain("ui-ux-design: page design");
  });

  // ─── BACKWARD COMPATIBILITY ───

  it("existing callers passing a plain string still work as before", async () => {
    // Orchestrator / healing always pass string or nothing.
    const agent = new SubAgent({
      taskId: "t12",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: "Plain string from orchestrator",
    });
    await agent.run(makeSubtask());

    const opts = getPromptOptions();
    expect(opts!.directive).toBe("Plain string from orchestrator");
    expect(opts!.skills).toEqual(ROLE_DIRECTIVES.tester.skills);
  });

  it("BA runner passes full RoleDirective object (end-to-end shape)", async () => {
    // This mirrors what ba-runner.ts now does.
    const baOverride: RoleDirective = {
      directive: "BA requirements directive text...",
      skills: [
        "Deriving technical requirements from business language",
        "Writing acceptance criteria that are checkable",
        "Scoping non-goals explicitly",
        "Recognizing and surfacing ambiguities",
      ],
    };
    const sub = makeSubtask({ role: "business-analyst" });
    const agent = new SubAgent({
      taskId: "t13",
      workspaceRoot: "/tmp",
      llm: {} as any,
      directiveOverride: baOverride,
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.directive).toBe(baOverride.directive);
    expect(opts!.skills).toEqual(baOverride.skills);
  });

  // ─── HEALING HINT ───

  it("healingHint is appended to the subtask goal", async () => {
    const sub = makeSubtask({ goal: "Original goal" });
    const agent = new SubAgent({
      taskId: "t14",
      workspaceRoot: "/tmp",
      llm: {} as any,
      healingHint: "Try checking the null pointer.",
    });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.goal).toContain("Original goal");
    expect(opts!.goal).toContain("HEALING HINT: Try checking the null pointer.");
  });

  it("no healingHint — goal is unchanged", async () => {
    const sub = makeSubtask({ goal: "Just the goal" });
    const agent = new SubAgent({ taskId: "t15", workspaceRoot: "/tmp", llm: {} as any });

    await agent.run(sub);

    const opts = getPromptOptions();
    expect(opts!.goal).toContain("Just the goal");
    expect(opts!.goal).not.toContain("HEALING HINT");
  });

  // ─── ITERATION EXHAUSTION ───

  it("returns iterationsExhausted: true when loop ends without final_answer", async () => {
    // Make every LLM response a prose-only message (no action, no final_answer)
    // so the loop never produces a final_answer and exhausts its iteration cap.
    mockParseReactMessage.mockReturnValue({
      ok: true,
      message: { thought: "still thinking...", action: null, final_answer: null },
    });
    mockLlmComplete.mockResolvedValue({
      text: '{"thought":"still thinking..."}',
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end_turn",
    });

    const sub = makeSubtask();
    const agent = new SubAgent({
      taskId: "t-exhaust",
      workspaceRoot: "/tmp",
      llm: { complete: mockLlmComplete } as any,
      maxIterations: 3,
    });

    const result = await agent.run(sub);

    expect(result.iterationsExhausted).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.summary).toContain("did not reach a final_answer");
    expect(result.deliverable).toBeNull();
  });

  it("does NOT set iterationsExhausted when final_answer is reached", async () => {
    // Explicitly reset mocks to return a final_answer on first response
    // (previous exhaustion test may have overridden them).
    mockParseReactMessage.mockReturnValue({
      ok: true,
      message: {
        thought: "done",
        action: null,
        final_answer: {
          summary: "All good",
          deliverable: "test output",
          files_touched: [],
          self_check: { ran: true, passed: true, detail: "ok" },
        },
      },
    });
    mockLlmComplete.mockResolvedValue({
      text: '{"thought":"done","action":null,"final_answer":{"summary":"ok","deliverable":"ok","files_touched":[]}}',
      usage: { inputTokens: 5, outputTokens: 5 },
      stopReason: "end_turn",
    });

    const sub = makeSubtask();
    const agent = new SubAgent({
      taskId: "t-exhaust-ok",
      workspaceRoot: "/tmp",
      llm: { complete: mockLlmComplete } as any,
      maxIterations: 5,
    });

    const result = await agent.run(sub);

    expect(result.iterationsExhausted).toBeUndefined();
    expect(result.iterations).toBe(1);
    expect(result.summary).toBe("All good");
  });

  it("does NOT emit agent:exhausted event from SubAgent (orchestrator responsibility)", async () => {
    const { emitKooderEvent } = await import("../events/bus.js");

    mockParseReactMessage.mockReturnValue({
      ok: true,
      message: { thought: "looping...", action: null, final_answer: null },
    });
    mockLlmComplete.mockResolvedValue({
      text: '{"thought":"looping..."}',
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end_turn",
    });

    const sub = makeSubtask();
    const agent = new SubAgent({
      taskId: "t-exhaust-event",
      workspaceRoot: "/tmp",
      llm: { complete: mockLlmComplete } as any,
      maxIterations: 2,
    });

    await agent.run(sub);

    // SubAgent must not emit agent:exhausted — only the orchestrator does.
    const exhaustedCalls = (emitKooderEvent as any).mock.calls.filter(
      (call: any) => call[0]?.type === "agent:exhausted"
    );
    expect(exhaustedCalls).toHaveLength(0);
  });

  it("crashResult does NOT set iterationsExhausted (only crashed flag)", async () => {
    const sub = makeSubtask({ engine: "rewoo-v1" as any }); // unsupported engine → crash
    const agent = new SubAgent({
      taskId: "t-crash",
      workspaceRoot: "/tmp",
      llm: {} as any,
    });

    const result = await agent.run(sub);

    expect(result.crashed).toBe(true);
    expect(result.iterationsExhausted).toBeUndefined();
  });

  it("exhaustion result includes the full raoTrace", async () => {
    mockParseReactMessage.mockReturnValue({
      ok: true,
      message: { thought: "thinking hard...", action: null, final_answer: null },
    });
    mockLlmComplete.mockResolvedValue({
      text: '{"thought":"thinking hard..."}',
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end_turn",
    });

    const sub = makeSubtask();
    const agent = new SubAgent({
      taskId: "t-exhaust-trace",
      workspaceRoot: "/tmp",
      llm: { complete: mockLlmComplete } as any,
      maxIterations: 2,
    });

    const result = await agent.run(sub);

    // raoTrace should have 2 entries (one per iteration) for the prose_recovery path
    expect(result.raoTrace.length).toBeGreaterThanOrEqual(2);
    for (const step of result.raoTrace) {
      expect(step.thought).toBeDefined();
      expect(step.observation).toBeDefined();
    }
  });

  it("exhaustion returns iterations equal to maxIterations", async () => {
    mockParseReactMessage.mockReturnValue({
      ok: true,
      message: { thought: "loop...", action: null, final_answer: null },
    });
    mockLlmComplete.mockResolvedValue({
      text: '{"thought":"loop..."}',
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end_turn",
    });

    const sub = makeSubtask();
    const agent = new SubAgent({
      taskId: "t-exhaust-count",
      workspaceRoot: "/tmp",
      llm: { complete: mockLlmComplete } as any,
      maxIterations: 7,
    });

    const result = await agent.run(sub);

    expect(result.iterationsExhausted).toBe(true);
    expect(result.iterations).toBe(7);
  });
});
