// xcoder:version 1 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:05:07.713Z | xcoder:subtask code-st-b3a0c8
// Integration-style tests for createLlmClient transport wiring.
//
// Intended behavior (docs/core/support-multiple-llm-connection.md):
// DeepSeek is the zero-config default provider and speaks the Anthropic
// Messages protocol via DeepSeek's Anthropic-compatible endpoint. The
// client-level default base URL for that transport is
// https://api.deepseek.com/anthropic and the Anthropic SDK appends
// /v1/messages to it, producing
// https://api.deepseek.com/anthropic/v1/messages. Only an EXPLICIT
// base_url in llm.yaml may override it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetUserConfigCache } from "../config/user-config.js";

interface SdkHandle {
  baseURL: string;
}

let originalEnv: NodeJS.ProcessEnv;
let tmpDir: string;
let tmpDirs: string[];

beforeEach(async () => {
  originalEnv = { ...process.env };
  // Hermetic across all three tiers: an ambient KOOBER_MODEL/XCODER_MODEL
  // must not leak into these zero-config tests.
  delete process.env.KOODER_MODEL;
  delete process.env.KOOBER_MODEL;
  delete process.env.XCODER_MODEL;
  tmpDirs = [];
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-zero-"));
  tmpDirs.push(tmpDir);
  // Hermetic zero-config: point KOODER_DIR at an empty temp directory so
  // the real on-disk .xcoder/config/llm.yaml can never shadow the built-in
  // default. loadLlmConfigFile() then returns {} and resolveLlmConfig
  // falls back to deepseekDefaultConfig().
  process.env.KOODER_DIR = tmpDir;
  // The user-level config (~/.kooder/config.json) is a SEPARATE path and is
  // applied on top of the resolved block; point it at a file that does not
  // exist so a developer's real provider/model never leaks into these tests.
  process.env.KOODER_CONFIG_FILE = path.join(tmpDir, "no-user-config.json");
  resetUserConfigCache();
});

afterEach(async () => {
  process.env = originalEnv;
  resetUserConfigCache();
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("createLlmClient zero-config DeepSeek transport (intended behavior)", () => {
  it("routes the built-in DeepSeek default to the Anthropic-compatible endpoint root", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const { createLlmClient } = await import("./factory.js");
    const client = createLlmClient("orchestrator") as unknown as {
      provider: string;
      anthropic: SdkHandle | null;
      openai: SdkHandle | null;
    };
    expect(client.provider).toBe("deepseek");
    expect(client.anthropic).not.toBeNull();
    expect(client.openai).toBeNull();
    // The Anthropic SDK posts to `${baseURL}/v1/messages`, so the final
    // Messages URL must be .../anthropic/v1/messages — NOT .../v1/v1/messages.
    expect(client.anthropic!.baseURL).toBe("https://api.deepseek.com/anthropic");
  });

  it("keeps the Anthropic-compatible root for every agent role with zero config", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const { createLlmClient } = await import("./factory.js");
    for (const role of ["orchestrator", "sub_agent", "swarm_agent", "instance_agent"] as const) {
      const client = createLlmClient(role) as unknown as { anthropic: SdkHandle | null };
      expect(client.anthropic!.baseURL, `role ${role}`).toBe("https://api.deepseek.com/anthropic");
    }
  });
});

describe("createLlmClient per-role provider separation (fixture-driven, intended behavior)", () => {
  async function writeLlmFixture(content: string): Promise<void> {
    await fs.mkdir(path.join(tmpDir, "config"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "config", "llm.yaml"), content);
  }

  it("routes each agent role to its own configured provider/transport", async () => {
    const fixture = [
      "default:", "  provider: deepseek", "  base_url: https://api.deepseek.com/anthropic", "  model: deepseek-chat", "  api_key_env: DEEPSEEK_API_KEY", "  max_tokens: 16384", "  temperature: 0.0",
      "orchestrator:", "  provider: openai-compatible", "  base_url: https://api.openai.com/v1", "  endpoint: /chat/completions", "  model: gpt-4o", "  api_key_env: OPENAI_API_KEY", "  max_tokens: 16384", "  temperature: 0.0",
      "sub_agent:", "  provider: openai-compatible", "  base_url: https://openrouter.ai/api/v1", "  endpoint: /chat/completions", "  model: openai/gpt-4o", "  api_key_env: OPENROUTER_API_KEY", "  max_tokens: 16384", "  temperature: 0.0",
      "swarm_agent:", "  provider: openai-compatible", "  base_url: http://localhost:11434/v1", "  endpoint: /chat/completions", "  model: llama3.1", "  api_key_env: OLLAMA_API_KEY", "  max_tokens: 8192", "  temperature: 0.1",
      "instance_agent:", "  provider: deepseek", "  base_url: https://api.deepseek.com/anthropic", "  model: deepseek-v4-flash", "  api_key_env: DEEPSEEK_API_KEY", "  max_tokens: 8192", "  temperature: 0.0",
    ].join("\n");
    await writeLlmFixture(fixture);
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const { createLlmClient } = await import("./factory.js");
    const ts = (client: unknown) => client as unknown as { provider: string; model: string; endpoint?: string; anthropic: SdkHandle | null; openai: SdkHandle | null };

    const orchestrator = ts(createLlmClient("orchestrator"));
    expect(orchestrator.provider).toBe("openai-compatible");
    expect(orchestrator.openai?.baseURL).toBe("https://api.openai.com/v1");
    expect(orchestrator.endpoint).toBe("/chat/completions");
    expect(orchestrator.model).toBe("gpt-4o");
    expect(orchestrator.anthropic).toBeNull();

    const subAgent = ts(createLlmClient("sub_agent"));
    expect(subAgent.provider).toBe("openai-compatible");
    expect(subAgent.openai?.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(subAgent.model).toBe("openai/gpt-4o");

    const swarmAgent = ts(createLlmClient("swarm_agent"));
    expect(swarmAgent.provider).toBe("openai-compatible");
    expect(swarmAgent.openai?.baseURL).toBe("http://localhost:11434/v1");
    expect(swarmAgent.model).toBe("llama3.1");

    const instanceAgent = ts(createLlmClient("instance_agent"));
    expect(instanceAgent.provider).toBe("deepseek");
    expect(instanceAgent.anthropic?.baseURL).toBe("https://api.deepseek.com/anthropic");
    expect(instanceAgent.model).toBe("deepseek-v4-flash");
    expect(instanceAgent.openai).toBeNull();
  });

  it("applies the default block when a role block is absent", async () => {
    const fixture = [
      "default:", "  provider: deepseek", "  base_url: https://api.deepseek.com/anthropic", "  model: fallback-chat", "  api_key_env: DEEPSEEK_API_KEY", "  max_tokens: 4096", "  temperature: 0.0",
    ].join("\n");
    await writeLlmFixture(fixture);
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const { createLlmClient } = await import("./factory.js");
    const swarmAgent = createLlmClient("swarm_agent") as unknown as { provider: string; model: string; anthropic: SdkHandle | null };
    expect(swarmAgent.provider).toBe("deepseek");
    expect(swarmAgent.anthropic?.baseURL).toBe("https://api.deepseek.com/anthropic");
    expect(swarmAgent.model).toBe("fallback-chat");
  });
});
