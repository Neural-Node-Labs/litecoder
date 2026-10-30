// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:29:46.775Z | xcoder:subtask code-st-8f12c6
/**
 * Append-only, redacted, retention-bound, hash-chained audit log.
 * Housekeeping-grade tamper-evidence: each record carries prevHash, the
 * SHA-256 of the previous record's canonical JSON, so edits/deletions in the
 * middle of the chain are detectable. Not a blockchain.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Clock } from './runtime.js';
import type { AuditRecord } from './schema.js';

export interface AuditSink {
  write(record: AuditRecord): Promise<void>;
  lastHash(): string | null;
}

export interface AuditOptions {
  path: string;
  retentionDays: number;
  maxBytes: number;
  clock: Clock;
  hashChain: boolean;
}

function canonical(record: AuditRecord): string {
  return JSON.stringify(record);
}

export class JsonlFileAuditSink implements AuditSink {
  private prev: string | null = null;
  private loaded = false;

  constructor(private readonly opts: AuditOptions) {}

  lastHash(): string | null {
    return this.prev;
  }

  /** Read the tail of the existing file once, so the chain survives restarts. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await readFile(this.opts.path, 'utf8');
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      const last = lines[lines.length - 1];
      if (last) this.prev = createHash('sha256').update(last).digest('hex');
    } catch {
      this.prev = null;
    }
  }

  /** Rotate when the file would exceed maxBytes. */
  private async maybeRotate(): Promise<void> {
    try {
      const info = await stat(this.opts.path);
      if (info.size >= this.opts.maxBytes) {
        const stamp = this.opts.clock.now().toISOString().replace(/[:.]/g, '-');
        await rename(this.opts.path, this.opts.path + '.' + stamp);
        this.prev = null;
      }
    } catch {
      // No file yet: nothing to rotate.
    }
  }

  async write(record: AuditRecord): Promise<void> {
    await this.ensureLoaded();
    await mkdir(path.dirname(path.resolve(this.opts.path)), { recursive: true });
    await this.maybeRotate();

    const chained: AuditRecord = {
      ...record,
      prevHash: this.opts.hashChain ? this.prev : null,
    };
    const line = canonical(chained);
    await appendFile(this.opts.path, line + '\n', 'utf8');
    if (this.opts.hashChain) {
      this.prev = createHash('sha256').update(line).digest('hex');
    }
  }
}

/** Rewrite the file keeping only records newer than retentionDays. */
export async function pruneAuditLog(opts: { path: string; retentionDays: number; clock: Clock }): Promise<void> {
  let text: string;
  try {
    text = await readFile(opts.path, 'utf8');
  } catch {
    return;
  }
  const cutoff = opts.clock.now().getTime() - opts.retentionDays * 86400000;
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line) as AuditRecord;
      const ts = Date.parse(rec.ts);
      if (Number.isFinite(ts) && ts >= cutoff) kept.push(line);
    } catch {
      // Keep unparseable lines rather than silently dropping evidence.
      kept.push(line);
    }
  }
  const tmp = opts.path + '.prune.tmp';
  await writeFile(tmp, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf8');
  await rename(tmp, opts.path);
}
