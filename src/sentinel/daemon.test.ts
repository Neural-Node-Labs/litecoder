// xcoder:version 3 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:36:25.823Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { SentinelDaemon, type SentinelDeps } from './daemon.js';
import { NoopFirewall, type Firewall } from './system-tools.js';
import { policyEngine } from './policy-engine.js';
import type { AuditRecord, SentinelEvent } from './schema.js';

const ATTACKER = '203.0.113.9';

function event(): SentinelEvent {
  return { eventId: 'e1', sourceId: 'auth', lineNumber: 1, redactedText: 'Failed password', observedAt: new Date(), sourceIp: ATTACKER };
}

function makeDeps(over: Partial<SentinelDeps> = {}): SentinelDeps {
  const audits: AuditRecord[] = [];
  const base = {
    config: {
      adminIp: '10.0.0.5', adminIpAllowlist: ['10.0.0.5'], sources: [{ id: 'auth', path: 'x', kind: 'auth' as const }],
      pollIntervalMs: 10, maxLinesPerBatch: 10, maxLlmCallsPerMinute: 10, llmTimeoutMs: 1000,
      hitl: { enabled: true, mode: 'notify' as const, timeoutMs: 10 }, blockDurationMinutes: 60,
      maxFailedAttempts: 5, killSwitchPath: '', offsetStorePath: 'o.json', auditLogPath: 'a.jsonl',
      auditRetentionDays: 1, auditMaxBytes: 1000, dryRun: true,
    },
    tailer: {
      poll: async () => ({ lines: [{ sourceId: 'auth', lineNumber: 1, raw: 'Failed password', readAt: new Date() }], state: { byteOffset: 1, sizeAtRead: 1, lastLineNumber: 1 }, rotated: false, truncatedLines: 0 }),
      saveOffset: async () => {},
      loadOffset: async () => null,
    },
    analyzer: { analyze: async () => ({ ok: true, analysis: { threatDetected: true, category: 'brute_force' as const, severity: 'high' as const, confidence: 0.9, reason: 'x' }, usage: { inputTokens: 1, outputTokens: 1 }, model: { name: 'm', promptVersion: 'v' } }) },
    policy: policyEngine,
    history: { failedAuthCount: () => 5, record: () => {}, isBlocked: () => false, rememberBlocked: () => {}, prune: () => {} },
    approval: { request: async () => 'granted' as const },
    firewall: new NoopFirewall(),
    audit: { write: async (r: AuditRecord) => { audits.push(r); }, lastHash: () => null },
    clock: { now: () => new Date(), sleep: async () => {} },
    killSwitch: { isEngaged: async () => false },
    budget: { tryConsume: () => true, record: () => {}, snapshot: () => ({ calls: 0, inputTokens: 0, outputTokens: 0 }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    eventId: () => 'e1',
    toEvent: () => event(),
  };
  return { ...base, ...over, __audits: audits } as SentinelDeps & { __audits: AuditRecord[] };
}

describe('SentinelDaemon', () => {
  it('runs the full pipeline and writes exactly one audit row', async () => {
    const deps = makeDeps();
    const report = await new SentinelDaemon(deps).runCycle();
    expect(report.linesRead).toBe(1);
    expect(report.decisions).toBe(1);
    expect((deps as never as { __audits: AuditRecord[] }).__audits.length).toBeGreaterThanOrEqual(1);
  });

  it('does not act when the human gate times out', async () => {
    let acted = 0;
    const spy: Firewall = {
      blockIp: async () => { acted += 1; return { status: 'success' as const, reason: 'x', durationMs: 0 }; },
      unblockIp: async () => ({ status: 'skipped' as const, reason: '', durationMs: 0 }),
      isBlocked: async () => false,
    };
    const deps = makeDeps({ approval: { request: async () => 'timeout' as const }, firewall: spy, config: { ...makeDeps().config, dryRun: false } });
    await new SentinelDaemon(deps).runCycle();
    expect(acted).toBe(0);
  });

  it('acts only after the human grants approval', async () => {
    let acted = 0;
    const spy = { blockIp: async () => { acted += 1; return { status: 'success' as const, reason: 'ok', durationMs: 0 }; }, unblockIp: async () => ({ status: 'skipped' as const, reason: '', durationMs: 0 }), isBlocked: async () => false };
    const deps = makeDeps({ firewall: spy, config: { ...makeDeps().config, dryRun: false } });
    await new SentinelDaemon(deps).runCycle();
    expect(acted).toBe(1);
  });

  it('idles without calls when the kill switch is engaged', async () => {
    let analyzed = 0;
    const deps = makeDeps({ killSwitch: { isEngaged: async () => true }, analyzer: { analyze: async () => { analyzed += 1; throw new Error('should not run'); } } });
    const report = await new SentinelDaemon(deps).runCycle();
    expect(analyzed).toBe(0);
    expect(report.killSwitchEngaged).toBe(true);
  });

  it('survives a policy throw by failing closed', async () => {
    const deps = makeDeps({ policy: { evaluate: () => { throw new Error('policy down'); } } });
    const report = await new SentinelDaemon(deps).runCycle();
    expect(report.errors).toBeGreaterThanOrEqual(1);
    expect(report.blocked).toBe(0);
  });
});
