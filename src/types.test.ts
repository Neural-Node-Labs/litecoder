// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:45:28.043Z | xcoder:subtask test-st-50b14d
import { describe, it, expect } from 'vitest';
import { ROLES, type Role } from './types.js';
import { ROLE_DIRECTIVES } from './skills/directives.js';

/**
 * src/types.ts is the single source of truth for the role vocabulary: the
 * runtime tuple and the union are derived from the same array so they can
 * never drift. These assertions protect that invariant, which the Sentinel
 * capability relies on (it added a role rather than a parallel type).
 */
describe('role vocabulary', () => {
  it('is a non-empty tuple with no duplicates', () => {
    expect(ROLES.length).toBeGreaterThan(0);
    expect(new Set(ROLES).size).toBe(ROLES.length);
  });

  it('includes the roles the SDLC pipeline depends on', () => {
    for (const required of ['requirements-analyst', 'architect', 'programmer', 'tester', 'sentinel'] as const) {
      expect(ROLES).toContain(required);
    }
  });

  it('has a directive for every runtime role (no orphan role)', () => {
    for (const role of ROLES as readonly Role[]) {
      const entry = ROLE_DIRECTIVES[role];
      expect(entry, `missing directive for ${role}`).toBeDefined();
      expect(entry.directive.trim().length).toBeGreaterThan(0);
      expect(entry.skills.length).toBeGreaterThan(0);
    }
  });

  it('declares no directive for a role that is not in ROLES', () => {
    const known = new Set<string>(ROLES);
    const stray = Object.keys(ROLE_DIRECTIVES).filter((k) => !known.has(k));
    expect(stray).toEqual([]);
  });
});
