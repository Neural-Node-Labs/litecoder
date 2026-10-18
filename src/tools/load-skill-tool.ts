import { SkillRegistry } from "../skills/externalSkillRegistry.js";
import { isExternalSkillsEnabled } from "../skills/externalSkillLoader.js";
import { ROLE_SKILL_ALLOWLIST } from "../skills/skillRouter.js";
import type { LoadedSkill } from "../types.js";
import type { ToolCallResult } from "./tool-registry.js";

export interface LoadSkillInput {
  role?: string;    // e.g. "tester", "architect"
  keyword?: string; // e.g. "penetration testing"
}

/**
 * Load the full bodies of external skill files (SKILL.md) by role or keyword.
 * 
 * Modes (mutually exclusive):
 *  - role: looks up ROLE_SKILL_ALLOWLIST[role] and loads each allowed skill.
 *  - keyword: calls registry.route(keyword) and returns top 5 matches.
 */
export async function loadSkillTool(
  input: LoadSkillInput,
  opts: { skillDir?: string }
): Promise<ToolCallResult> {
  // ── Flag gate ──────────────────────────────────────────────────────
  if (!isExternalSkillsEnabled()) {
    return {
      tool: "load_skill",
      ok: true, // valid response, not an error
      output: { skills: [], reason: "external skills disabled" },
    };
  }

  const { role, keyword } = input;

  // ── Modal validation: role XOR keyword must be a non-empty string ──
  const hasRole = typeof role === "string" && role.trim().length > 0;
  const hasKeyword = typeof keyword === "string" && keyword.trim().length > 0;

  if (!hasRole && !hasKeyword) {
    return {
      tool: "load_skill",
      ok: false,
      output: {
        error:
          '"load_skill" requires exactly one of "role" or "keyword" to be a non-empty string. ' +
          'Provide either { "role": "tester" } or { "keyword": "penetration testing" } — not both and not neither.',
      },
    };
  }

  if (hasRole && hasKeyword) {
    return {
      tool: "load_skill",
      ok: false,
      output: {
        error:
          '"load_skill" received both "role" and "keyword". Choose one mode — ' +
          'role-based lookup OR keyword-based search — not both at once.',
      },
    };
  }

  // ── Fresh registry per call (see tradeoff #1 in design) ─────────────
  const registry = new SkillRegistry(opts.skillDir);
  registry.loadHeaders();

  try {
    if (hasRole) {
      const skills = getSkillsForRole(registry, role!.trim());
      return {
        tool: "load_skill",
        ok: true,
        output: {
          skills: skills.map(formatLoadedSkillForOutput),
          mode: "role",
          role: role!.trim(),
        },
      };
    }

    // hasKeyword branch
    const skills = getSkillsForKeyword(registry, keyword!.trim(), 5);
    return {
      tool: "load_skill",
      ok: true,
      output: {
        skills: skills.map(formatLoadedSkillForOutput),
        mode: "keyword",
        keyword: keyword!.trim(),
      },
    };
  } catch (e) {
    return {
      tool: "load_skill",
      ok: false,
      output: { error: `load_skill unexpected error: ${(e as Error).message}` },
    };
  }
}

// ── Private helpers ────────────────────────────────────────────────────────

function getSkillsForRole(registry: SkillRegistry, role: string): LoadedSkill[] {
  const allowedNames = ROLE_SKILL_ALLOWLIST[role as keyof typeof ROLE_SKILL_ALLOWLIST];
  if (!allowedNames || allowedNames.length === 0) {
    return [];
  }

  const skills: LoadedSkill[] = [];
  for (const name of allowedNames) {
    const skill = registry.loadSkill(name);
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
}

function getSkillsForKeyword(
  registry: SkillRegistry,
  keyword: string,
  maxResults: number
): LoadedSkill[] {
  const headers = registry.route(keyword);
  const top = headers.slice(0, maxResults);

  const skills: LoadedSkill[] = [];
  for (const header of top) {
    const skill = registry.loadSkill(header.name);
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
}

interface LoadedSkillOutput {
  name: string;
  description: string;
  body: string;
  path: string;
}

function formatLoadedSkillForOutput(skill: LoadedSkill): LoadedSkillOutput {
  return {
    name: skill.header.name,
    description: skill.header.description,
    body: skill.body,
    path: skill.path,
  };
}
