// xcoder:version 2 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:01:30.013Z | xcoder:subtask code-st-b3a0c8
import { SkillRegistry } from "./externalSkillRegistry.js";
import { readKooderEnv } from "../config/env.js";

// Module-level cache: SkillRegistry headers loaded once per process lifetime.
let cachedSkills: string[] | null = null;
let cachedFlag: boolean | null = null;

/**
 * Returns true when KOODER_EXTERNAL_SKILLS (or a deprecated alias) is one of
 * 'true', '1', or 'yes' (case-insensitive), false otherwise.
 */
export function isExternalSkillsEnabled(): boolean {
  if (cachedFlag !== null) return cachedFlag;
  const raw = readKooderEnv("KOODER_EXTERNAL_SKILLS")?.trim().toLowerCase() ?? "";
  cachedFlag = raw === "true" || raw === "1" || raw === "yes";
  return cachedFlag;
}

/**
 * Load all external skills (from .agent/skill/<name>/SKILL.md) as formatted
 * header strings suitable for prompt injection. Uses process-lifetime caching
 * so SkillRegistry headers are only scanned once per CLI run.
 *
 * Returns [] when the flag is OFF, the skills directory is missing, or no
 * valid SKILL.md files exist.
 *
 * Format per skill: "<SkillHeader.name>: <SkillHeader.description>"
 * Only name + description — NOT the full body — to stay within token budget.
 */
export function getExternalSkills(opts?: { skillDir?: string }): string[] {
  if (!isExternalSkillsEnabled()) return [];

  if (cachedSkills !== null) return cachedSkills;

  try {
    const registry = new SkillRegistry(opts?.skillDir);
    const headers = registry.loadHeaders();
    if (headers.length === 0) {
      cachedSkills = [];
      return [];
    }
    cachedSkills = headers.map((h) => `${h.name}: ${h.description}`);
  } catch {
    cachedSkills = [];
  }

  return cachedSkills;
}

/**
 * Clear the internal cache so the next call to getExternalSkills() or
 * isExternalSkillsEnabled() re-reads the flag and re-loads headers.
 * Intended for testing.
 */
export function resetExternalSkillCache(): void {
  cachedSkills = null;
  cachedFlag = null;
}
