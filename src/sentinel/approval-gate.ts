// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:30:20.880Z | xcoder:subtask code-st-8f12c6
/**
 * Human-in-the-loop gate. Fail-closed: timeout, unavailable, a thrown error,
 * or a missing gate all mean NO execution. There is no path where 'nobody
 * answered' means 'go ahead'.
 */
import type { SentinelAction, Severity } from './schema.js';

export interface ApprovalRequest {
  decisionId: string;
  action: SentinelAction;
  targetIp?: string;
  durationMinutes?: number;
  severity: Severity;
  reason: string;
  expiresAt: Date;
}

export type ApprovalVerdict = 'granted' | 'denied' | 'timeout' | 'unavailable';

export interface ApprovalGate {
  request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalVerdict>;
}

/**
 * Tests and dry-run only. Throws at construction outside those contexts, so
 * it cannot be wired in by accident in production.
 */
export class AutoApproveGate implements ApprovalGate {
  constructor(ctx: { dryRun: boolean }) {
    const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (!ctx.dryRun && !isTest) {
      throw new Error('AutoApproveGate refuses to construct outside dryRun or tests');
    }
  }

  async request(): Promise<ApprovalVerdict> {
    return 'granted';
  }
}

/**
 * Production headless default. Writes the request to the log and waits up to
 * timeoutMs for `sentinel approve <id>` / `sentinel deny <id>`. A timeout is
 * NEVER an approval.
 */
export class NotifyApprovalGate implements ApprovalGate {
  constructor(
    private readonly deps: {
      inboxPath: string;
      timeoutMs: number;
      pollMs?: number;
      log: (req: ApprovalRequest) => void;
      consume: (inboxPath: string, decisionId: string) => Promise<ApprovalVerdict | null>;
    },
  ) {}

  async request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalVerdict> {
    this.deps.log(req);
    const pollMs = this.deps.pollMs ?? 2000;
    const deadline = Date.now() + this.deps.timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) return 'unavailable';
      const verdict = await this.deps.consume(this.deps.inboxPath, req.decisionId);
      if (verdict === 'granted' || verdict === 'denied') return verdict;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return 'timeout';
  }
}

/** Interactive TTY only: y/n on stdin. Anything else (or EOF) is a deny. */
export class PromptApprovalGate implements ApprovalGate {
  constructor(private readonly ask: (prompt: string) => Promise<string>) {}

  async request(req: ApprovalRequest): Promise<ApprovalVerdict> {
    const summary = req.action + ' ' + (req.targetIp ?? '') + ' for ' + (req.durationMinutes ?? 0) + 'm: ' + req.reason;
    try {
      const answer = (await this.ask('APPROVE ' + summary + ' [y/N] ')).trim().toLowerCase();
      return answer === 'y' || answer === 'yes' ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  }
}
