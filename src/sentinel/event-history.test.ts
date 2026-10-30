// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:42:57.298Z | xcoder:subtask test-st-50b14d
import { describe, it, expect } from 'vitest';
import { InMemoryEventHistory } from './event-history.js';
import type { Clock } from './runtime.js';
import type { ModelAnalysis, SentinelEvent } from './schema.js';

class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

function ev(ip?: string, at = new Date('2026-01-01T00:00:00Z')): SentinelEvent {
  const e: SentinelEvent = { eventId: 'e', sourceId: 'auth', lineNumber: 1, redactedText: 'x', observedAt: at };
  if (ip) e.sourceIp = ip;
  return e;
}

function analysis(over: Partial<ModelAnalysis> = {}): ModelAnalysis {
  return {
    threatDetected: true,
    category: 'brute_force',
    severity: 'high',
    confidence: 0.9,
    reason: 'r',
    ...over,
  };
}

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

function history(maxEntries = 100) {
  return new InMemoryEventHistory({
    firewall: { isBlocked: async () => false },
    clock: CLOCK,
    maxEntries,
  });
}

describe('InMemoryEventHistory', () => {
  it('counts only failed-auth categories inside the window', () => {
    const h = history();
    const now = CLOCK.now();
    h.record(ev('203.0.113.9'), analysis(), now);
    h.record(ev('203.0.113.9'), analysis({ category: 'benign', threatDetected: false }), now);
    h.record(ev('203.0.113.9'), analysis({ category: 'port_scan' }), now);
    expect(h.failedAuthCount('203.0.113.9', 60_000)).toBe(1);
  });

  it('excludes events older than the window', () => {
    const h = history();
    h.record(ev('203.0.113.9', new Date('2026-01-01T00:00:00Z')), analysis(), new Date('2026-01-01T00:00:00Z'));
    CLOCK.set(new Date('2026-01-01T00:10:00Z'));
    expect(h.failedAuthCount('203.0.113.9', 60_000)).toBe(0);
  });

  it('ignores events without a source IP', () => {
    const h = history();
    h.record(ev(undefined), analysis(), CLOCK.now());
    expect(h.failedAuthCount('203.0.113.9', 60_000)).toBe(0);
  });

  it('keeps memory bounded: recorded events are evictable at maxEntries', () => {
    const h = history(2);
    const now = CLOCK.now();
    h.record(ev('a.example'), analysis(), now);
    h.record(ev('198.51.100.1'), analysis(), now);
    h.record(ev('198.51.100.2'), analysis(), now);
    // Oldest event (first IP) is gone; the newest are retained.
    expect(h.failedAuthCount('198.51.100.2', 60_000)).toBe(1);
  });

  it('prune drops aged entries so a later event is still counted', () => {
    const h = history(3);
    const t0 = new Date('2026-01-01T00:00:00Z');
    CLOCK.set(t0);
    h.record(ev('203.0.113.9'), analysis(), t0);
    h.record(ev('203.0.113.9'), analysis(), t0);
    h.record(ev('203.0.113.9'), analysis(), t0);
    CLOCK.set(new Date('2026-01-02T00:00:00Z'));
    h.prune(CLOCK.now(), 60_000);
    h.record(ev('203.0.113.9'), analysis(), CLOCK.now());
    // The fresh event must not be evicted by stale bookkeeping from pruned rows.
    expect(h.failedAuthCount('203.0.113.9', 60_000)).toBe(1);
  });

  it('reports a remembered block inside the freshness window', () => {
    const h = history();
    h.rememberBlocked('203.0.113.9', true);
    expect(h.isBlocked('203.0.113.9')).toBe(true);
  });

  it('does not report a stale remembered block as authoritative forever', () => {
    const h = history();
    CLOCK.set(new Date('2026-01-01T00:00:00Z'));
    h.rememberBlocked('203.0.113.9', true);
    // Well past the 15s freshness window; the OS (fake firewall: false) rules.
    CLOCK.set(new Date('2026-01-01T00:05:00Z'));
    expect(h.isBlocked('203.0.113.9')).toBe(false);
  });

  it('forgets blocks that were remembered as removed', () => {
    const h = history();
    h.rememberBlocked('203.0.113.9', true);
    h.rememberBlocked('203.0.113.9', false);
    expect(h.isBlocked('203.0.113.9')).toBe(false);
  });
});
