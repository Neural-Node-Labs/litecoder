// xcoder:version 5 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:27:40.735Z | xcoder:subtask code-st-8f12c6
/**
 * The injectable tail. Yields new lines per poll from a persisted byte
 * offset, never re-reads the file, never shells out, never throws for a
 * rotated/truncated file (it reports it instead).
 */
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogSourceConfig, RawLogLine } from './schema.js';

/** Lines longer than this are dropped whole - never megabyte prompts (AI-09). */
export const MAX_LINE_BYTES = 8192;

export interface TailState {
  byteOffset: number;
  sizeAtRead: number;
  lastLineNumber: number;
}

export interface TailBatch {
  lines: RawLogLine[];
  state: TailState;
  rotated: boolean;
  truncatedLines: number;
}

export interface LogTailer {
  poll(source: LogSourceConfig, maxLines: number): Promise<TailBatch>;
  saveOffset(source: LogSourceConfig, state: TailState): Promise<void>;
  loadOffset(source: LogSourceConfig): Promise<TailState | null>;
}

export class FileLogTailer implements LogTailer {
  constructor(private readonly offsetStorePath: string) {}

  async poll(source: LogSourceConfig, maxLines: number): Promise<TailBatch> {
    const state = await this.stateFor(source);
    let fh;
    try {
      fh = await open(source.path, 'r');
    } catch {
      return { lines: [], state, rotated: false, truncatedLines: 0 };
    }
    try {
      const { size } = await fh.stat();
      let offset = state.byteOffset;
      let rotated = false;
      if (size < offset) {
        offset = 0;
        rotated = true;
      }
      if (size === offset) {
        return { lines: [], state: { ...state, sizeAtRead: size }, rotated, truncatedLines: 0 };
      }
      const toRead = Math.min(size - offset, 1024 * 1024);
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, offset);
      const chunk = buf.subarray(0, bytesRead).toString('utf8');
      return this.splitLines(chunk, source, state, offset, size, rotated, maxLines);
    } catch {
      return { lines: [], state, rotated: false, truncatedLines: 0 };
    } finally {
      await fh.close().catch(() => {});
    }
  }

  /** Split on newlines; a trailing partial line is NOT emitted (offset stays). */
  private splitLines(
    chunk: string,
    source: LogSourceConfig,
    state: TailState,
    offset: number,
    size: number,
    rotated: boolean,
    maxLines: number,
  ): TailBatch {
    const parts = chunk.split('\n');
    parts.pop(); // trailing partial line is buffered, never emitted
    const lines: RawLogLine[] = [];
    let truncatedLines = 0;
    let lineNumber = state.lastLineNumber;
    let consumedBytes = 0;
    for (const raw of parts) {
      if (lines.length >= maxLines) break;
      consumedBytes += Buffer.byteLength(raw, 'utf8') + 1; // + '\n'
      lineNumber += 1;
      if (Buffer.byteLength(raw, 'utf8') > MAX_LINE_BYTES) {
        truncatedLines += 1;
        continue;
      }
      lines.push({ sourceId: source.id, lineNumber, raw, readAt: new Date() });
    }
    const nextOffset = offset + consumedBytes;
    return {
      lines,
      state: { byteOffset: nextOffset, sizeAtRead: size, lastLineNumber: lineNumber },
      rotated,
      truncatedLines,
    };
  }

  async saveOffset(source: LogSourceConfig, state: TailState): Promise<void> {
    const all = await this.readStore();
    all[source.id] = state;
    const target = path.resolve(this.offsetStorePath);
    const tmp = target + '.tmp';
    await writeFile(tmp, JSON.stringify(all), 'utf8');
    await rename(tmp, target);
  }

  async loadOffset(source: LogSourceConfig): Promise<TailState | null> {
    const all = await this.readStore();
    const entry = all[source.id];
    return entry && typeof entry.byteOffset === 'number' ? entry : null;
  }

  private async stateFor(source: LogSourceConfig): Promise<TailState> {
    return (await this.loadOffset(source)) ?? { byteOffset: 0, sizeAtRead: 0, lastLineNumber: 0 };
  }

  private async readStore(): Promise<Record<string, TailState>> {
    try {
      const text = await readFile(this.offsetStorePath, 'utf8');
      const parsed = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, TailState>) : {};
    } catch {
      return {};
    }
  }
}
