// xcoder:version 2 | xcoder:task task-2aad09 | xcoder:updated 2026-08-05T04:48:00.525Z | xcoder:subtask code-st-490f5e
import { describe, it, expect } from 'vitest';
import { ROLE_DIRECTIVES, BA_REQUIREMENTS_DIRECTIVE } from './directives.js';
import type { Role } from '../types.js';

describe('ROLE_DIRECTIVES', () => {
  const allKnownRoles: Role[] = [
    'requirements-analyst',
    'architect',
    'programmer',
    'refactorer',
    'tester',
    'ui-api-tester',
    'technical-writer',
    'devops',
    'conversation',
    'business-analyst',
    'defect-manager',
    'scrum-master',
    'system-architect',
    'security-lead',
  ];

  it('has an entry for every known Role', () => {
    for (const role of allKnownRoles) {
      expect(ROLE_DIRECTIVES[role]).toBeDefined();
      expect(typeof ROLE_DIRECTIVES[role].directive).toBe('string');
      expect(ROLE_DIRECTIVES[role].directive.length).toBeGreaterThan(0);
      expect(Array.isArray(ROLE_DIRECTIVES[role].skills)).toBe(true);
      expect(ROLE_DIRECTIVES[role].skills.length).toBeGreaterThan(0);
    }
  });

  it('has exactly the expected set of roles (no extras, no missing)', () => {
    const keys = Object.keys(ROLE_DIRECTIVES).sort();
    const expected = [...allKnownRoles].sort();
    expect(keys).toEqual(expected);
  });

  describe('business-analyst directive', () => {
    it('exists', () => {
      expect(ROLE_DIRECTIVES['business-analyst']).toBeDefined();
    });

    it('has a non-empty directive string', () => {
      const dir = ROLE_DIRECTIVES['business-analyst'].directive;
      expect(typeof dir).toBe('string');
      expect(dir.trim().length).toBeGreaterThan(0);
    });

    it('contains business-domain terminology', () => {
      const dir = ROLE_DIRECTIVES['business-analyst'].directive;
      // The directive should mention UI/UX, pages, etc.
      const hasUIKeywords = /page|UI|screen|flow|design/i.test(dir);
      expect(hasUIKeywords).toBe(true);
    });

    it('has skills that include ERP, CRM, CMS domain expertise', () => {
      const skills = ROLE_DIRECTIVES['business-analyst'].skills;
      expect(skills.length).toBeGreaterThan(0);
      const hasDomainSkills = skills.some(
        (s) => /ERP|CRM|CMS/i.test(s)
      );
      expect(hasDomainSkills).toBe(true);
    });
  });

  describe('tester directive', () => {
    it('exists', () => {
      expect(ROLE_DIRECTIVES['tester']).toBeDefined();
    });

    it('has a non-empty directive string', () => {
      const dir = ROLE_DIRECTIVES['tester'].directive;
      expect(typeof dir).toBe('string');
      expect(dir.trim().length).toBeGreaterThan(0);
    });

    it('requires running the full project test suite as a regression gate when no FOLDER_SCOPE', () => {
      const dir = ROLE_DIRECTIVES['tester'].directive;
      // The directive must mention a full regression run as fallback when FOLDER_SCOPE is absent
      expect(dir).toMatch(/fall back to the/i);
      expect(dir).toMatch(/full.*npm test.*regression gate/is);
      expect(dir).toMatch(/npm test/);
      expect(dir).toMatch(/regression gate/i);
      // Also must mention FOLDER_SCOPE conditional
      expect(dir).toMatch(/FOLDER_SCOPE/);
    });

    it('requires reporting pass/fail counts verbatim', () => {
      const dir = ROLE_DIRECTIVES['tester'].directive;
      expect(dir).toMatch(/pass\/fail counts verbatim/i);
    });

    it('includes a regression-gate skill', () => {
      const skills = ROLE_DIRECTIVES['tester'].skills;
      expect(skills.length).toBeGreaterThan(0);
      const hasRegressionSkill = skills.some(
        (s) => /regression/i.test(s)
      );
      expect(hasRegressionSkill).toBe(true);
    });

    it('describes RCA-level defect reporting', () => {
      const dir = ROLE_DIRECTIVES['tester'].directive;
      expect(dir).toMatch(/Root-Cause-Analysis|defect/i);
      expect(dir).toMatch(/defects\/defectNNNN\.md/);
    });
  });

  describe('defect-manager directive', () => {
    it('exists', () => {
      expect(ROLE_DIRECTIVES['defect-manager']).toBeDefined();
    });

    it('has a non-empty directive string', () => {
      const dir = ROLE_DIRECTIVES['defect-manager'].directive;
      expect(typeof dir).toBe('string');
      expect(dir.trim().length).toBeGreaterThan(0);
    });

    it('contains routing and escalation keywords', () => {
      const dir = ROLE_DIRECTIVES['defect-manager'].directive;
      const hasRouting = /routing|programmer|refactorer/i.test(dir);
      const hasEscalation = /escalat|halt/i.test(dir);
      expect(hasRouting).toBe(true);
      expect(hasEscalation).toBe(true);
    });

    it('has skills covering RCA parsing and routing', () => {
      const skills = ROLE_DIRECTIVES['defect-manager'].skills;
      expect(skills.length).toBeGreaterThan(0);
      const hasRCASkill = skills.some((s) => /RCA|root cause/i.test(s));
      const hasRoutingSkill = skills.some((s) => /routing/i.test(s));
      expect(hasRCASkill).toBe(true);
      expect(hasRoutingSkill).toBe(true);
    });
  });
});

describe('BA_REQUIREMENTS_DIRECTIVE', () => {
  it('exists and has a non-empty directive', () => {
    expect(BA_REQUIREMENTS_DIRECTIVE).toBeDefined();
    expect(typeof BA_REQUIREMENTS_DIRECTIVE.directive).toBe('string');
    expect(BA_REQUIREMENTS_DIRECTIVE.directive.trim().length).toBeGreaterThan(0);
  });

  it('has skills array with required entries', () => {
    expect(Array.isArray(BA_REQUIREMENTS_DIRECTIVE.skills)).toBe(true);
    expect(BA_REQUIREMENTS_DIRECTIVE.skills.length).toBeGreaterThan(0);
  });

  it('mentions technical requirements, not UI design', () => {
    const dir = BA_REQUIREMENTS_DIRECTIVE.directive;
    expect(dir).toMatch(/technical requirements/i);
    expect(dir).toMatch(/DO NOT design UI/i);
    expect(dir).toMatch(/NOT UI design/i);
  });

  it('references rawBusinessRequirement from upstream context', () => {
    const dir = BA_REQUIREMENTS_DIRECTIVE.directive;
    expect(dir).toMatch(/rawBusinessRequirement/);
  });

  it('skills include business-language derivation', () => {
    const skills = BA_REQUIREMENTS_DIRECTIVE.skills;
    const hasBusinessSkill = skills.some((s) => /business language/i.test(s));
    expect(hasBusinessSkill).toBe(true);
  });

  it('skills include ambiguity recognition', () => {
    const skills = BA_REQUIREMENTS_DIRECTIVE.skills;
    const hasAmbiguity = skills.some((s) => /ambiguity|ambiguities/i.test(s));
    expect(hasAmbiguity).toBe(true);
  });
});
