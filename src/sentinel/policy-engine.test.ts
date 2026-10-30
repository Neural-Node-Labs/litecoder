// xcoder:version 6 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:37:14.629Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { evaluate } from './policy-engine.js';
import type { PolicyContext } from './policy/rules.js';
import type { ModelAnalysis } from './schema.js';

const ADMIN = '10.0.0.5';
const ATTACKER = '203.0.113.9';

type CtxOverrides = Partial<Omit<PolicyContext, 'analysis'>> & { analysis?: Partial<ModelAnalysis> };

function ctx(over: CtxOverrides = {}): PolicyContext {
  const { analysis: analysisOverride, ...rest } = over;
  const o = analysisOverride ?? {};
  const analysis: ModelAnalysis = {
    threatDetected: o.threatDetected ?? true,
    category: o.category ?? 'brute_force',
    severity: o.severity ?? 'high',
    confidence: o.confidence ?? 0.9,
    reason: o.reason ?? 'repeated failed logins',
    ...(o.matchedRuleHint !== undefined ? { matchedRuleHint: o.matchedRuleHint } : {}),
  };
  return {
    event: { sourceIp: ATTACKER },
    eventId: 'evt-1',
    model: { name: 'test-model', promptVersion: 'sentinel-analyze@1' },
    analysis,
    schemaValid: true,
    history: {
      failedAuthCount: () => 5,
      isBlocked: () => false,
    },
    allowlist: new Set([ADMIN]),
    config: { blockDurationMinutes: 60, maxFailedAttempts: 5 },
    now: new Date('2026-01-01T00:00:00Z'),
    ...rest,
  };
}

describe('policy evaluate', () => {
  it('never blocks the admin IP, even with a critical brute-force analysis', () => {
    const d = evaluate(ctx({ event: { sourceIp: ADMIN }, analysis: { severity: 'critical' } }));
    expect(d.action).toBe('no_action');
    expect(d.matchedRuleId).toBe('core.admin_ip_protection');
    expect(d.requiresApproval).toBe(false);
  });

  it('fails closed when the analysis is schema-invalid', () => {
    const d = evaluate(ctx({ schemaValid: false, analysis: { severity: 'critical' } }));
    expect(d.action).toBe('no_action');
    expect(d.matchedRuleId).toBeNull();
  });

  it('defaults to deny when nothing matches', () => {
    const d = evaluate(
      ctx({ analysis: { threatDetected: false, category: 'benign', severity: 'low' }, history: { failedAuthCount: () => 0, isBlocked: () => false } }),
    );
    expect(d.action).toBe('no_action');
    expect(d.matchedRuleId).toBeNull();
  });

  it('forces human approval for every block', () => {
    const d = evaluate(ctx());
    expect(d.action).toBe('block_ip');
    expect(d.requiresApproval).toBe(true);
  });

  it('never produces a permanent block', () => {
    const d = evaluate(ctx());
    expect(d.durationMinutes).toBe(60);
  });

  it('downgrades to alert when the IP is already blocked', () => {
    const d = evaluate(ctx({ history: { failedAuthCount: () => 5, isBlocked: () => true } }));
    expect(d.action).toBe('alert');
    expect(d.requiresApproval).toBe(false);
  });

  it('downgrades to alert when no IP could be extracted', () => {
    const d = evaluate(ctx({ event: { sourceIp: undefined } }));
    expect(d.action).toBe('alert');
    expect(d.targetIp).toBeUndefined();
  });
});
