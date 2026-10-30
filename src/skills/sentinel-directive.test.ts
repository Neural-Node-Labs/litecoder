// xcoder:version 2 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:45:17.052Z | xcoder:subtask test-st-50b14d
import { describe, it, expect } from 'vitest';
import { ROLES, type Role } from '../types.js';
import { ROLE_DIRECTIVES } from './directives.js';

/**
 * The Sentinel capability is delivered as a role. These assertions encode the
 * INTENDED contract of that role (design: sentinel-daemon): the classifier is
 * told that log content is untrusted data, and is explicitly denied the three
 * powers the code owns - target selection, action selection, and permanence.
 */
describe('sentinel role contract', () => {
  it('is a first-class role', () => {
    expect(ROLES).toContain('sentinel');
  });

  it('has a directive and at least one skill', () => {
    const role = ROLE_DIRECTIVES.sentinel;
    expect(role.directive.length).toBeGreaterThan(0);
    expect(role.skills.length).toBeGreaterThan(0);
  });

  it('frames log content as untrusted input rather than instructions', () => {
    const d = ROLE_DIRECTIVES.sentinel.directive.toLowerCase();
    expect(d).toContain('untrusted');
    // Intended semantics: embedded instructions are reported as attacks, never obeyed.
    expect(d).toMatch(/never followed|not follow|never follow|never obeyed/);
    expect(d).toMatch(/instructions aimed at you|attacks to be reported/);
  });

  it('denies the model the target-IP decision', () => {
    expect(ROLE_DIRECTIVES.sentinel.directive.toLowerCase()).toMatch(/do not choose a target ip/);
  });

  it('denies the model the action decision', () => {
    expect(ROLE_DIRECTIVES.sentinel.directive.toLowerCase()).toMatch(/do not choose an action/);
  });

  it('denies the model the power to set permanence', () => {
    expect(ROLE_DIRECTIVES.sentinel.directive.toLowerCase()).toMatch(/do not\s+set a block duration/);
  });

  it('lists the closed analysis schema in the directive', () => {
    const d = ROLE_DIRECTIVES.sentinel.directive;
    for (const key of ['threatDetected', 'category', 'severity', 'confidence', 'reason']) {
      expect(d).toContain(key);
    }
    for (const action of ['block_ip', 'unblock_ip']) {
      // Actions are NOT part of the model's output surface.
      expect(d).not.toContain('"action"');
      expect(action).not.toBe('threatDetected');
    }
  });

  it('every role key in ROLE_DIRECTIVES is a declared Role', () => {
    const roles = new Set<string>(ROLES);
    for (const key of Object.keys(ROLE_DIRECTIVES)) {
      expect(roles.has(key)).toBe(true);
    }
    // And the mapping is exhaustive: no declared role lacks a directive.
    for (const role of ROLES as readonly Role[]) {
      expect(ROLE_DIRECTIVES[role]).toBeDefined();
    }
  });
});
