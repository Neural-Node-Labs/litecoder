// xcoder:version 3 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:28:01.031Z | xcoder:subtask code-st-8f12c6
/**
 * Shared runtime primitives injected everywhere the daemon touches time,
 * spend, or the kill switch. Kept in its own module so the analyzer, daemon
 * and budget ledger never form an import cycle.
 */
import { access, readFile } from 'node:fs/promises';

export interface Clock {
  now(): Date;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface KillSwitch {
  isEngaged(): Promise<boolean>;
}

export interface BudgetLedger {
  tryConsume(): boolean;
  record(usage: { inputTokens: number; outputTokens: number }): void;
  snapshot(): { calls: number; inputTokens: number; outputTokens: number };
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(finish, ms);
      function finish(): void {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      }
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}

/** Presence of the kill-switch file engages it. An unreadable path is not an error. */
export class FileKillSwitch implements KillSwitch {
  constructor(private readonly killSwitchPath: string) {}

  async isEngaged(): Promise<boolean> {
    if (this.killSwitchPath.trim() === '') return false;
    try {
      await access(this.killSwitchPath);
      return true;
    } catch {
      return false;
    }
  }
}

/** Sliding 60-second window over LLM calls, plus lifetime token totals (AI-09). */
export class SlidingWindowBudget implements BudgetLedger {
  private stamps: number[] = [];
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(private readonly maxPerMinute: number) {}

  tryConsume(): boolean {
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < 60000);
    if (this.stamps.length >= this.maxPerMinute) return false;
    this.stamps.push(now);
    this.calls += 1;
    return true;
  }

  record(usage: { inputTokens: number; outputTokens: number }): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
  }

  snapshot(): { calls: number; inputTokens: number; outputTokens: number } {
    return { calls: this.calls, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}
