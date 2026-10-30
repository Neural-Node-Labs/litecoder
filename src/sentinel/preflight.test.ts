// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:44:24.448Z | xcoder:subtask test-st-50b14d
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preflight } from './preflight.js';
import { SentinelConfigError, type SentinelConfig } from './config.js';

let dir: string;
let logFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sentinel-preflight-'));
  logFile = path.join(dir, 'auth.log');
  await writeFile(logFile, 'Failed password from 203.0.113.9\n', 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function config(over: Partial<SentinelConfig> = {}): SentinelConfig {
  return {
    adminIp: '10.0.0.5',
    adminIpAllowlist: ['10.0.0.5'],
    sources: [{ id: 'auth', path: logFile, kind: 'auth' }],
    pollIntervalMs: 5000,
    maxLinesPerBatch: 200,
    maxLlmCallsPerMinute: 20,
    llmTimeoutMs: 20000,
    hitl: { enabled: true, mode: 'notify', timeoutMs: 900000 },
    blockDurationMinutes: 60,
    maxFailedAttempts: 5,
    killSwitchPath: '',
    offsetStorePath: path.join(dir, 'offsets.json'),
    auditLogPath: path.join(dir, 'audit', 'audit.jsonl'),
    auditRetentionDays: 30,
    auditMaxBytes: 67108864,
    dryRun: true,
    ...over,
  };
}

function fieldOf(err: unknown): string {
  expect(err).toBeInstanceOf(SentinelConfigError);
  return (err as SentinelConfigError).field;
}

describe('preflight', () => {
  it('passes for a complete, readable config', async () => {
    await expect(preflight(config(), {})).resolves.toBeUndefined();
  });

  it('refuses to start with no log sources', async () => {
    const err = await preflight(config({ sources: [] }), {}).catch((e: unknown) => e);
    expect(fieldOf(err)).toBe('sources');
  });

  it('refuses to start when a log source is not readable', async () => {
    const err = await preflight(
      config({ sources: [{ id: 'auth', path: path.join(dir, 'missing.log'), kind: 'auth' }] }),
      {},
    ).catch((e: unknown) => e);
    expect(fieldOf(err)).toBe('sources.auth');
  });

  it('creates the audit directory when missing', async () => {
    await preflight(config(), {});
    const { stat } = await import('node:fs/promises');
    await expect(stat(path.join(dir, 'audit'))).resolves.toBeDefined();
  });

  it('reports only field names, never file content, in its errors', async () => {
    const err = await preflight(config({ sources: [{ id: 'auth', path: path.join(dir, 'nope.log'), kind: 'auth' }] }), {}).catch(
      (e: unknown) => e,
    );
    expect((err as SentinelConfigError).message).not.toContain('Failed password');
  });

  it('refuses to run privileged without an explicit opt-in', async () => {
    const original = process.getuid;
    (process as unknown as { getuid?: () => number }).getuid = () => 0;
    try {
      if (process.platform === 'win32') return; // not privileged by this definition
      let error: unknown;
      try {
        await mkdir(dir, { recursive: true });
        await preflight(config(), {});
      } catch (e) {
        error = e;
      }
      expect(fieldOf(error)).toBe('privilege');
    } finally {
      if (original) (process as unknown as { getuid: () => number }).getuid = original;
      else delete (process as unknown as { getuid?: () => number }).getuid;
    }
  });
});
