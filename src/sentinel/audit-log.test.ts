// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:44:52.100Z | xcoder:subtask test-st-50b14d
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { JsonlFileAuditSink, pruneAuditLog } from './audit-log.js';
import type { Clock } from './runtime.js';
import type { AuditRecord } from './schema.js';

let dir: string;
let logPath: string;

const clock: Clock = {
  now: () => new Date('2026-01-01T00:00:00Z'),
  sleep: () => Promise.resolve(),
};

function record(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    eventId: 'e1',
    decisionId: 'd1',
    sourceId: 'auth',
    lineNumber: 1,
    category: 'brute_force',
    severity: 'high',
    sourceIp: '203.0.113.9',
    verdict: 'deny',
    action: 'block_ip',
    outcome: 'not_attempted',
    reason: 'brute force',
    matchedRuleId: 'brute.threshold',
    approval: 'granted',
    model: { name: 'm', promptVersion: 'v1' },
    schemaValid: true,
    prevHash: null,
    ...over,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sentinel-audit-'));
  logPath = path.join(dir, 'sub', 'audit.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sink(over: Partial<ConstructorParameters<typeof JsonlFileAuditSink>[0]> = {}) {
  return new JsonlFileAuditSink({ path: logPath, retentionDays: 30, maxBytes: 1_000_000, clock, hashChain: true, ...over });
}

describe('JsonlFileAuditSink', () => {
  it('appends one line per record and creates the parent directory', async () => {
    const s = sink();
    await s.write(record());
    await s.write(record({ decisionId: 'd2' }));
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('chains records: each prevHash is the SHA-256 of the previous line', async () => {
    const s = sink();
    await s.write(record());
    await s.write(record({ decisionId: 'd2' }));
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[0]).prevHash).toBeNull();
    const expected = createHash('sha256').update(lines[0]).digest('hex');
    expect(JSON.parse(lines[1]).prevHash).toBe(expected);
  });

  it('continues the chain across a restart (new sink instance)', async () => {
    await sink().write(record());
    const firstLine = (await readFile(logPath, 'utf8')).trim();
    const s2 = sink();
    await s2.write(record({ decisionId: 'd2' }));
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[1]).prevHash).toBe(createHash('sha256').update(firstLine).digest('hex'));
  });

  it('records a null prevHash when chaining is disabled', async () => {
    const s = sink({ hashChain: false });
    await s.write(record());
    await s.write(record({ decisionId: 'd2' }));
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[1]).prevHash).toBeNull();
  });

  it('rotates the file when it would exceed maxBytes, starting a fresh chain', async () => {
    const s = sink({ maxBytes: 300 });
    await s.write(record());
    await s.write(record({ decisionId: 'd2' }));
    const entries = await import('node:fs/promises').then((m) => m.readdir(path.dirname(logPath)));
    const rotated = entries.filter((f) => f.includes('audit.jsonl.'));
    expect(rotated.length).toBeGreaterThanOrEqual(1);
    const remaining = (await readFile(logPath, 'utf8')).trim();
    expect(remaining.length).toBeLessThan(400);
    await expect(stat(logPath)).resolves.toBeDefined();
  });
});

describe('pruneAuditLog', () => {
  it('drops records older than retention and keeps newer ones', async () => {
    const s = sink({ hashChain: false });
    await s.write(record({ ts: '2025-01-01T00:00:00.000Z', decisionId: 'old' }));
    await s.write(record({ ts: '2025-12-31T00:00:00.000Z', decisionId: 'new' }));
    await pruneAuditLog({ path: logPath, retentionDays: 30, clock });
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).decisionId).toBe('new');
  });

  it('keeps unparseable lines rather than silently discarding evidence', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, '{"broken":\n' + JSON.stringify(record({ ts: '2025-12-31T00:00:00.000Z' })) + '\n', 'utf8');
    await pruneAuditLog({ path: logPath, retentionDays: 30, clock });
    const text = await readFile(logPath, 'utf8');
    expect(text).toContain('{"broken":');
  });

  it('is a no-op when the audit file does not exist', async () => {
    await expect(pruneAuditLog({ path: logPath, retentionDays: 30, clock })).resolves.toBeUndefined();
  });
});
