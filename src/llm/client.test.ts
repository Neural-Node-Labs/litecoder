// xcoder:version 1 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:05:04.376Z | xcoder:subtask code-st-b3a0c8
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for the LlmClient class.
 *
 * Covers the intended behavior after the ANTHROPIC_API_KEY to DEEPSEEK_API_KEY
 * migration (code-st-a983ca):
 * - Uses DEEPSEEK_API_KEY exclusively (no ANTHROPIC_API_KEY in code or errors)
 * - Connects to DeepSeek's Anthropic-compatible endpoint
 * - Defaults model to "deepseek-chat" with fallback to KOODER_MODEL
 * - Returns properly shaped LlmCompletion objects
 */
describe('LlmClient', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Hermetic across all three tiers: an ambient KOOBER_MODEL/XCODER_MODEL
    // must not leak into a test that assumes nothing is configured.
    delete process.env.KOODER_MODEL;
    delete process.env.KOOBER_MODEL;
    delete process.env.XCODER_MODEL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('DEEPSEEK_API_KEY validation', () => {
    it('throws when DEEPSEEK_API_KEY is not set', async () => {
      delete process.env.DEEPSEEK_API_KEY;

      const { LlmClient } = await import('./client.js');

      expect(() => new LlmClient()).toThrow(
        'DEEPSEEK_API_KEY is not set'
      );
    });

    it('throws when DEEPSEEK_API_KEY is empty string', async () => {
      process.env.DEEPSEEK_API_KEY = '';

      const { LlmClient } = await import('./client.js');

      expect(() => new LlmClient()).toThrow(
        'DEEPSEEK_API_KEY is not set'
      );
    });

    it('does NOT throw when DEEPSEEK_API_KEY is present', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-key-12345';

      const { LlmClient } = await import('./client.js');

      expect(() => new LlmClient()).not.toThrow();
    });

    it('does NOT reference ANTHROPIC_API_KEY in error message', async () => {
      delete process.env.DEEPSEEK_API_KEY;

      const { LlmClient } = await import('./client.js');

      try {
        new LlmClient();
      } catch (e: any) {
        expect(e.message).not.toContain('ANTHROPIC_API_KEY');
        expect(e.message).not.toContain('ANTHROPIC');
      }
    });
  });

  describe('model configuration', () => {
    it('defaults model to "deepseek-chat" when no options or env set', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      delete process.env.KOODER_MODEL;

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient();

      expect((client as any).model).toBe('deepseek-chat');
    });

    it('uses KOODER_MODEL env var when set', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      process.env.KOODER_MODEL = 'deepseek-reasoner';

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient();

      expect((client as any).model).toBe('deepseek-reasoner');
    });

    it('uses model from options over KOODER_MODEL', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      process.env.KOODER_MODEL = 'deepseek-reasoner';

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient({ model: 'custom-model' });

      expect((client as any).model).toBe('custom-model');
    });

    it('uses model from options when KOODER_MODEL is not set', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      delete process.env.KOODER_MODEL;

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient({ model: 'deepseek-v3' });

      expect((client as any).model).toBe('deepseek-v3');
    });
  });

  describe('maxTokens configuration', () => {
    it('defaults maxTokens to 16384', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient();

      expect((client as any).maxTokens).toBe(16384);
    });

    it('uses maxTokens from options', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient({ maxTokens: 8192 });

      expect((client as any).maxTokens).toBe(8192);
    });
  });

  describe('Anthropic SDK configuration', () => {
    it('uses DeepSeek baseURL for Anthropic SDK', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      const mockAnthropicConstructor = vi.fn();

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: mockAnthropicConstructor,
      }));

      const { LlmClient } = await import('./client.js');
      new LlmClient();

      expect(mockAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-test',
          baseURL: 'https://api.deepseek.com/anthropic',
        })
      );
    });

    it('is NOT initialized without DEEPSEEK_API_KEY', async () => {
      delete process.env.DEEPSEEK_API_KEY;

      const mockAnthropicConstructor = vi.fn();

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: mockAnthropicConstructor,
      }));

      const { LlmClient } = await import('./client.js');

      expect(() => new LlmClient()).toThrow();
      expect(mockAnthropicConstructor).not.toHaveBeenCalled();
    });
  });

  describe('complete method', () => {
    it('returns text, usage, stopReason, and model from API response', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello from DeepSeek' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      // Must be a constructor function, not an arrow
      function MockAnthropic(this: any) {
        this.messages = { create: mockCreate };
      }

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: MockAnthropic,
      }));

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient({ model: 'deepseek-chat' });

      const result = await client.complete('You are helpful.', [
        { role: 'user', content: 'Hi' },
      ]);

      expect(result).toEqual({
        text: 'Hello from DeepSeek',
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end_turn',
        model: 'deepseek-chat',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'deepseek-chat',
        max_tokens: 16384,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
      });
    });

    it('handles missing usage gracefully', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      function MockAnthropic(this: any) {
        this.messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Response' }],
            stop_reason: null,
          }),
        };
      }

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: MockAnthropic,
      }));

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient();

      const result = await client.complete('sys', [{ role: 'user', content: 'q' }]);

      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(result.stopReason).toBeNull();
    });

    it('handles "length" stop reason (DeepSeek synonym for max_tokens)', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      function MockAnthropic(this: any) {
        this.messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Partial response' }],
            usage: { input_tokens: 5, output_tokens: 100 },
            stop_reason: 'length',
          }),
        };
      }

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: MockAnthropic,
      }));

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient();

      const result = await client.complete('sys', [{ role: 'user', content: 'q' }]);

      expect(result.stopReason).toBe('length');
      expect(result.text).toBe('Partial response');
    });

    it('concatenates multiple text blocks with newlines', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';

      function MockAnthropic(this: any) {
        this.messages = {
          create: vi.fn().mockResolvedValue({
            content: [
              { type: 'text', text: 'First part.' },
              { type: 'text', text: 'Second part.' },
            ],
            usage: { input_tokens: 5, output_tokens: 10 },
            stop_reason: 'end_turn',
          }),
        };
      }

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: MockAnthropic,
      }));

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient();

      const result = await client.complete('sys', [{ role: 'user', content: 'q' }]);

      expect(result.text).toBe('First part.\nSecond part.');
    });
  });

  describe('OpenAI-compatible provider (multi-provider support)', () => {
    it('routes chat.completions to the configured base URL with the env-key secret', async () => {
      process.env.MY_LLM_KEY = 'sk-custom';

      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'OpenAI response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      });
      let sdkOpts: any;
      function MockOpenAI(this: any, opts: any) {
        sdkOpts = opts;
        this.chat = { completions: { create: mockCreate } };
      }

      vi.doMock('openai', () => ({ default: MockOpenAI }));

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        endpoint: '/chat/completions',
        model: 'gpt-4o',
        maxTokens: 4000,
        temperature: 0.2,
        apiKeyEnv: 'MY_LLM_KEY',
      });

      expect(sdkOpts).toEqual(
        expect.objectContaining({
          apiKey: 'sk-custom',
          baseURL: 'https://api.openai.com/v1',
        })
      );

      const result = await client.complete('sys', [{ role: 'user', content: 'hi' }]);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4o',
        max_tokens: 4000,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
      });
      expect(result.text).toBe('OpenAI response');
      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
      expect(result.stopReason).toBe('stop');
      expect(result.model).toBe('gpt-4o');
    });

    it('defaults to /chat/completions and tolerates keyless local providers', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'local response' }, finish_reason: 'stop' }],
        usage: {},
      });
      let sdkOpts: any;
      function MockOpenAI(this: any, opts: any) {
        sdkOpts = opts;
        this.chat = { completions: { create: mockCreate } };
      }

      vi.doMock('openai', () => ({ default: MockOpenAI }));

      const { LlmClient } = await import('./client.js');
      const client = new LlmClient({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3',
      });

      // No api_key_env and no API key: keyless local providers accept a placeholder.
      expect(sdkOpts.apiKey).toBe('ollama');

      const result = await client.complete('sys', [{ role: 'user', content: 'q' }]);
      expect(result.text).toBe('local response');
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llama3',
          max_tokens: 16384,
        })
      );
    });
  });

  describe('Anthropic provider (native)', () => {
    it('uses ANTHROPIC_API_KEY and the Anthropic base URL', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-123';

      const mockAnthropicConstructor = vi.fn();

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: mockAnthropicConstructor,
      }));

      const { LlmClient } = await import('./client.js');
      new LlmClient({ provider: 'anthropic', model: 'claude-sonnet', maxTokens: 8192 });

      expect(mockAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-test-123',
          baseURL: 'https://api.anthropic.com',
        })
      );
    });
  });
});
