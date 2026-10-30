// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:44:45.982Z | xcoder:subtask test-st-50b14d
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileLogTailer, MAX_LINE_BYTES } from './log-tailer.js';
import type { LogSourceConfig } from './schema.js';

let dir: string;
let logPath: string;
let offsets: string;
let source: LogSourceConfig;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sentinel-tail-'));
  logPath = path.join(dir, 'auth.log');
  offsets = path.join(dir, 'offsets.json');
  source = { id: 'auth', path: logPath, kind: 'auth' };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileLogTailer', () => {
  it('reads only new lines on a second poll (never re-reads)', async () => {
    await writeFile(logPath, 'line1\nline2\n', 'utf8');
    const t = new FileLogTailer(offsets);
    const first = await t.poll(source, 100);
    expect(first.lines.map((l) => l.raw)).toEqual(['line1', 'line2']);
    await t.saveOffset(source, first.state);

    const second = await t.poll(source, 100);
    expect(second.lines).toHaveLength(0);

    await appendFile(logPath, 'line3\n', 'utf8');
    const third = await t.poll(source, 100);
    expect(third.lines.map((l) => l.raw)).toEqual(['line3']);
  });

  it('never emits a trailing partial line, and emits it once completed', async () => {
    await writeFile(logPath, 'complete\npart', 'utf8');
    const t = new FileLogTailer(offsets);
    const a = await t.poll(source, 100);
    expect(a.lines.map((l) => l.raw)).toEqual(['complete']);
    await t.saveOffset(source, a.state);
    await appendFile(logPath, 'ial\n', 'utf8');
    const b = await t.poll(source, 100);
    expect(b.lines.map((l) => l.raw)).toEqual(['partial']);
  });

  it('resumes from the persisted offset after a restart', async () => {
    await writeFile(logPath, 'a\nb\n', 'utf8');
    const t1 = new FileLogTailer(offsets);
    const first = await t1.poll(source, 100);
    await t1.saveOffset(source, first.state);
    const t2 = new FileLogTailer(offsets);
    const second = await t2.poll(source, 100);
    expect(second.lines).toHaveLength(0);
  });

  it('detects truncation/rotation and restarts from the beginning', async () => {
    await writeFile(logPath, 'aaaaaaaaaaaaaaaaaaaaaaaaa\nbbbbbbbbbbbbbbbbbbbbbbbb\n', 'utf8');
    const t = new FileLogTailer(offsets);
    const first = await t.poll(source, 100);
    await t.saveOffset(source, first.state);

    await writeFile(logPath, 'fresh\n', 'utf8');
    const after = await t.poll(source, 100);
    expect(after.rotated).toBe(true);
    expect(after.lines.map((l) => l.raw)).toEqual(['fresh']);
  });

  it('drops oversized lines whole instead of building a megabyte prompt', async () => {
    const huge = 'x'.repeat(MAX_LINE_BYTES + 10);
    await writeFile(logPath, huge + '\nsmall\n', 'utf8');
    const t = new FileLogTailer(offsets);
    const batch = await t.poll(source, 100);
    expect(batch.lines.map((l) => l.raw)).toEqual(['small']);
    expect(batch.truncatedLines).toBe(1);
  });

  it('honours maxLines and keeps the offset consistent with what it emitted', async () => {
    await writeFile(logPath, 'one\ntwo\nthree\n', 'utf8');
    const t = new FileLogTailer(offsets);
    const first = await t.poll(source, 2);
    expect(first.lines.map((l) => l.raw)).toEqual(['one', 'two']);
    await t.saveOffset(source, first.state);
    const second = await t.poll(source, 2);
    expect(second.lines.map((l) => l.raw)).toEqual(['three']);
  });

  it('returns an empty batch instead of throwing when the file is missing', async () => {
    const t = new FileLogTailer(offsets);
    const batch = await t.poll(source, 100);
    expect(batch.lines).toEqual([]);
  });

  it('numbers lines monotonically across batches', async () => {
    await writeFile(logPath, 'a\nb\n', 'utf8');
    const t = new FileLogTailer(offsets);
    const first = await t.poll(source, 100);
    await t.saveOffset(source, first.state);
    await appendFile(logPath, 'c\n', 'utf8');
    const second = await t.poll(source, 100);
    expect(first.lines.map((l) => l.lineNumber)).toEqual([1, 2]);
    expect(second.lines.map((l) => l.lineNumber)).toEqual([3]);
  });
});
