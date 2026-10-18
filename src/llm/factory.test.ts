// xcoder:version 2 | xcoder:task task-c49600 | xcoder:updated 2026-08-13T13:58:30.123Z | xcoder:subtask code-st-6d79ef
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLlmClientCtor = vi.hoisted(() => vi.fn());
const mockLoadLlmConfigFile = vi.hoisted(() => vi.fn(() => ({})));
const mockResolveLlmConfig = vi.hoisted(() => vi.fn());

vi.mock("../config/loadConfig.js", () => ({
  loadLlmConfigFile: mockLoadLlmConfigFile,
  resolveLlmConfig: mockResolveLlmConfig,
}));

vi.mock("./client.js", () => ({
  LlmClient: class {
    constructor(opts: unknown) {
      mockLlmClientCtor(opts);
    }
  },
}));

import { createLlmClient } from "./factory.js";

describe("createLlmClient", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
    process.env.DEEPSEEK_API_KEY = "sk-test";
    mockResolveLlmConfig.mockReturnValue({
      provider: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      endpoint: "/chat/completions",
      model: "deepseek-chat",
      api_key_env: "DEEPSEEK_API_KEY",
      max_tokens: 16384,
      temperature: 0.0,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves the config for the requested role", () => {
    createLlmClient("sub_agent");
    expect(mockResolveLlmConfig).toHaveBeenCalledWith("sub_agent", {});
  });

  it("constructs an LlmClient from the resolved config", () => {
    createLlmClient("orchestrator", { model: "overridden-model" });
    expect(mockLlmClientCtor).toHaveBeenCalledWith({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      endpoint: "/chat/completions",
      model: "overridden-model",
      maxTokens: 16384,
      temperature: 0.0,
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("passes role-specific configs through to distinct clients", () => {
    mockResolveLlmConfig.mockImplementation((role: string) => ({
      provider: "openai-compatible",
      base_url: `https://${role}.example.com/v1`,
      endpoint: "/chat/completions",
      model: `${role}-model`,
      api_key_env: role === "swarm_agent" ? "SWARM_KEY" : "SUB_KEY",
      max_tokens: 8192,
      temperature: 0.1,
    }));

    createLlmClient("sub_agent");
    createLlmClient("swarm_agent");

    const calls = mockLlmClientCtor.mock.calls as [Record<string, unknown>][];
    expect(calls[0][0].baseUrl).toBe("https://sub_agent.example.com/v1");
    expect(calls[1][0].baseUrl).toBe("https://swarm_agent.example.com/v1");
    expect(calls[0][0].model).toBe("sub_agent-model");
    expect(calls[1][0].model).toBe("swarm_agent-model");
  });

  it("applies maxTokens from the override", () => {
    createLlmClient("instance_agent", { maxTokens: 8192 });
    const call = mockLlmClientCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(call.maxTokens).toBe(8192);
  });
});
