import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { LoadedSkill, SkillHeader } from "../types.js";
import { resolveSkillsPath } from "../config/loadConfig.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Registration manager for the Special Evolution skill system.
 * Reads every .agent/skill/<name>/SKILL.md, parses its YAML header so the LLM/orchestrator
 * knows what each skill is for without loading the full body, and lazily loads the full
 * body only when a skill is actually selected for a task.
 */
export class SkillRegistry {
  private headers = new Map<string, SkillHeader>();
  private paths = new Map<string, string>();
  private skillDir: string;

  constructor(skillDir?: string) {
    if (skillDir) {
      this.skillDir = skillDir;
      return;
    }
    const cwdSkills = path.join(resolveSkillsPath(), "skills");
    if (fs.existsSync(cwdSkills)) {
      this.skillDir = cwdSkills;
      return;
    }

    this.skillDir = cwdSkills;
  }

  /** Scan and parse headers only — cheap, safe to call often (e.g. on xcoder --index). */
  loadHeaders(): SkillHeader[] {
    this.headers.clear();
    this.paths.clear();

    if (!fs.existsSync(this.skillDir)) return [];

    const dirs = fs.readdirSync(this.skillDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    let countSkills=0;
    for (const dir of dirs) {
      const skillPath = path.join(this.skillDir, dir.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const raw = fs.readFileSync(skillPath, "utf-8");
      const match = raw.match(FRONTMATTER_RE);
      if (!match) continue;

      const header = yaml.load(match[1]) as SkillHeader;
      this.headers.set(header.name, header);
      this.paths.set(header.name, skillPath);
      countSkills++;
    }
    //console.log(`Skills count: ${countSkills}`)
    return [...this.headers.values()];
  }

  /** Load the full skill (header + body) by name, for injection into the LLM context. */
  loadSkill(name: string): LoadedSkill | undefined {
    const skillPath = this.paths.get(name);
    if (!skillPath) return undefined;

    const raw = fs.readFileSync(skillPath, "utf-8");
    const match = raw.match(FRONTMATTER_RE);
    if (!match) return undefined;

    const header = yaml.load(match[1]) as SkillHeader;
    return { header, body: match[2].trim(), path: skillPath };
  }

  /**
   * Route a task description to candidate skills by trigger-keyword match.
   * Returns skills ranked by match count, highest first. Multiple skills may
   * be selected — xcoder composes them (see composes_with in each header).
   */
  route(taskDescription: string): SkillHeader[] {
    if (this.headers.size === 0) this.loadHeaders();
    const text = taskDescription.toLowerCase();

    const scored = [...this.headers.values()].map((h) => {
      const score = h.triggers.reduce(
        (acc, t) => acc + (text.includes(t.toLowerCase()) ? 1 : 0),
        0
      );
      return { header: h, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.header);
  }

  list(): SkillHeader[] {
    if (this.headers.size === 0) this.loadHeaders();
    return [...this.headers.values()];
  }
}


