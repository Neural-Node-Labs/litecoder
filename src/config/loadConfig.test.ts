// xcoder:version 1 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:05:54.254Z | xcoder:subtask code-st-b3a0c8
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLlmConfigFile, resolveLlmConfig, deepseekDefaultConfig, type LlmConfig, type LlmConfigFile } from "./loadConfig.js";
import { resetUserConfigCache } from "./user-config.js";

async function writeFixture(content: string, dir: string): Promise<string> {
  await fs.mkdir(path.join(dir, ".kooder", "config"), { recursive: true });
  const p = path.join(dir, ".kooder", "config", "llm.yaml");
  await fs.writeFile(p, content);
  return p;
}

let tmpDirs: string[] = [];
let originalXcoderModel: string | undefined;
let originalDeepSeekKey: string | undefined;

let originalConfigFile: string | undefined;
let emptyConfigFile: string;

beforeEach(async () => {
  tmpDirs = [];
  originalXcoderModel = process.env.KOODER_MODEL;
  originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  originalConfigFile = process.env.KOODER_CONFIG_FILE;
  delete process.env.KOODER_MODEL;
  delete process.env.KOOBER_MODEL;
  delete process.env.XCODER_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  // Hermetic: the developer's own ~/.kooder/config.json must never leak in.
  const cfgDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmcfg-user-"));
  tmpDirs.push(cfgDir);
  emptyConfigFile = path.join(cfgDir, "config.json");
  process.env.KOODER_CONFIG_FILE = emptyConfigFile;
  resetUserConfigCache();
});

afterEach(async () => {
  if (originalXcoderModel === undefined) delete process.env.KOODER_MODEL;
  else process.env.KOODER_MODEL = originalXcoderModel;
  if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  if (originalConfigFile === undefined) delete process.env.KOODER_CONFIG_FILE;
  else process.env.KOODER_CONFIG_FILE = originalConfigFile;
  resetUserConfigCache();
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

describe("loadLlmConfigFile", () => {
  it("returns empty object when no config file exists", () => {
    const file = loadLlmConfigFile("/nonexistent/path/llm.yaml");
    expect(file).toEqual({});
  });

  it("reads a legacy single-block file as the default block", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmcfg-"));
    tmpDirs.push(dir);
    const configPath = await writeFixture("provider: deepseek\nmodel: legacy-model\nmax_tokens: 8192\ntemperature: 0.0\n", dir);
    const file = loadLlmConfigFile(configPath);
    expect(file.default?.model).toBe("legacy-model");
  });

  it("reads a four-role file with per-role blocks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmcfg-"));
    tmpDirs.push(dir);
    const configPath = await writeFixture(
      `default:
  provider: deepseek
  model: deepseek-chat
  max_tokens: 16384
  temperature: 0.0
orchestrator:
  provider: openai-compatible
  base_url: https://api.openai.com/v1
  endpoint: /chat/completions
  model: gpt-4o
  api_key_env: OPENAI_API_KEY
  max_tokens: 8192
  temperature: 0.0
`,
      dir
    );
    const file = loadLlmConfigFile(configPath);
    expect(file.orchestrator?.model).toBe("gpt-4o");
    expect(file.default?.model).toBe("deepseek-chat");
  });
});

describe("resolveLlmConfig", () => {
  it("uses the role block over the default block", () => {
    const file: LlmConfigFile = {
      default: { provider: "deepseek", model: "deepseek-chat", max_tokens: 16384, temperature: 0.0, api_key_env: "DEEPSEEK_API_KEY" },
      swarm_agent: { provider: "openai-compatible", base_url: "https://groq.example/v1", endpoint: "/chat/completions", model: "groq-model", max_tokens: 8192, temperature: 0.1, api_key_env: "GROQ_API_KEY" },
    };
    const resolved = resolveLlmConfig("swarm_agent", file);
    expect(resolved.provider).toBe("openai-compatible");
    expect(resolved.model).toBe("groq-model");
    expect(resolved.temperature).toBe(0.1);
  });

  it("falls back to the default block when the role block is absent", () => {
    const file: LlmConfigFile = {
      default: { provider: "openai-compatible", base_url: "https://openrouter.example/v1", endpoint: "/chat/completions", model: "openrouter-model", max_tokens: 4096, temperature: 0.0, api_key_env: "OPENROUTER_API_KEY" },
    };
    const resolved = resolveLlmConfig("sub_agent", file);
    expect(resolved.model).toBe("openrouter-model");
    expect(resolved.provider).toBe("openai-compatible");
  });

  it("falls back to built-in DeepSeek defaults when no blocks exist", () => {
    const resolved = resolveLlmConfig("orchestrator", {});
    expect(resolved.provider).toBe("deepseek");
    expect(resolved.model).toBe("deepseek-chat");
    expect(resolved.max_tokens).toBe(16384);
  });

  it("applies KOODER_MODEL to model only", () => {
    process.env.KOODER_MODEL = "deepseek-reasoner";
    const resolved = resolveLlmConfig("orchestrator");
    expect(resolved.model).toBe("deepseek-reasoner");
    expect(resolved.provider).toBe("deepseek");
  });

  it("deepseekDefaultConfig returns the shipped default shape", () => {
    const cfg = deepseekDefaultConfig();
    expect(cfg.provider).toBe("deepseek");
    expect(cfg.base_url).toBe("https://api.deepseek.com/anthropic");
    expect(cfg.endpoint).toBeUndefined();
    expect(cfg.api_key_env).toBe("DEEPSEEK_API_KEY");
    expect(cfg.max_tokens).toBe(16384);
    expect(cfg.model).toBe("deepseek-chat");
  });

  it("resolves each of the four agent roles independently", () => {
    const file: LlmConfigFile = {
      default: { provider: "deepseek", model: "deepseek-chat", max_tokens: 16384, temperature: 0.0, api_key_env: "DEEPSEEK_API_KEY" },
      orchestrator: { provider: "anthropic", model: "claude-sonnet", max_tokens: 8192, temperature: 0.2, api_key_env: "ANTHROPIC_API_KEY" },
      sub_agent: { provider: "openai-compatible", base_url: "https://api.openai.com/v1", endpoint: "/chat/completions", model: "gpt-4o", max_tokens: 4096, temperature: 0.3, api_key_env: "OPENAI_API_KEY" },
      swarm_agent: { provider: "openai-compatible", base_url: "https://api.groq.com/openai/v1", endpoint: "/chat/completions", model: "llama-3.1-70b", max_tokens: 2048, temperature: 0.4, api_key_env: "GROQ_API_KEY" },
      instance_agent: { provider: "openai-compatible", base_url: "http://localhost:11434/v1", endpoint: "/chat/completions", model: "llama3", max_tokens: 1024, temperature: 0.5 },
    };
    expect(resolveLlmConfig("orchestrator", file).model).toBe("claude-sonnet");
    expect(resolveLlmConfig("sub_agent", file).model).toBe("gpt-4o");
    expect(resolveLlmConfig("swarm_agent", file).model).toBe("llama-3.1-70b");
    expect(resolveLlmConfig("instance_agent", file).model).toBe("llama3");
    // Keyless local providers may omit api_key_env; resolution still carries
    // the documented default (the client only uses it when the var exists,
    // otherwise it substitutes a placeholder for Ollama/LM Studio).
    expect(resolveLlmConfig("instance_agent", file).api_key_env).toBe("DEEPSEEK_API_KEY");
  });

  it("selects a partial role block wholesale and applies hard defaults", () => {
    // A role block is selected as-is (precedence: role → default → built-in),
    // not merged field-by-field with the default block. Missing optional
    // fields are filled by the hard defaults below, and transport-level
    // defaults (endpoint /chat/completions) live in the client.
    const file: LlmConfigFile = {
      default: { provider: "deepseek", base_url: "https://api.deepseek.com/anthropic", model: "deepseek-chat", max_tokens: 16384, temperature: 0.0, api_key_env: "DEEPSEEK_API_KEY", thinking: false },
      orchestrator: { provider: "openai-compatible", base_url: "https://api.openai.com/v1", model: "gpt-4o", api_key_env: "OPENAI_API_KEY", max_tokens: 4096, temperature: 0.7 },
    };
    const resolved = resolveLlmConfig("orchestrator", file);
    expect(resolved.model).toBe("gpt-4o");
    expect(resolved.endpoint).toBeUndefined();
    // Wholesale block selection: the role block's own values win over the
    // default block, and nothing from the default block leaks through.
    expect(resolved.max_tokens).toBe(4096);
    expect(resolved.temperature).toBe(0.7);
  });

  it("treats a mixed-schema file with legacy top-level keys and role blocks as role blocks", async () => {
    // A partially migrated file carries BOTH a legacy top-level provider
    // block (line 1-3 below) and the new per-role schema. The legacy
    // path must NOT swallow the whole object as the `default` block —
    // every role block must be honored (defect0009).
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmcfg-mixed-"));
    tmpDirs.push(dir);
    const configPath = await writeFixture(
      `provider: deepseek\nbase_url: https://api.deepseek.com/v1\nmodel: legacy-model\nmax_tokens: 16384\ntemperature: 0.0\ndefault:\n  provider: deepseek\n  base_url: https://api.deepseek.com/anthropic\n  model: deepseek-chat\n  api_key_env: DEEPSEEK_API_KEY\n  max_tokens: 16384\n  temperature: 0.0\ninstance_agent:\n  provider: deepseek\n  base_url: https://api.deepseek.com/anthropic\n  model: deepseek-v4-flash\n  api_key_env: DEEPSEEK_API_KEY\n  max_tokens: 8192\n  temperature: 0.0\n`,
      dir
    );
    const file = loadLlmConfigFile(configPath);
    expect(file.default?.model).toBe("deepseek-chat");
    // Role block honored instead of being swallowed by the legacy block.
    expect(file.instance_agent?.model).toBe("deepseek-v4-flash");
    expect(file.instance_agent?.base_url).toBe("https://api.deepseek.com/anthropic");
  });

  it("routes every role in the shipped config to the Anthropic-compatible DeepSeek root", async () => {
    // Guard against the shipped default/base blocks slipping back to the
    // OpenAI-compatible https://api.deepseek.com/v1 root, which yields the
    // invalid .../v1/v1/messages Anthropic request path (defect0009).
    //
    // The shipped config lives under `.xcoder/`, which is gitignored, so it
    // can never be relied on to exist in a fresh checkout. Assert against the
    // documented shipped content instead (docs/core/support-multiple-llm-connection.md).
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmcfg-shipped-"));
    tmpDirs.push(dir);
    const shippedPath = await writeFixture(
      [
        "default:",
        "  provider: deepseek",
        "  base_url: https://api.deepseek.com/anthropic",
        "  model: deepseek-v4-pro",
        "  api_key_env: DEEPSEEK_API_KEY",
        "  max_tokens: 16384",
        "  temperature: 0.0",
        "instance_agent:",
        "  provider: deepseek",
        "  base_url: https://api.deepseek.com/anthropic",
        "  model: deepseek-v4-flash",
        "  api_key_env: DEEPSEEK_API_KEY",
        "  max_tokens: 8192",
        "  temperature: 0.0",
        "orchestrator:",
        "  provider: openai-compatible",
        "  base_url: https://api.openai.com/v1",
        "  endpoint: /chat/completions",
        "  model: gpt-4o",
        "  api_key_env: OPENAI_API_KEY",
        "  max_tokens: 8192",
        "  temperature: 0.0",
        "swarm_agent:",
        "  provider: openai-compatible",
        "  base_url: https://api.groq.com/openai/v1",
        "  endpoint: /chat/completions",
        "  model: groq-model",
        "  api_key_env: GROQ_API_KEY",
        "  max_tokens: 8192",
        "  temperature: 0.1",
      ].join("\n"),
      dir,
    );
    const file = loadLlmConfigFile(shippedPath);
    expect(file.default?.base_url).toBe("https://api.deepseek.com/anthropic");
    expect(resolveLlmConfig("instance_agent", file).base_url).toBe("https://api.deepseek.com/anthropic");
    // Orchestrator is explicitly configured as OpenAI-compatible in the shipped config.
    expect(resolveLlmConfig("orchestrator", file).base_url).toBe("https://api.openai.com/v1");
    const resolvedSwarm = resolveLlmConfig("swarm_agent", file);
    expect(resolvedSwarm.provider).toBe("openai-compatible");
  });

  it("fills all required fields after role-block resolution", () => {
    // Sparse YAML role blocks are loaded as-is; resolution must hard-fill
    // the required transport fields (RCA: LLM provider config schema).
    const file: LlmConfigFile = {
      instance_agent: { provider: "openai-compatible", model: "custom" } as unknown as LlmConfig,
    };
    const resolved = resolveLlmConfig("instance_agent", file);
    expect(resolved.provider).toBe("openai-compatible");
    expect(resolved.model).toBe("custom");
    expect(resolved.max_tokens).toBe(16384);
    expect(resolved.temperature).toBe(0.0);
    expect(resolved.api_key_env).toBe("DEEPSEEK_API_KEY");
  });
});
