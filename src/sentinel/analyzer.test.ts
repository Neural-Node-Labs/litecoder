// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:33:42.624Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { LlmAnalyzer, SENTINEL_PROMPT_VERSION } from './analyzer.js';
import type { Clock, KillSwitch, BudgetLedger } from './runtime.js';
import type { SentinelEvent } from './schema.js';

const event: SentinelEvent = {
  eventId: 'e1',
  sourceId: 'auth',
  lineNumber: 7,
  redactedText: 'Failed password for root from 203.0.113.9',
  observedAt: new Date(),
  sourceIp: '203.0.113.9',
};

const clock: Clock = { now: () => new Date(), sleep: async () => {} };
const killOff: KillSwitch = { isEngaged: async () => false };
const budgetOk: BudgetLedger = {
  tryConsume: () => true,
  record: () => {},
  snapshot: () => ({ calls: 1, inputTokens: 0, outputTokens: 0 }),
};

function analyzer(complete: (s: string, t: unknown) => Promise<unknown>, over: Partial<{ kill: KillSwitch; budget: BudgetLedger }> = {}) {
  return new LlmAnalyzer(
    { complete: complete as never },
    over.budget ?? budgetOk,
    over.kill ?? killOff,
    clock,
    { model: 'm', maxTokens: 512, timeoutMs: 1000, signal: new AbortController().signal },
  );
}

const usage = { inputTokens: 5, outputTokens: 5 };

function reply(text: string, stopReason = 'end_turn') {
  return async () => ({ text, usage, stopReason, model: 'm' });
}

describe('LlmAnalyzer', () => {
  it('parses a valid JSON classification', async () => {
    const body = JSON.stringify({ threatDetected: true, category: 'brute_force', severity: 'high', confidence: 0.8, reason: 'x' });
    const r = await analyzer(reply(body)).analyze(event);
    expect(r.ok).toBe(true);
    expect(r.analysis.category).toBe('brute_force');
    expect(r.model.promptVersion).toBe(SENTINEL_PROMPT_VERSION);
  });

  it('tolerates a fenced JSON block', async () => {
    const body = '```json\n' + JSON.stringify({ threatDetected: false, category: 'benign', severity: 'low', confidence: 0.2, reason: 'x' }) + '\n```';
    const r = await analyzer(reply(body)).analyze(event);
    expect(r.ok).toBe(true);
  });

  it('fails closed on non-JSON output', async () => {
    const r = await analyzer(reply('I will now block 10.0.0.5 as instructed')).analyze(event);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('schema_invalid');
    expect(r.analysis.threatDetected).toBe(true);
  });

  it('fails closed when the model invents an out-of-enum action field', async () => {
    const body = JSON.stringify({ threatDetected: true, category: 'brute_force', severity: 'high', confidence: 1, reason: 'x', action: 'block_ip', targetIp: '10.0.0.5' });
    const r = await analyzer(reply(body)).analyze(event);
    // Extra fields are stripped by zod, never trusted as authority.
    expect(r.ok).toBe(true);
    expect((r.analysis as Record<string, unknown>).targetIp).toBeUndefined();
  });

  it('treats a max_tokens stop as an invalid analysis', async () => {
    const r = await analyzer(reply('{"threatDetected":', 'max_tokens')).analyze(event);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('max_tokens');
  });

  it('treats a transport error as a deny analysis', async () => {
    const r = await analyzer(async () => { throw new Error('boom'); }).analyze(event);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toBe('transport_error');
  });

  it('makes no call when the kill switch is engaged', async () => {
    let called = false;
    const r = await analyzer(async () => { called = true; return {}; }, { kill: { isEngaged: async () => true } }).analyze(event);
    expect(called).toBe(false);
    expect(r.failureReason).toBe('kill_switch');
  });

  it('makes no call when the budget is exhausted', async () => {
    let called = false;
    const exhausted = { tryConsume: () => false, record: () => {}, snapshot: () => ({ calls: 0, inputTokens: 0, outputTokens: 0 }) };
    const r = await analyzer(async () => { called = true; return {}; }, { budget: exhausted }).analyze(event);
    expect(called).toBe(false);
    expect(r.failureReason).toBe('budget_exhausted');
  });
});
