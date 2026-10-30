// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:44:13.192Z | xcoder:subtask test-st-50b14d
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { consumeVerdict, recordVerdict } from './approval-inbox.js';

let dir: string;
let inbox: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sentinel-inbox-'));
  inbox = path.join(dir, 'nested', 'inbox.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('approval inbox', () => {
  it('returns null for an unknown decision id', async () => {
    await expect(consumeVerdict(inbox, 'nope')).resolves.toBeNull();
  });

  it('round-trips a granted verdict and creates missing directories', async () => {
    await recordVerdict(inbox, 'dec-1', 'granted');
    await expect(consumeVerdict(inbox, 'dec-1')).resolves.toBe('granted');
  });

  it('consumes an approval exactly once: a replayed id cannot authorise twice', async () => {
    await recordVerdict(inbox, 'dec-1', 'granted');
    await expect(consumeVerdict(inbox, 'dec-1')).resolves.toBe('granted');
    await expect(consumeVerdict(inbox, 'dec-1')).resolves.toBeNull();
  });

  it('keeps other pending decisions when one is consumed', async () => {
    await recordVerdict(inbox, 'dec-1', 'granted');
    await recordVerdict(inbox, 'dec-2', 'denied');
    await expect(consumeVerdict(inbox, 'dec-1')).resolves.toBe('granted');
    await expect(consumeVerdict(inbox, 'dec-2')).resolves.toBe('denied');
  });

  it('treats a corrupt inbox as empty rather than trusting it', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(inbox), { recursive: true });
    await writeFile(inbox, 'not json at all', 'utf8');
    await expect(consumeVerdict(inbox, 'dec-1')).resolves.toBeNull();
    await recordVerdict(inbox, 'dec-1', 'granted');
    const text = await readFile(inbox, 'utf8');
    expect(JSON.parse(text)['dec-1'].verdict).toBe('granted');
  });
});
