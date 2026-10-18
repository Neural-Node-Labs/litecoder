// xcoder:version 2 | xcoder:task task-c49600 | xcoder:updated 2026-08-13T14:39:38.641Z | xcoder:subtask test-st-752ea5
// Wiring test for the per-role LLM split: swarm workers must use the
// dedicated swarm_agent client (`subAgentLlm`) when supplied, and fall
// back to the shared client only when it is absent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubtaskNode } from "../types.js";

const capturedOptions: Array<Record<string, unknown>> = [];

vi.mock("../agents/sub-agent.js", () => ({
  SubAgent: class {
    constructor(opts: Record<string, unknown>) {
      capturedOptions.push(opts);
    }
    async run() {
      return {
        summary: "ok",
        deliverable: null,
        filesTouched: [],
        raoTrace: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        iterations: 1,
        crashed: false,
      };
    }
  },
}));

import { LlmClient } from "../llm/client.js";
import { dispatchSwarm } from "./swarm.js";

function makeNode(id: string): SubtaskNode {
  return {
    id,
    stage: "plan" as never,
    role: "coder" as never,
    engine: "subagent" as never,
    dependsOn: [],
    goal: id,
    upstreamContext: {},
    deliverableSpec: "spec",
    acceptanceCriteria: [{ id: "ac1", type: "rubric", description: "works" }],
    status: "ready" as never,
    healing: { attempts: 0, maxAttempts: 2, log: [] },
  };
}

beforeEach(() => {
  capturedOptions.length = 0;
});

describe("dispatchSwarm LLM wiring", () => {
  it("passes the dedicated subAgentLlm (swarm_agent client) to workers", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const orchestratorLlm = new LlmClient({ model: "orchestrator-model" });
    const swarmLlm = new LlmClient({ model: "swarm-model" });

    const results = await dispatchSwarm([makeNode("n1")], {
      taskId: "t1",
      workspaceRoot: process.cwd(),
      llm: orchestratorLlm,
      subAgentLlm: swarmLlm,
      concurrency: 1,
    });

    expect(results).toHaveLength(1);
    expect(capturedOptions[0].llm).toBe(swarmLlm);
    expect(capturedOptions[0].llm).not.toBe(orchestratorLlm);
  });

  it("falls back to the shared llm when subAgentLlm is absent", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const orchestratorLlm = new LlmClient({ model: "orchestrator-model" });

    await dispatchSwarm([makeNode("n1")], {
      taskId: "t1",
      workspaceRoot: process.cwd(),
      llm: orchestratorLlm,
      concurrency: 1,
    });

    expect(capturedOptions[0].llm).toBe(orchestratorLlm);
  });
});
