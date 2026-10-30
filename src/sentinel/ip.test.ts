// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:32:54.170Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { parseIpLiteral } from './ip.js';

describe('parseIpLiteral', () => {
  it('accepts bare IPv4 literals', () => {
    expect(parseIpLiteral('203.0.113.9')).toBe('203.0.113.9');
    expect(parseIpLiteral('  203.0.113.9  ')).toBe('203.0.113.9');
  });

  it('normalises IPv6 to lowercase and compresses zero runs', () => {
    expect(parseIpLiteral('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(parseIpLiteral('2001:db8::1')).toBe('2001:db8::1');
  });

  it('rejects shell metacharacters and injection attempts', () => {
    expect(parseIpLiteral('1.2.3.4; rm -rf /')).toBeNull();
    expect(parseIpLiteral('$(id)')).toBeNull();
    expect(parseIpLiteral('1.2.3.4 && curl evil')).toBeNull();
    expect(parseIpLiteral('')).toBeNull();
  });

  it('rejects CIDR ranges: those are not IP literals', () => {
    expect(parseIpLiteral('127.0.0.1/24')).toBeNull();
  });
});
