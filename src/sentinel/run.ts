// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:31:54.611Z | xcoder:subtask code-st-8f12c6
/**
 * Thin wiring layer: load config, preflight, build the real implementations,
 * then hand them to the daemon supervisor. Nothing here decides policy.
 */
import { randomUUID } from 'node:crypto';
import { createLlmClient } from '../llm/factory.js';
import { loadSentinelConfig, type SentinelConfig } from './config.js';
import { preflight } from './preflight.js';
import { FileLogTailer } from './log-tailer.js';
import { LlmAnalyzer } from './analyzer.js';
import { policyEngine } from './policy-engine.js';
import { InMemoryEventHistory } from './event-history.js';
import { createFirewall, NoopFirewall, type Firewall } from './system-tools.js';
import { NodeCommandRunner } from './command-runner.js';
import { JsonlFileAuditSink, type AuditSink } from './audit-log.js';
import { AutoApproveGate, NotifyApprovalGate, PromptApprovalGate, type ApprovalGate } from './approval-gate.js';
import { consumeVerdict } from './approval-inbox.js';
import { FileKillSwitch, SlidingWindowBudget, SystemClock } from './runtime.js';
import { toSentinelEvent } from './parser.js';
import { SentinelDaemon, type SentinelDeps } from './daemon.js';

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  fileText?: string;
  signal: AbortSignal;
  once?: boolean;
  log?: (o: object, m: string) => void;
}

const stdoutLogger = {
  info: (o: object, m: string) => console.log(JSON.stringify({ level: 'info', m, ...o })),
  warn: (o: object, m: string) => console.warn(JSON.stringify({ level: 'warn', m, ...o })),
  error: (o: object, m: string) => console.error(JSON.stringify({ level: 'error', m, ...o })),
};

/** Build the real dependency graph. Exported so tests can substitute seams. */
export function buildDeps(config: SentinelConfig, clock: SystemClock): SentinelDeps {
  const runner = new NodeCommandRunner();
  const allowlist = new Set(config.adminIpAllowlist);
  const firewall: Firewall = config.dryRun
    ? new NoopFirewall()
    : createFirewall({ runner, platform: process.platform, allowlist });
  const tailer = new FileLogTailer(config.offsetStorePath);
  const killSwitch = new FileKillSwitch(config.killSwitchPath);
  const budget = new SlidingWindowBudget(config.maxLlmCallsPerMinute);
  const controller = new AbortController();
  const llm = createLlmClient('sub_agent');
  const analyzer = new LlmAnalyzer(llm, budget, killSwitch, clock, {
    model: 'sub_agent',
    maxTokens: 512,
    timeoutMs: config.llmTimeoutMs,
    signal: controller.signal,
  });
  const history = new InMemoryEventHistory({ firewall, clock, maxEntries: 10000 });
  const audit: AuditSink = new JsonlFileAuditSink({
    path: config.auditLogPath,
    retentionDays: config.auditRetentionDays,
    maxBytes: config.auditMaxBytes,
    clock,
    hashChain: true,
  });
  return {
    config,
    tailer,
    analyzer,
    policy: policyEngine,
    history,
    approval: buildApprovalGate(config, clock),
    firewall,
    audit,
    clock,
    killSwitch,
    budget,
    logger: stdoutLogger,
    eventId: () => randomUUID(),
    toEvent: (line) => toSentinelEvent(line, { eventId: () => randomUUID() }),
  };
}

function buildApprovalGate(config: SentinelConfig, clock: SystemClock): ApprovalGate {
  if (config.dryRun || process.env.NODE_ENV === 'test') return new AutoApproveGate({ dryRun: true });
  if (config.hitl.mode === 'prompt' && process.stdin.isTTY) {
    return new PromptApprovalGate(async (prompt) => {
      process.stdout.write(prompt);
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
        break;
      }
      return Buffer.concat(chunks).toString('utf8').trim();
    });
  }
  return new NotifyApprovalGate({
    inboxPath: config.offsetStorePath + '.approvals.json',
    timeoutMs: config.hitl.timeoutMs,
    consume: consumeVerdict,
    log: (req) => stdoutLogger.warn({ approvalRequest: req }, 'approval required'),
  });
}

/**
 * In-process supervisor: restart on throw with exponential backoff (1s -> 30s),
 * and exit rather than spin on a crash loop (5 restarts in 60s).
 */
export async function runSentinel(opts: RunOptions): Promise<number> {
  const env = opts.env ?? process.env;
  const clock = new SystemClock();
  const config = loadSentinelConfig(env, opts.fileText);
  await preflight(config, env);
  const deps = buildDeps(config, clock);

  if (opts.once) {
    const daemon = new SentinelDaemon(deps);
    const report = await daemon.runCycle();
    stdoutLogger.info({ ...report }, 'single cycle complete');
    return 0;
  }

  let backoff = 1000;
  const restarts: number[] = [];
  for (;;) {
    const daemon = new SentinelDaemon(deps);
    try {
      await daemon.start(opts.signal);
      return 0;
    } catch (err) {
      if (opts.signal.aborted) return 0;
      const now = Date.now();
      restarts.push(now);
      const recent = restarts.filter((t) => now - t < 60000);
      if (recent.length >= 5) {
        stdoutLogger.error({ err: String(err), restarts: recent.length }, 'crash loop: giving up');
        return 1;
      }
      stdoutLogger.error({ err: String(err), backoff }, 'daemon crashed; restarting');
      await clock.sleep(backoff, opts.signal);
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}
