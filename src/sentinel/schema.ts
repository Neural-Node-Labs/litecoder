// xcoder:version 3 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:24:12.958Z | xcoder:subtask code-st-8f12c6
/**
 * Shared vocabulary for the Sentinel agent - zod, single source of truth.
 * One definition, imported everywhere; nothing here is hand-copied.
 *
 * Closed action surface: no free-form command can ever exist.
 * ModelAnalysis cannot name a target IP, choose an action, or request
 * permanence. The model classifies; it never acts.
 */
import { z } from 'zod';

export const SentinelAction = z.enum(['no_action', 'alert', 'block_ip', 'unblock_ip']);
export type SentinelAction = z.infer<typeof SentinelAction>;

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const LogSourceConfig = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['auth', 'web', 'generic']).default('generic'),
});
export type LogSourceConfig = z.infer<typeof LogSourceConfig>;

/** One line of a log file, before redaction. Content is UNTRUSTED (PRM-01). */
export interface RawLogLine {
  sourceId: string;
  lineNumber: number;
  raw: string;
  readAt: Date;
}

/** Post-redaction event handed to the model and to the audit log. */
export interface SentinelEvent {
  eventId: string;
  sourceId: string;
  lineNumber: number;
  redactedText: string;
  observedAt: Date;
  sourceIp?: string;
}

/**
 * THE MODEL'S OUTPUT - as untrusted as the log line itself.
 * No target IP, no action choice, no self-assigned severity floor, and no
 * permanence request: the model classifies, it never acts.
 */
export const ModelAnalysis = z.object({
  threatDetected: z.boolean(),
  category: z.enum([
    'auth_failure',
    'brute_force',
    'port_scan',
    'root_login_attempt',
    'weak_cipher',
    'malicious_ip',
    'benign',
    'unknown',
  ]),
  severity: Severity,
  confidence: z.number().min(0).max(1),
  reason: z.string().max(2000),
  matchedRuleHint: z.string().max(120).optional(),
});
export type ModelAnalysis = z.infer<typeof ModelAnalysis>;

export type AnalysisCategory = ModelAnalysis['category'];

/**
 * Conservative default used whenever analysis fails in any way. Asymmetric
 * on purpose: a failed analysis is suspicious (threatDetected true, high
 * severity) but carries confidence 0, so policy can still only produce a
 * temporary, approval-gated action.
 */
export const DEFAULT_DENY_ANALYSIS: ModelAnalysis = {
  threatDetected: true,
  category: 'unknown',
  severity: 'high',
  confidence: 0,
  reason: 'analysis unavailable',
};

/** Produced only by the policy engine. The only type the executor accepts. */
export interface SecurityDecision {
  decisionId: string;
  eventId: string;
  verdict: 'allow' | 'deny';
  action: SentinelAction;
  targetIp?: string;
  durationMinutes?: number;
  reason: string;
  matchedRuleId: string | null;
  severity: Severity;
  requiresApproval: boolean;
  model: { name: string; promptVersion: string };
  decidedAt: Date;
}

export interface ActionOutcome {
  status: 'success' | 'skipped' | 'denied' | 'error';
  reason: string;
  targetIp?: string;
  durationMinutes?: number;
  durationMs: number;
}

/** Audit row (PRM-10 / AI-12). Every field is redacted by construction. */
export interface AuditRecord {
  ts: string;
  eventId: string;
  decisionId: string;
  sourceId: string;
  lineNumber: number;
  category: string;
  severity: Severity;
  sourceIp: string | null;
  verdict: 'allow' | 'deny';
  action: SentinelAction;
  outcome: ActionOutcome['status'] | 'not_attempted';
  reason: string;
  matchedRuleId: string | null;
  approval: 'not_required' | 'granted' | 'denied' | 'timeout' | 'unavailable';
  model: { name: string; promptVersion: string };
  schemaValid: boolean;
  prevHash: string | null;
}
