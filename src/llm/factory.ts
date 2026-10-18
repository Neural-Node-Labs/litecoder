// xcoder:version 1 | xcoder:task task-c49600 | xcoder:updated 2026-08-13T13:51:25.757Z | xcoder:subtask code-st-6d79ef
import { LlmClient, type LlmClientOptions } from "./client.js";
import {
  loadLlmConfigFile,
  resolveLlmConfig,
  type AgentRole,
  type LlmConfig,
} from "../config/loadConfig.js";

/**
 * Sole production constructor path for LLM clients. Resolves the effective
 * per-role configuration from `.kooder/config/llm.yaml` (or built-in
 * DeepSeek defaults) and returns a transport ready for that role.
 *
 * Precedence in `resolveLlmConfig`: role block → `default` block → built-in
 * DeepSeek; `KOODER_MODEL` applies to `model` only.
 */
export function createLlmClient(
  role: AgentRole,
  overrides: { model?: string; maxTokens?: number } = {},
): LlmClient {
  const file = loadLlmConfigFile();
  const config = resolveLlmConfig(role, file);
  const opts = configToClientOptions(config);
  return new LlmClient({
    ...opts,
    model: overrides.model ?? opts.model,
    maxTokens: overrides.maxTokens ?? opts.maxTokens,
  });
}

function configToClientOptions(config: LlmConfig): LlmClientOptions {
  return {
    provider: config.provider ?? "deepseek",
    baseUrl: config.base_url,
    endpoint: config.endpoint,
    model: config.model,
    maxTokens: config.max_tokens,
    temperature: config.temperature,
    apiKeyEnv: config.api_key_env,
  };
}
