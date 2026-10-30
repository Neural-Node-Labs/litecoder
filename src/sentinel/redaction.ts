// xcoder:version 5 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:27:08.591Z | xcoder:subtask code-st-8f12c6
/**
 * Redaction. Pure: no I/O, no logging, patterns are constants and can never
 * be model-influenced. Replacement is a labelled placeholder so the model
 * still learns THAT a credential was present without seeing it.
 */
import type { ActionOutcome, AuditRecord, SecurityDecision, SentinelEvent } from './schema.js';

export type SecretKind = 'api_key' | 'jwt' | 'pem' | 'password' | 'email' | 'credit_card' | 'ssn';

export interface RedactionResult {
  text: string;
  hits: Record<SecretKind, number>;
}

function emptyHits(): Record<SecretKind, number> {
  return { api_key: 0, jwt: 0, pem: 0, password: 0, email: 0, credit_card: 0, ssn: 0 };
}

/** Luhn check: only redact card-shaped strings that actually validate. */
function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface Pass {
  kind: SecretKind;
  re: RegExp;
  keep?: (match: string, groups: string[]) => string;
}

/** Ordered: structural secrets first, then PII. Order affects overlap only. */
const PASSES: readonly Pass[] = [
  { kind: 'pem', re: /-----BEGIN [A-Z ]+-----[-A-Za-z0-9+/=\s]+-----END [A-Z ]+-----/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  { kind: 'api_key', re: /\b(sk-ant-|sk-|ghp_|gho_|github_pat_|AKIA|xox[abps]-)[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'password', re: /\b(password|passwd|pwd|secret|token)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi },
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

const CARD_SHAPE = /\b(?:\d[ -]?){13,19}\b/g;

function placeholder(kind: SecretKind): string {
  return '«REDACTED:' + kind + '»';
}

export function redact(input: string): RedactionResult {
  const hits = emptyHits();
  let text = input;
  for (const pass of PASSES) {
    text = text.replace(pass.re, (match) => {
      hits[pass.kind] += 1;
      return placeholder(pass.kind);
    });
  }
  // Credit cards: shape first, Luhn second, so false positives stay rare.
  text = text.replace(CARD_SHAPE, (match) => {
    const digits = match.replace(/[^0-9]/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
    hits.credit_card += 1;
    return placeholder('credit_card');
  });
  return { text, hits };
}

/**
 * The ONLY constructor of a prompt payload. The data is delimited and
 * labelled untrusted so the system prompt can name it unambiguously (PRM-02).
 * Redaction runs again here: one pass catching something is not a reason to
 * trust its absence on the second.
 */
export function buildPromptPayload(event: SentinelEvent): string {
  const second = redact(event.redactedText).text;
  const safe = second.length > 8000 ? second.slice(0, 8000) + '...[truncated]' : second;
  return '<<<UNTRUSTED_LOG_DATA\n' + safe + '\nUNTRUSTED_LOG_DATA>>>';
}

export interface AuditExtra {
  approval: AuditRecord['approval'];
  schemaValid: boolean;
  sourceId: string;
  lineNumber: number;
  category: string;
  sourceIp: string | null;
  prevHash: string | null;
  ts: string;
  outcome?: ActionOutcome['status'];
  reason?: string;
}

/** The ONLY constructor of an audit row. Every field redacted by construction. */
export function toAuditRecord(
  decision: SecurityDecision,
  outcome: ActionOutcome | null,
  extra: AuditExtra,
): AuditRecord {
  return {
    ts: extra.ts,
    eventId: decision.eventId,
    decisionId: decision.decisionId,
    sourceId: extra.sourceId,
    lineNumber: extra.lineNumber,
    category: redact(extra.category).text,
    severity: decision.severity,
    sourceIp: extra.sourceIp,
    verdict: decision.verdict,
    action: decision.action,
    outcome: outcome ? outcome.status : extra.outcome ?? 'not_attempted',
    reason: redact(extra.reason ?? (outcome ? outcome.reason : decision.reason)).text.slice(0, 2000),
    matchedRuleId: decision.matchedRuleId,
    approval: extra.approval,
    model: decision.model,
    schemaValid: extra.schemaValid,
    prevHash: extra.prevHash,
  };
}
