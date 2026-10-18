import type { Role } from "../types.js";
import { isExternalSkillsEnabled, getExternalSkills } from "./externalSkillLoader.js";

/**
 * Curated map from Kooder's internal Role (see src/types.ts) to the external
 * SKILL.md names (under the resolved skills directory, e.g. `skills/<name>/
 * SKILL.md` at the project root) that are safe and relevant to inject for
 * that role.
 *
 * WHY THIS EXISTS: previously, `sub-agent.ts` called `getExternalSkills()`
 * directly and appended *every* external skill's one-line description to
 * *every* non-conversation role's prompt, regardless of relevance. That had
 * two problems:
 *   1. Noise — a `tester` subtask's prompt would also see one-liners for
 *      AWS, Kubernetes, DFIR, business-analyst UI design, etc.
 *   2. Real contradictions — some external skills share a name with a Role
 *      but describe a different job. The clearest case: the external
 *      "business-analyst" skill (traditional BRD/FRD/ERP requirements work)
 *      directly contradicted Kooder's hardcoded `business-analyst` Role
 *      directive, which is deliberately scoped to UI/UX page design only
 *      (see ROLE_DIRECTIVES["business-analyst"] in ./directives.ts, and the
 *      separate BA_REQUIREMENTS_DIRECTIVE carved out specifically to keep
 *      general requirements work OUT of that Role). That skill has since
 *      been renamed to "enterprise-systems-analyst" and is intentionally
 *      NOT listed under "business-analyst" below.
 *
 * Keep this list conservative: only add a skill here once you've confirmed
 * its guidance doesn't contradict the hardcoded ROLE_DIRECTIVES entry for
 * that role. When in doubt, leave it out — an omitted skill just means one
 * fewer optional hint, but a contradictory one actively confuses the model
 * about what it's supposed to do.
 */
export const ROLE_SKILL_ALLOWLIST: Partial<Record<Role, string[]>> = {
  "requirements-analyst": ["analyst", "enterprise-systems-analyst", "task-planning"],

  architect: ["architect", "software-architect", "design-patterns", "solid-principles", "project-scaffolding"],

  // Deliberately does NOT include "refactorer"-flavored language — see the
  // updated skills/programmer/SKILL.md description, which was itself
  // narrowed to new/design-driven implementation for the same reason.
  programmer: ["programmer", "software-engineer", "design-patterns", "solid-principles", "git-vcs"],

  // Deliberately excludes "programmer" — that skill's original scope
  // ("fix bug", "refactor") blurred the boundary Kooder's directive draws
  // between programmer (design-driven implementation) and refactorer
  // (minimal-diff, no redesign). Give refactorer its own, narrower set.
  refactorer: ["software-engineer", "design-patterns", "solid-principles", "rca"],

  tester: ["tester", "qa-engineer", "rca", "performance-tester"],

  "ui-api-tester": ["playwright-ui-tester", "qa-engineer", "ui-ux-design"],

  "technical-writer": ["workspace-context"],

  devops: [
    "devops", "docker", "docker-expert", "kubernetes", "kubernetes-expert",
    "aws", "azure", "openshift", "redhat", "rosa", "ubuntu", "git-vcs",
  ],

  // "conversation" intentionally omitted: sub-agent.ts already skips
  // external-skill injection entirely for this role, so listing anything
  // here would never be used — kept out to avoid implying otherwise.

  // Intentionally does NOT include "enterprise-systems-analyst" — see the
  // module doc comment above. This Role is UI/UX-scoped in Kooder.
  "business-analyst": ["ui-ux-design"],

  "defect-manager": ["rca", "task-planning"],

  // Deliberately excludes "scrum-master-agent" (a behavioral playbook for
  // human-team sprint coaching — stand-ups, burndown, retro insights) —
  // this Role is an internal JSON pass/fail quality gate, a different job,
  // and it needs a strict, uncluttered prompt to reliably emit clean JSON.
  "scrum-master": ["scrum-framework"],

  "system-architect": ["software-architect", "design-patterns", "solid-principles"],

  "security-lead": ["secops", "advanced-dfir", "ethical-hacking-methodology", "advanced-pentest-lab", "pentester"],
};

export interface RoutedSkillsOptions {
  skillDir?: string;
  /**
   * Cap on how many external skill lines get injected per subtask, so a
   * role's allowlist growing over time can't unboundedly bloat the prompt.
   * Default 6.
   */
  maxSkills?: number;
}

/**
 * Role-aware replacement for calling getExternalSkills() directly. Returns
 * only the external skills allowlisted for this specific role, formatted
 * exactly the way getExternalSkills() already formats them ("name:
 * description"), so existing callers that treat the result as a flat
 * string[] keep working unchanged.
 *
 * Returns [] when the KOODER_EXTERNAL_SKILLS flag is off, or when the role
 * has no allowlist entry (e.g. "conversation").
 */
export function getRoutedExternalSkills(role: Role, opts: RoutedSkillsOptions = {}): string[] {
  if (!isExternalSkillsEnabled()) return [];

  const allowedNames = ROLE_SKILL_ALLOWLIST[role];
  if (!allowedNames || allowedNames.length === 0) return [];

  const allowedSet = new Set(allowedNames);
  const all = getExternalSkills({ skillDir: opts.skillDir }); // ["name: description", ...]

  const filtered = all.filter((line) => {
    const sep = line.indexOf(":");
    const name = sep === -1 ? line : line.slice(0, sep);
    return allowedSet.has(name);
  });

  const max = opts.maxSkills ?? 6;
  return filtered.slice(0, max);
}
