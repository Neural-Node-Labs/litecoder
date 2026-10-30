// xcoder:version 8 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:33:13.538Z | xcoder:subtask code-st-8f12c6
/**
 * The compiled policy table. 14 rules with stable ids (audited).
 *
 * Policy lives in TypeScript, not a hot-loadable rules file: nothing that can
 * write a file next to the daemon can change what it does, and no artifact of
 * unknown shape is ever interpreted inside a security-critical process.
 * Operator-tunable values (thresholds, allowlist, duration) are typed config.
 */
import type { ModelAnalysis, SentinelAction, Severity } from '../schema.js';
import type { SentinelConfig } from '../config.js';

export interface PolicyContext {
  event: { sourceIp?: string };
  eventId: string;
  model: { name: string; promptVersion: string };
  analysis: ModelAnalysis;
  schemaValid: boolean;
  history: {
    failedAuthCount(ip: string, windowMs: number): number;
    isBlocked(ip: string): boolean;
  };
  allowlist: ReadonlySet<string>;
  config: Pick<SentinelConfig, 'blockDurationMinutes' | 'maxFailedAttempts'>;
  now: Date;
}

export interface PolicyRule {
  id: string;
  action: SentinelAction;
  severityFloor: Severity;
  when(ctx: PolicyContext): boolean;
}

const TEN_MIN = 600000;
const ONE_MIN = 60000;
const FIVE_MIN = 300000;

/**
 * Rules are predicates over already-collected facts. Array order never
 * affects safety: the engine takes DENY precedence and picks the most severe
 * matching rule, so a reorder cannot weaken the outcome.
 */
export const RULES: readonly PolicyRule[] = [
  {
    id: 'core.admin_ip_protection',
    action: 'no_action',
    severityFloor: 'critical',
    when: (ctx) => (ctx.event.sourceIp ? ctx.allowlist.has(ctx.event.sourceIp) : false),
  },
  {
    id: 'ip.brute_force_failed_logins',
    action: 'block_ip',
    severityFloor: 'high',
    when: (ctx) =>
      ctx.analysis.threatDetected &&
      (ctx.analysis.category === 'brute_force' ||
        (ctx.event.sourceIp !== undefined &&
          ctx.history.failedAuthCount(ctx.event.sourceIp, TEN_MIN) >= ctx.config.maxFailedAttempts)),
  },
  {
    id: 'ip.rapid_sequential_attempts',
    action: 'block_ip',
    severityFloor: 'high',
    when: (ctx) =>
      ctx.event.sourceIp !== undefined && ctx.history.failedAuthCount(ctx.event.sourceIp, ONE_MIN) > 10,
  },
  {
    id: 'ip.invalid_user_enumeration',
    action: 'alert',
    severityFloor: 'medium',
    when: (ctx) => ctx.analysis.category === 'auth_failure' && ctx.analysis.threatDetected,
  },
  {
    id: 'ip.port_scan',
    action: 'block_ip',
    severityFloor: 'high',
    when: (ctx) => ctx.analysis.category === 'port_scan' && ctx.analysis.threatDetected,
  },
  {
    id: 'ip.known_malicious',
    action: 'block_ip',
    severityFloor: 'critical',
    when: (ctx) => ctx.analysis.category === 'malicious_ip' && ctx.analysis.severity === 'critical',
  },
  {
    id: 'ssh.password_brute_force',
    action: 'block_ip',
    severityFloor: 'high',
    when: (ctx) =>
      ctx.event.sourceIp !== undefined &&
      ctx.analysis.category === 'brute_force' &&
      ctx.history.failedAuthCount(ctx.event.sourceIp, FIVE_MIN) >= 3,
  },
  {
    id: 'ssh.root_login_attempt',
    action: 'alert',
    severityFloor: 'high',
    when: (ctx) => ctx.analysis.category === 'root_login_attempt',
  },
  {
    id: 'ssh.deprecated_protocol_v1',
    action: 'alert',
    severityFloor: 'medium',
    when: (ctx) => ctx.analysis.category === 'weak_cipher' && ctx.analysis.severity === 'medium',
  },
  {
    id: 'ssh.weak_cipher',
    action: 'alert',
    severityFloor: 'low',
    when: (ctx) => ctx.analysis.category === 'weak_cipher',
  },
  {
    id: 'fw.temporary_block',
    action: 'block_ip',
    severityFloor: 'high',
    when: (ctx) => ctx.analysis.threatDetected && ctx.analysis.severity === 'critical',
  },
  {
    id: 'fw.rate_limit',
    action: 'alert',
    severityFloor: 'low',
    when: (ctx) => ctx.analysis.threatDetected && ctx.analysis.category === 'unknown',
  },
  {
    id: 'audit.logging_rule',
    action: 'alert',
    severityFloor: 'medium',
    when: (ctx) => ctx.analysis.category === 'auth_failure' && ctx.analysis.severity === 'high',
  },
  {
    id: 'ops.emergency_lockdown',
    action: 'alert',
    severityFloor: 'critical',
    when: (ctx) => ctx.analysis.category === 'unknown' && ctx.analysis.severity === 'critical',
  },
];
