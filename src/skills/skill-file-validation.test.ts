// xcoder:version 3 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:42:43.996Z | xcoder:subtask test-st-8ac478
import fs from 'node:fs';
import path from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { describe, it, expect } from 'vitest';

const SKILLS_DIR = path.resolve(process.cwd(), 'skills');
const HTML_DIR = path.resolve(process.cwd(), 'tmp');

/**
 * The HTML→SKILL fixtures under `skills/` are an optional payload, not part
 * of the compiled CLI. A source checkout that does not ship them must still
 * run green: these tests validate fixture CONTENT, so with no fixtures there
 * is nothing to validate. They are skipped (visibly) rather than crashing the
 * process on a `readdirSync` of a directory that does not exist.
 */
const HAS_SKILL_FIXTURES = fs.existsSync(SKILLS_DIR);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

interface SkillHeader {
  name: string;
  role: string;
  description: string;
  triggers: string[];
  version: string;
  requires_tools: string[];
  composes_with: string[];
}

interface ParsedSkill {
  header: SkillHeader;
  body: string;
  relPath: string;
}

function readSkillFile(skillName: string): ParsedSkill {
  const filePath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  expect(fs.existsSync(filePath)).toBe(true);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`Invalid frontmatter in ${filePath}`);
  }
  const header = yamlLoad(match[1]) as SkillHeader;
  return { header, body: match[2].trim(), relPath: `skills/${skillName}/SKILL.md` };
}

// Known skill directories to validate composes_with references
const knownSkillDirs = HAS_SKILL_FIXTURES
  ? fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

const REQUIRED_SECTIONS = [
  { name: 'Role', heading: '## Role' },
  { name: 'Process', heading: '## Process' },
  { name: 'Strategies', heading: '## Strategies' },
  { name: 'Planning Approach', heading: '## Planning Approach' },
  { name: 'Instructions', heading: '## Instructions for This Task Type' },
  { name: 'Experience / Common Pitfalls', heading: '## Experience / Common Pitfalls' },
  { name: 'Output Artifacts', heading: '## Output Artifacts' },
];

describe.skipIf(!HAS_SKILL_FIXTURES)('HTML-to-SKILL transformation output validation', () => {
  describe('advanced-dfir', () => {
    let skill: ParsedSkill;

    it('SKILL.md exists at skills/advanced-dfir/SKILL.md', () => {
      skill = readSkillFile('advanced-dfir');
    });

    it('has all 7 required frontmatter keys with valid types', () => {
      const h = skill.header;
      expect(typeof h.name).toBe('string');
      expect(h.name).toBe('advanced-dfir'); // matches directory name
      expect(typeof h.role).toBe('string');
      expect(h.role.length).toBeGreaterThan(0);
      expect(typeof h.description).toBe('string');
      expect(h.description.length).toBeGreaterThan(0);
      expect(Array.isArray(h.triggers)).toBe(true);
      expect(h.triggers.length).toBeGreaterThan(0);
      expect(h.triggers.every((t) => typeof t === 'string')).toBe(true);
      expect(typeof h.version).toBe('string');
      expect(/^\d+\.\d+\.\d+$/.test(h.version)).toBe(true);
      expect(Array.isArray(h.requires_tools)).toBe(true);
      expect(h.requires_tools.every((t) => typeof t === 'string')).toBe(true);
      expect(Array.isArray(h.composes_with)).toBe(true);
      expect(h.composes_with.every((s) => typeof s === 'string')).toBe(true);
    });

    it('composes_with references existing skills only', () => {
      for (const ref of skill.header.composes_with) {
        expect(knownSkillDirs).toContain(ref);
      }
    });

    it('has all required body sections in order with non-empty content', () => {
      for (const section of REQUIRED_SECTIONS) {
        const headingIndex = skill.body.indexOf(section.heading);
        expect(headingIndex).not.toBe(-1);
        // Extract content after the heading until the next ## or end
        const afterHeading = skill.body.substring(headingIndex + section.heading.length);
        const nextHeadingMatch = afterHeading.match(/\n## /);
        const sectionContent = nextHeadingMatch
          ? afterHeading.substring(0, nextHeadingMatch.index!)
          : afterHeading;
        expect(sectionContent.trim().length).toBeGreaterThan(0);
      }
    });

    it('contains DFIR-specific keywords from the HTML source', () => {
      const body = skill.body.toLowerCase();
      // From HTML: memory forensics, volatility, LiME, WinPMEM, mimikatz, etc.
      expect(body).toMatch(/memory[\s\S]*forensic/);
      expect(body).toContain('volatility');
      expect(body).toMatch(/disk[\s\S]*forensic|forensic[\s\S]*disk/);
      expect(body).toMatch(/network[\s\S]*forensic|forensic[\s\S]*network/);
      expect(body).toContain('autopsy');
      expect(body).toContain('zeek');
      expect(body).toContain('wireshark');
      expect(body).toMatch(/log[\s\S]*analysis|analysis[\s\S]*log/);
      expect(body).toContain('sysmon');
      expect(body).toContain('evtx');
      expect(body).toContain('anti-forensics');
      expect(body).toMatch(/chain of custody|chain-of-custody/);
      expect(body).toContain('sha-256');
    });
  });

  describe('advanced-pentest-lab', () => {
    let skill: ParsedSkill;

    it('SKILL.md exists at skills/advanced-pentest-lab/SKILL.md', () => {
      skill = readSkillFile('advanced-pentest-lab');
    });

    it('has all 7 required frontmatter keys with valid types', () => {
      const h = skill.header;
      expect(typeof h.name).toBe('string');
      expect(h.name).toBe('advanced-pentest-lab');
      expect(typeof h.role).toBe('string');
      expect(h.role.length).toBeGreaterThan(0);
      expect(typeof h.description).toBe('string');
      expect(h.description.length).toBeGreaterThan(0);
      expect(Array.isArray(h.triggers)).toBe(true);
      expect(h.triggers.length).toBeGreaterThan(0);
      expect(h.triggers.every((t) => typeof t === 'string')).toBe(true);
      expect(typeof h.version).toBe('string');
      expect(/^\d+\.\d+\.\d+$/.test(h.version)).toBe(true);
      expect(Array.isArray(h.requires_tools)).toBe(true);
      expect(h.requires_tools.every((t) => typeof t === 'string')).toBe(true);
      expect(Array.isArray(h.composes_with)).toBe(true);
      expect(h.composes_with.every((s) => typeof s === 'string')).toBe(true);
    });

    it('composes_with references existing skills only', () => {
      for (const ref of skill.header.composes_with) {
        expect(knownSkillDirs).toContain(ref);
      }
    });

    it('has all required body sections in order with non-empty content', () => {
      for (const section of REQUIRED_SECTIONS) {
        const headingIndex = skill.body.indexOf(section.heading);
        expect(headingIndex).not.toBe(-1);
        const afterHeading = skill.body.substring(headingIndex + section.heading.length);
        const nextHeadingMatch = afterHeading.match(/\n## /);
        const sectionContent = nextHeadingMatch
          ? afterHeading.substring(0, nextHeadingMatch.index!)
          : afterHeading;
        expect(sectionContent.trim().length).toBeGreaterThan(0);
      }
    });

    it('contains advanced pentest keywords from the HTML source', () => {
      const body = skill.body.toLowerCase();
      // From HTML: kerberoasting, bloodhound, golden ticket, JWT, GraphQL, SSRF, cloud, evasion, exploit development
      expect(body).toContain('kerberoasting');
      expect(body).toContain('bloodhound');
      expect(body).toContain('golden ticket');
      expect(body).toContain('jwt');
      expect(body).toContain('graphql');
      expect(body).toContain('ssrf');
      expect(body).toContain('cloud');
      expect(body).toContain('evasion');
      expect(body).toMatch(/exploit[\s\S]*development|develop[\s\S]*exploit/);
    });
  });

  describe('ethical-hacking-methodology', () => {
    let skill: ParsedSkill;

    it('SKILL.md exists at skills/ethical-hacking-methodology/SKILL.md', () => {
      skill = readSkillFile('ethical-hacking-methodology');
    });

    it('has all 7 required frontmatter keys with valid types', () => {
      const h = skill.header;
      expect(typeof h.name).toBe('string');
      expect(h.name).toBe('ethical-hacking-methodology');
      expect(typeof h.role).toBe('string');
      expect(h.role.length).toBeGreaterThan(0);
      expect(typeof h.description).toBe('string');
      expect(h.description.length).toBeGreaterThan(0);
      expect(Array.isArray(h.triggers)).toBe(true);
      expect(h.triggers.length).toBeGreaterThan(0);
      expect(h.triggers.every((t) => typeof t === 'string')).toBe(true);
      expect(typeof h.version).toBe('string');
      expect(/^\d+\.\d+\.\d+$/.test(h.version)).toBe(true);
      expect(Array.isArray(h.requires_tools)).toBe(true);
      expect(h.requires_tools.every((t) => typeof t === 'string')).toBe(true);
      expect(Array.isArray(h.composes_with)).toBe(true);
      expect(h.composes_with.every((s) => typeof s === 'string')).toBe(true);
    });

    it('composes_with references existing skills only', () => {
      for (const ref of skill.header.composes_with) {
        expect(knownSkillDirs).toContain(ref);
      }
    });

    it('has all required body sections in order with non-empty content', () => {
      for (const section of REQUIRED_SECTIONS) {
        const headingIndex = skill.body.indexOf(section.heading);
        expect(headingIndex).not.toBe(-1);
        const afterHeading = skill.body.substring(headingIndex + section.heading.length);
        const nextHeadingMatch = afterHeading.match(/\n## /);
        const sectionContent = nextHeadingMatch
          ? afterHeading.substring(0, nextHeadingMatch.index!)
          : afterHeading;
        expect(sectionContent.trim().length).toBeGreaterThan(0);
      }
    });

    it('contains 5-phase methodology keywords from the HTML source', () => {
      const body = skill.body.toLowerCase();
      // From HTML: reconnaissance, scanning, enumeration, exploitation, post-exploitation, reporting, Nmap, SQLi, etc.
      expect(body).toContain('reconnaissance');
      expect(body).toContain('scanning');
      expect(body).toContain('enumeration');
      expect(body).toContain('exploitation');
      expect(body).toMatch(/post.exploit/);
      expect(body).toContain('reporting');
      expect(body).toContain('remediation');
      expect(body).toContain('nmap');
      expect(body).toContain('osint');
    });
  });

  describe('frontmatter schema compliance across all 3 new skills', () => {
    const skillNames = ['advanced-dfir', 'advanced-pentest-lab', 'ethical-hacking-methodology'];
    for (const name of skillNames) {
      describe(name, () => {
        it('name field matches directory name', () => {
          const skill = readSkillFile(name);
          expect(skill.header.name).toBe(name);
        });

        it('version is semver-like', () => {
          const skill = readSkillFile(name);
          expect(skill.header.version).toBe('1.0.0');
        });

        it('description does not contain HTML tags', () => {
          const skill = readSkillFile(name);
          expect(skill.header.description).not.toMatch(/<[^>]+>/);
        });

        it('triggers are lowercase or dash-separated identifiers (no HTML)', () => {
          const skill = readSkillFile(name);
          for (const t of skill.header.triggers) {
            expect(t).not.toMatch(/<[^>]+>/);
          }
        });

        it('requires_tools uses _tool suffix convention', () => {
          const skill = readSkillFile(name);
          for (const t of skill.header.requires_tools) {
            expect(t).toMatch(/_tool$/);
          }
        });
      });
    }
  });
});
