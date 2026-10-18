// xcoder:version 2 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:36:21.701Z | xcoder:subtask code-st-1a0810
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import { readKooderEnv } from "../config/env.js";

export type LlmProvider = "deepseek" | "openai-compatible" | "anthropic";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmClientOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  provider?: LlmProvider;
  baseUrl?: string;
  endpoint?: string;
  apiKeyEnv?: string;
  apiKey?: string;
}

export interface LlmCompletion {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The API's stop reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'length' | 'stop' | 'tool_calls' | null. */
  stopReason: string | null;
  /** The model name used for this completion. */
  model: string;
}

/**
 * One call per ReAct turn: system prompt + running transcript in, raw text
 * + token usage out. Deliberately thin — the contract parsing lives in
 * `protocol/react-contract.ts`, not here, so this file never needs to know
 * what a valid response looks like. Callers are responsible for their own
 * try/catch around `complete()` — a transient API error here must not be
 * allowed to propagate all the way up and take the Master Orchestrator
 * down with it (see `agents/sub-agent.ts`).
 *
 * Transport selection:
 * - `"deepseek"` (default) — DeepSeek's Anthropic-compatible endpoint via
 *   `@anthropic-ai/sdk`; zero-config behavior is unchanged.
 * - `"openai-compatible"` — any OpenAI `chat/completions` provider via the
 *   `openai` SDK (OpenAI, Groq, OpenRouter, Ollama, LM Studio, vLLM, ...).
 * - `"anthropic"` — native Claude via `@anthropic-ai/sdk`.
 */
export class LlmClient {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
  private provider: LlmProvider;
  private model: string;
  private maxTokens: number;
  private temperature: number | undefined;
  private endpoint: string | undefined;

  constructor(opts: LlmClientOptions = {}) {
    this.provider = opts.provider ?? "deepseek";
    this.model = opts.model ?? readKooderEnv("KOODER_MODEL") ?? "deepseek-chat";
    this.maxTokens = opts.maxTokens ?? 16384;
    this.temperature = opts.temperature;

    if (this.provider === "openai-compatible") {
      let apiKey = opts.apiKey;
      if (!apiKey && opts.apiKeyEnv) {
        apiKey = process.env[opts.apiKeyEnv];
      }
      // Keyless local providers (Ollama, LM Studio) accept any placeholder.
      if (!apiKey) apiKey = "ollama";
      this.openai = new OpenAI({
        apiKey,
        baseURL: opts.baseUrl,
      });
      this.endpoint = opts.endpoint ?? "/chat/completions";
      return;
    }

    // `deepseek` (the zero-config default) and native `anthropic` both speak
    // the Anthropic Messages protocol.
    let apiKey = opts.apiKey;
    if (!apiKey && opts.apiKeyEnv) {
      apiKey = process.env[opts.apiKeyEnv];
    }
    if (!apiKey) {
      if (this.provider === "anthropic") {
        apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          throw new Error(
            "ANTHROPIC_API_KEY (or DEEPSEEK_API_KEY) is not set. Export it before running xcoder, e.g.\n" +
              '  export ANTHROPIC_API_KEY="sk-ant-..."'
          );
        }
      } else {
        apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          throw new Error(
            "DEEPSEEK_API_KEY is not set. Export it before running xcoder, e.g.\n" +
              '  export DEEPSEEK_API_KEY="sk-..."'
          );
        }
      }
    }
    const baseURL =
      opts.baseUrl ??
      (this.provider === "anthropic"
        ? "https://api.anthropic.com"
        : "https://api.deepseek.com/anthropic");
    this.anthropic = new Anthropic({ apiKey, baseURL });
  }

  async complete(systemPrompt: string, transcript: LlmMessage[]): Promise<LlmCompletion> {
    if (this.provider === "openai-compatible" && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...transcript.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      const choice = response.choices?.[0];
      return {
        text: (choice?.message?.content as string | null) ?? "",
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        stopReason: choice?.finish_reason ?? null,
        model: this.model,
      };
    }

    if (!this.anthropic) {
      throw new Error(`LLM transport not initialized for provider "${this.provider}"`);
    }
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      system: systemPrompt,
      messages: transcript.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();
    return {
      text,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
      stopReason: response.stop_reason ?? null,
      model: this.model,
    };
  }
}
