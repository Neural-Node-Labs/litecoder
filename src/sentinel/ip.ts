// xcoder:version 6 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:25:07.092Z | xcoder:subtask code-st-8f12c6
/**
 * Address validation, used by the log parser AND by the firewall path.
 * node:net isIP() is the vetted implementation - no hand-rolled regex.
 */
import { isIP } from 'node:net';

/**
 * Returns a normalised literal (IPv4 as-is, IPv6 lowercased+compressed) so
 * allowlist.has() is meaningful, or null for everything else.
 */
export function parseIpLiteral(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^[0-9A-Fa-f:.]+$/.test(trimmed)) return null;
  const version = isIP(trimmed);
  if (version === 4) return trimmed;
  if (version === 6) return normaliseIPv6(trimmed);
  return null;
}

function normaliseIPv6(raw: string): string {
  const lowered = raw.toLowerCase();
  let head = lowered;
  let v4Tail: string | null = null;
  const lastColon = lowered.lastIndexOf(':');
  if (lastColon !== -1 && lowered.slice(lastColon + 1).includes('.')) {
    v4Tail = lowered.slice(lastColon + 1);
    head = lowered.slice(0, lastColon + 1);
  }
  const groups = expandIPv6Groups(head);
  if (groups === null) return lowered;

  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === '0') {
      if (runStart === -1) runStart = i;
      runLen += 1;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }

  let compressed: string;
  if (bestLen >= 2) {
    const before = groups.slice(0, bestStart).join(':');
    const after = groups.slice(bestStart + bestLen).join(':');
    compressed = before + '::' + after;
  } else {
    compressed = groups.join(':');
  }

  if (v4Tail !== null) {
    compressed = compressed.endsWith('::') ? compressed + v4Tail : compressed + ':' + v4Tail;
  }
  return compressed;
}

/** Expand '::' into the full eight 16-bit groups, as hex strings. */
function expandIPv6Groups(input: string): string[] | null {
  const parts = input.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] === '' ? [] : parts[0].split(':');
  const right = parts.length === 2 && parts[1] !== '' ? parts[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (parts.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const fill = new Array<string>(parts.length === 2 ? missing : 0).fill('0');
  return [...left, ...fill, ...right].map((g) => (g === '' ? '0' : g.replace(/^0+(?=.)/, '')));
}
