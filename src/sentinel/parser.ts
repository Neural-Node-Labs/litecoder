// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:30:35.724Z | xcoder:subtask code-st-8f12c6
/**
 * Deterministic extraction of the source IP from a raw log line. The model
 * never names a target; this parser does, and its output is re-validated by
 * parseIpLiteral before it can reach a firewall call.
 */
import { parseIpLiteral } from './ip.js';
import { redact } from './redaction.js';
import type { RawLogLine, SentinelEvent } from './schema.js';

/** Candidate IPv4/IPv6 literals, most-specific first. */
const CANDIDATE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}\b/g;

export function extractSourceIp(raw: string): string | undefined {
  const matches = raw.match(CANDIDATE);
  if (!matches) return undefined;
  for (const candidate of matches) {
    const ip = parseIpLiteral(candidate);
    if (ip !== null) return ip;
  }
  return undefined;
}

export interface EventFactoryDeps {
  eventId: () => string;
}

/** Redact first (the in-memory event is clean), then extract the IP. */
export function toSentinelEvent(line: RawLogLine, deps: EventFactoryDeps): SentinelEvent {
  const redactedText = redact(line.raw).text;
  const sourceIp = extractSourceIp(line.raw);
  const event: SentinelEvent = {
    eventId: deps.eventId(),
    sourceId: line.sourceId,
    lineNumber: line.lineNumber,
    redactedText,
    observedAt: line.readAt,
  };
  if (sourceIp !== undefined) event.sourceIp = sourceIp;
  return event;
}
