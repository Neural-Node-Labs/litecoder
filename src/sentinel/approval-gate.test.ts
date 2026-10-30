// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:44:09.900Z | xcoder:subtask test-st-50b14d
import { describe, it, expect, vi } from 'vitest';
import { NotifyApprovalGate, PromptApprovalGate, AutoApproveGate, type ApprovalRequest } from './approval-gate.js';

function req(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    decisionId: 'dec-1',
    action: 'block_ip',
    targetIp: '203.0.113.9',
    durationMinutes: 60,
    severity: 'high',
    reason: 'brute force',
    expiresAt: new Date('2026-01-01T01:00:00Z'),
    ...over,
  };
}

describe('AutoApproveGate', () => {
  it('refuses to construct outside dry-run and outside tests', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new AutoApproveGate({ dryRun: false })).toThrow(/refuses to construct/i);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('is allowed in dry-run', () => {
    expect(() => new AutoApproveGate({ dryRun: true })).not.toThrow();
  });
});

describe('PromptApprovalGate', () => {
  it('grants only on an explicit yes', async () => {
    for (const answer of ['y', 'Y', 'yes', ' YES ']) {
      const gate = new PromptApprovalGate(async () => answer);
      await expect(gate.request(req())).resolves.toBe('granted');
    }
  });

  it('denies on empty input, no, and any other answer', async () => {
    for (const answer of ['', 'n', 'no', 'sure', 'y; rm -rf /']) {
      const gate = new PromptApprovalGate(async () => answer);
      await expect(gate.request(req())).resolves.toBe('denied');
    }
  });

  it('treats a failed prompt (EOF/throw) as unavailable, never granted', async () => {
    const gate = new PromptApprovalGate(async () => {
      throw new Error('EOF');
    });
    await expect(gate.request(req())).resolves.toBe('unavailable');
  });
});

describe('NotifyApprovalGate', () => {
  it('never turns a timeout into an approval', async () => {
    const log = vi.fn();
    const gate = new NotifyApprovalGate({
      inboxPath: 'x',
      timeoutMs: 30,
      pollMs: 7,
      log,
      consume: async () => null,
    });
    await expect(gate.request(req())).resolves.toBe('timeout');
    expect(log).toHaveBeenCalledOnce();
  });

  it('returns granted as soon as the operator approves', async () => {
    let calls = 0;
    const gate = new NotifyApprovalGate({
      inboxPath: 'x',
      timeoutMs: 5000,
      pollMs: 5,
      log: () => {},
      consume: async () => {
        calls += 1;
        return calls >= 2 ? 'granted' : null;
      },
    });
    await expect(gate.request(req())).resolves.toBe('granted');
  });

  it('returns denied when the operator denies', async () => {
    const gate = new NotifyApprovalGate({
      inboxPath: 'x',
      timeoutMs: 5000,
      pollMs: 5,
      log: () => {},
      consume: async () => 'denied',
    });
    await expect(gate.request(req())).resolves.toBe('denied');
  });

  it('treats an aborted wait as unavailable, never granted', async () => {
    const ac = new AbortController();
    ac.abort();
    const gate = new NotifyApprovalGate({
      inboxPath: 'x',
      timeoutMs: 5000,
      pollMs: 5,
      log: () => {},
      consume: async () => null,
    });
    await expect(gate.request(req(), ac.signal)).resolves.toBe('unavailable');
  });
});
