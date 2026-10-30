// xcoder:version 14 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:43:54.304Z | xcoder:subtask test-st-50b14d
/**
 * The loop that makes this a daemon. One cycle is:
 *   poll -> redact -> analyze -> decide -> gate -> act -> audit
 * The cycle body is isolated: an LLM timeout, a deleted log file, a policy
 * throw or an audit failure must never take the daemon down with it.
 */
import type { SentinelConfig } from './config.js';
import type { LogTailer } from './log-tailer.js';
import type { Analyzer } from './analyzer.js';
import type { EventHistory } from './event-history.js';
import type { ApprovalGate } from './approval-gate.js';
import type { Firewall } from './system-tools.js';
import type { AuditSink } from './audit-log.js';
import type { Clock, KillSwitch, BudgetLedger } from './runtime.js';
import type { PolicyContext } from './policy/rules.js';
import type { SecurityDecision } from './schema.js';

export type { Clock, KillSwitch, BudgetLedger } from './runtime.js';

export interface SentinelLogger {
  info(o: object, m: string): void;
  warn(o: object, m: string): void;
  error(o: object, m: string): void;
}

export interface SentinelDeps {
  config: SentinelConfig;
  tailer: LogTailer;
  analyzer: Analyzer;
  policy: { evaluate(ctx: PolicyContext): SecurityDecision };
  history: EventHistory;
  approval: ApprovalGate;
  firewall: Firewall;
  audit: AuditSink;
  clock: Clock;
  killSwitch: KillSwitch;
  budget: BudgetLedger;
  logger: SentinelLogger;
  eventId: () => string;
  toEvent: (line: import('./schema.js').RawLogLine) => import('./schema.js').SentinelEvent;
}

export interface CycleReport {
  cycle: number;
  linesRead: number;
  analyzed: number;
  decisions: number;
  blocked: number;
  skipped: number;
  errors: number;
  killSwitchEngaged: boolean;
  finishedAt: Date;
}

export class SentinelDaemon {
  private cycle = 0;

  constructor(private readonly deps: SentinelDeps) {}

  async start(signal: AbortSignal): Promise<void> {
    this.deps.logger.info({ dryRun: this.deps.config.dryRun }, 'sentinel starting');
    while (!signal.aborted) {
      let report: CycleReport;
      try {
        report = await this.runCycle();
      } catch (err) {
        this.deps.logger.error({ err: String(err) }, 'cycle threw; continuing');
        report = this.emptyReport(true);
      }
      this.deps.logger.info({ ...report }, 'sentinel heartbeat');
      if (signal.aborted) break;
      await this.deps.clock.sleep(this.deps.config.pollIntervalMs, signal);
    }
    this.deps.logger.info({ cycle: this.cycle }, 'sentinel shutdown');
  }

  private emptyReport(kill: boolean): CycleReport {
    return {
      cycle: this.cycle,
      linesRead: 0,
      analyzed: 0,
      decisions: 0,
      blocked: 0,
      skipped: 0,
      errors: 0,
      killSwitchEngaged: kill,
      finishedAt: this.deps.clock.now(),
    };
  }

  async runCycle(): Promise<CycleReport> {
    this.cycle += 1;
    const report = this.emptyReport(false);

    // Kill switch checked at the TOP of every cycle (AI-09).
    if (await this.deps.killSwitch.isEngaged()) {
      report.killSwitchEngaged = true;
      this.deps.logger.warn({ cycle: this.cycle }, 'kill switch engaged; idling');
      report.finishedAt = this.deps.clock.now();
      return report;
    }

    this.deps.history.prune(this.deps.clock.now(), 15 * 60 * 1000);

    for (const source of this.deps.config.sources) {
      if (await this.deps.killSwitch.isEngaged()) {
        report.killSwitchEngaged = true;
        break;
      }
      await this.pollSource(source, report);
    }

    report.finishedAt = this.deps.clock.now();
    return report;
  }

  private async pollSource(source: import('./schema.js').LogSourceConfig, report: CycleReport): Promise<void> {
    let batch;
    try {
      batch = await this.deps.tailer.poll(source, this.deps.config.maxLinesPerBatch);
    } catch (err) {
      report.errors += 1;
      this.deps.logger.warn({ source: source.id, err: String(err) }, 'poll failed');
      return;
    }
    report.linesRead += batch.lines.length;
    for (const line of batch.lines) {
      try {
        await this.handleLine(line, report);
      } catch (err) {
        report.errors += 1;
        this.deps.logger.error({ source: source.id, line: line.lineNumber, err: String(err) }, 'line failed');
      }
    }
    try {
      await this.deps.tailer.saveOffset(source, batch.state);
    } catch (err) {
      this.deps.logger.warn({ source: source.id, err: String(err) }, 'offset save failed');
    }
  }

  private async handleLine(line: import('./schema.js').RawLogLine, report: CycleReport): Promise<void> {
    const event = this.deps.toEvent(line);
    const analysis = await this.deps.analyzer.analyze(event);
    report.analyzed += 1;

    this.deps.history.record(event, analysis.analysis, this.deps.clock.now());

    if (!analysis.ok) {
      // Budget and kill switch are the two failures that are not 'suspicious'.
      const benign = analysis.failureReason === 'budget_exhausted' || analysis.failureReason === 'kill_switch';
      if (benign) {
        await this.auditFailure(event, analysis, report);
        return;
      }
    }

    // Durable-action: the OS is authoritative. Refresh the cached block state
    // from the firewall before policy reads it (volatile state is in memory,
    // but "is this IP blocked?" must come from iptables/netsh).
    if (event.sourceIp && this.deps.history.refreshBlocked && !this.deps.history.hasFreshBlockState?.(event.sourceIp)) {
      try {
        await this.deps.history.refreshBlocked(event.sourceIp);
      } catch {
        // A failed read leaves the cache stale; isBlocked then reports 'not
        // blocked' and the firewall tool re-checks before any write.
      }
    }

    const ctx: PolicyContext = {
      event: { sourceIp: event.sourceIp },
      eventId: event.eventId,
      model: analysis.model,
      analysis: analysis.analysis,
      schemaValid: analysis.ok,
      history: this.deps.history,
      allowlist: new Set(this.deps.config.adminIpAllowlist),
      config: this.deps.config,
      now: this.deps.clock.now(),
    };

    let decision: SecurityDecision;
    try {
      decision = this.deps.policy.evaluate(ctx);
    } catch (err) {
      report.errors += 1;
      this.deps.logger.error({ eventId: event.eventId, err: String(err) }, 'policy threw; failing closed');
      return;
    }
    report.decisions += 1;

    if (decision.action === 'no_action') {
      await this.writeAudit(decision, null, event, analysis, 'not_required', report);
      return;
    }
    if (decision.action === 'alert' || !decision.targetIp) {
      report.skipped += 1;
      await this.writeAudit(decision, null, event, analysis, 'not_required', report);
      return;
    }

    // Second kill-switch check, immediately before the firewall call (AI-09).
    if (await this.deps.killSwitch.isEngaged()) {
      report.killSwitchEngaged = true;
      await this.writeAudit(decision, null, event, analysis, 'unavailable', report);
      return;
    }

    const approval = await this.requestApproval(decision);
    if (approval !== 'granted') {
      report.skipped += 1;
      this.deps.logger.warn({ decisionId: decision.decisionId, approval }, 'action not executed');
      await this.writeAudit(decision, null, event, analysis, approval, report);
      return;
    }

    // Never silently unaudited: audit FIRST. If that write fails, do not act.
    const preAudited = await this.writeAudit(decision, null, event, analysis, 'granted', report);
    if (!preAudited) {
      report.errors += 1;
      this.deps.logger.error({ decisionId: decision.decisionId }, 'audit write failed; refusing to act');
      return;
    }

    const outcome = decision.action === 'unblock_ip'
      ? await this.deps.firewall.unblockIp(decision.targetIp)
      : await this.deps.firewall.blockIp(decision.targetIp, decision.durationMinutes ?? this.deps.config.blockDurationMinutes);

    if (outcome.status === 'success') {
      report.blocked += 1;
      if (this.deps.history.rememberBlocked) this.deps.history.rememberBlocked(decision.targetIp, true);
    } else {
      report.skipped += 1;
    }
    this.deps.logger.info({ decisionId: decision.decisionId, action: decision.action, status: outcome.status, targetIp: decision.targetIp }, 'action outcome');
    this.deps.history.prune(this.deps.clock.now(), 15 * 60 * 1000);
    await this.writeAudit(decision, outcome, event, analysis, 'granted', report);
  }

  private async requestApproval(decision: SecurityDecision): Promise<'granted' | 'denied' | 'timeout' | 'unavailable'> {
    if (!decision.requiresApproval) return 'granted';
    if (!this.deps.config.hitl.enabled) {
      this.deps.logger.warn({ decisionId: decision.decisionId }, 'HITL disabled by operator; proceeding');
      return 'granted';
    }
    try {
      return await this.deps.approval.request({
        decisionId: decision.decisionId,
        action: decision.action,
        targetIp: decision.targetIp,
        durationMinutes: decision.durationMinutes,
        severity: decision.severity,
        reason: decision.reason,
        expiresAt: new Date(this.deps.clock.now().getTime() + this.deps.config.hitl.timeoutMs),
      });
    } catch {
      return 'unavailable';
    }
  }

  private async writeAudit(
    decision: SecurityDecision,
    outcome: import('./schema.js').ActionOutcome | null,
    event: import('./schema.js').SentinelEvent,
    analysis: import('./analyzer.js').AnalyzeResult,
    approval: 'granted' | 'denied' | 'timeout' | 'unavailable' | 'not_required',
    report: CycleReport,
  ): Promise<boolean> {
    try {
      const record = this.deps.audit as AuditSink & { lastHash?: () => string | null };
      await this.deps.audit.write({
        ts: this.deps.clock.now().toISOString(),
        eventId: decision.eventId,
        decisionId: decision.decisionId,
        sourceId: event.sourceId,
        lineNumber: event.lineNumber,
        category: analysis.analysis.category,
        severity: decision.severity,
        sourceIp: event.sourceIp ?? null,
        verdict: decision.verdict,
        action: decision.action,
        outcome: outcome ? outcome.status : 'not_attempted',
        reason: outcome ? outcome.reason : decision.reason,
        matchedRuleId: decision.matchedRuleId,
        approval,
        model: decision.model,
        schemaValid: analysis.ok,
        prevHash: record.lastHash ? record.lastHash() : null,
      });
      return true;
    } catch (err) {
      report.errors += 1;
      this.deps.logger.error({ decisionId: decision.decisionId, err: String(err) }, 'audit write failed');
      return false;
    }
  }

  private async auditFailure(
    event: import('./schema.js').SentinelEvent,
    analysis: import('./analyzer.js').AnalyzeResult,
    report: CycleReport,
  ): Promise<void> {
    try {
      await this.deps.audit.write({
        ts: this.deps.clock.now().toISOString(),
        eventId: event.eventId,
        decisionId: 'none',
        sourceId: event.sourceId,
        lineNumber: event.lineNumber,
        category: analysis.analysis.category,
        severity: analysis.analysis.severity,
        sourceIp: event.sourceIp ?? null,
        verdict: 'deny',
        action: 'no_action',
        outcome: 'not_attempted',
        reason: 'analysis unavailable: ' + (analysis.failureReason ?? 'unknown'),
        matchedRuleId: null,
        approval: 'not_required',
        model: analysis.model,
        schemaValid: false,
        prevHash: null,
      });
    } catch (err) {
      report.errors += 1;
      this.deps.logger.error({ eventId: event.eventId, err: String(err) }, 'audit write failed');
    }
  }
}
