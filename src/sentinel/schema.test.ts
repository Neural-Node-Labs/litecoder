// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:57:45.333Z | xcoder:subtask test-st-50b14d
/**
 * Contract tests for the Sentinel shared vocabulary.
 *
 * These assert the INTENDED security design, not merely current behaviour:
 * the model classifies, it never acts. A compromised or prompt-injected LLM
 * must be structurally unable to name a target, pick an action, or request a
 * permanent rule - even if it emits those fields, they must not survive
 * parsing.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DENY_ANALYSIS,
  ModelAnalysis,
  SEVERITY_RANK,
  SentinelAction,
  Severity,
} from './schema.js';

const VALID_ANALYSIS = {
  threatDetected: true,
  category: 'brute_force' as const,
  severity: 'high' as const,
  confidence: 0.82,
  reason: 'many failed logins from one address',
};

describe('SentinelAction - closed action surface', () => {
  it('accepts exactly the four designed actions', () => {
    for (const a of ['no_action', 'alert', 'block_ip', 'unblock_ip'] as const) {
      expect(SentinelAction.safeParse(a).success).toBe(true);
    }
    expect(SentinelAction.options).toHaveLength(4);
  });

  it('rejects any attempt to widen the surface to arbitrary commands', () => {
    for (const bad of [
      'exec_shell',
      'run',
      'iptables -A INPUT -j DROP',
      'block_ip; rm -rf /',
      'BLOCK_IP',
      '',
      null,
      0,
    ]) {
      expect(SentinelAction.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe('ModelAnalysis - the model cannot act', () => {
  it('parses a well-formed classification', () => {
    const parsed = ModelAnalysis.parse(VALID_ANALYSIS);
    expect(parsed.threatDetected).toBe(true);
    expect(parsed.category).toBe('brute_force');
    expect(parsed.severity).toBe('high');
    expect(parsed.confidence).toBeCloseTo(0.82);
  });

  it('DROPS a target IP supplied by the model', () => {
    const parsed = ModelAnalysis.parse({ ...VALID_ANALYSIS, targetIp: '203.0.113.9' });
    expect(parsed).not.toHaveProperty('targetIp');
  });

  it('DROPS a model-chosen action', () => {
    const parsed = ModelAnalysis.parse({ ...VALID_ANALYSIS, action: 'block_ip' });
    expect(parsed).not.toHaveProperty('action');
  });

  it('DROPS a model-requested duration / permanence', () => {
    for (const key of ['durationMinutes', 'permanent', 'duration', 'forever']) {
      const parsed = ModelAnalysis.parse({ ...VALID_ANALYSIS, [key]: 0 });
      expect(parsed, key).not.toHaveProperty(key);
    }
  });

  it('DROPS unknown future fields rather than forwarding them to the executor', () => {
    const parsed = ModelAnalysis.parse({ ...VALID_ANALYSIS, requiresApproval: false, verdict: 'allow' });
    expect(parsed).not.toHaveProperty('requiresApproval');
    expect(parsed).not.toHaveProperty('verdict');
  });

  it('rejects a missing or out-of-range confidence', () => {
    const { confidence: _drop, ...noConfidence } = VALID_ANALYSIS;
    expect(ModelAnalysis.safeParse(noConfidence).success).toBe(false);
    expect(ModelAnalysis.safeParse({ ...VALID_ANALYSIS, confidence: -0.01 }).success).toBe(false);
    expect(ModelAnalysis.safeParse({ ...VALID_ANALYSIS, confidence: 1.01 }).success).toBe(false);
  });

  it('rejects a category or severity outside the closed sets', () => {
    expect(ModelAnalysis.safeParse({ ...VALID_ANALYSIS, category: 'rm_rf' }).success).toBe(false);
    expect(ModelAnalysis.safeParse({ ...VALID_ANALYSIS, severity: 'apocalyptic' }).success).toBe(false);
  });

  it('rejects a missing threatDetected (never defaults to benign)', () => {
    const { threatDetected: _drop, ...rest } = VALID_ANALYSIS;
    expect(ModelAnalysis.safeParse(rest).success).toBe(false);
  });

  it('caps reason length so a log flood cannot bloat the audit trail', () => {
    expect(ModelAnalysis.safeParse({ ...VALID_ANALYSIS, reason: 'x'.repeat(2001) }).success).toBe(false);
    expect(ModelAnalysis.safeParse({ ...VALID_ANALYSIS, reason: 'x'.repeat(2000) }).success).toBe(true);
  });
});

describe('DEFAULT_DENY_ANALYSIS - asymmetric fail-closed default', () => {
  it('is suspicious but carries zero confidence', () => {
    expect(DEFAULT_DENY_ANALYSIS.threatDetected).toBe(true);
    expect(DEFAULT_DENY_ANALYSIS.confidence).toBe(0);
    expect(DEFAULT_DENY_ANALYSIS.category).toBe('unknown');
  });

  it('is itself a valid ModelAnalysis', () => {
    expect(ModelAnalysis.safeParse(DEFAULT_DENY_ANALYSIS).success).toBe(true);
  });

  it('carries no target, action or duration', () => {
    expect(DEFAULT_DENY_ANALYSIS).not.toHaveProperty('targetIp');
    expect(DEFAULT_DENY_ANALYSIS).not.toHaveProperty('action');
    expect(DEFAULT_DENY_ANALYSIS).not.toHaveProperty('durationMinutes');
  });
});

describe('Severity - ordered ranking used for DENY precedence', () => {
  it('ranks every severity strictly ascending', () => {
    const order: Severity[] = ['low', 'medium', 'high', 'critical'];
    for (let i = 1; i < order.length; i += 1) {
      expect(SEVERITY_RANK[order[i]]).toBeGreaterThan(SEVERITY_RANK[order[i - 1]]);
    }
  });

  it('covers exactly the closed severity set', () => {
    expect(Object.keys(SEVERITY_RANK).sort()).toEqual([...Severity.options].sort());
  });
});
