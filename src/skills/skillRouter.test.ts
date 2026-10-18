import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLoadHeaders = vi.hoisted(() => vi.fn());
const mockSkillRegistryCtor = vi.hoisted(() => vi.fn());

vi.mock("./externalSkillRegistry.js", () => ({
  SkillRegistry: class {
    constructor(skillDir?: string) {
      mockSkillRegistryCtor(skillDir);
    }
    loadHeaders = mockLoadHeaders;
  },
}));

import { resetExternalSkillCache } from "./externalSkillLoader.js";
import { getRoutedExternalSkills, ROLE_SKILL_ALLOWLIST } from "./skillRouter.js";

function withEnv(value: string | undefined): () => void {
  const original = process.env["KOODER_EXTERNAL_SKILLS"];
  if (value === undefined) delete process.env["KOODER_EXTERNAL_SKILLS"];
  else process.env["KOODER_EXTERNAL_SKILLS"] = value;
  return () => {
    if (original === undefined) delete process.env["KOODER_EXTERNAL_SKILLS"];
    else process.env["KOODER_EXTERNAL_SKILLS"] = original;
  };
}

function header(name: string, description = `${name} description`) {
  return { name, description, triggers: [], version: "1.0.0", role: "x", requires_tools: [], composes_with: [] };
}

describe("getRoutedExternalSkills", () => {
  beforeEach(() => {
    resetExternalSkillCache();
    vi.clearAllMocks();
  });

  it("returns [] when the flag is off, regardless of role", () => {
    const restore = withEnv(undefined);
    try {
      expect(getRoutedExternalSkills("tester")).toEqual([]);
      expect(mockSkillRegistryCtor).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("only returns skills allowlisted for the given role, not every skill", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      header("tester"),
      header("qa-engineer"),
      header("aws"), // NOT allowlisted for tester
      header("kubernetes"), // NOT allowlisted for tester
    ]);
    try {
      const result = getRoutedExternalSkills("tester");
      expect(result).toEqual(["tester: tester description", "qa-engineer: qa-engineer description"]);
      expect(result).not.toContain("aws: aws description");
      expect(result).not.toContain("kubernetes: kubernetes description");
    } finally {
      restore();
    }
  });

  it("never includes 'enterprise-systems-analyst' under the business-analyst role (the resolved naming collision)", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      header("enterprise-systems-analyst"),
      header("ui-ux-design"),
    ]);
    try {
      const result = getRoutedExternalSkills("business-analyst");
      expect(result).toEqual(["ui-ux-design: ui-ux-design description"]);
      expect(result.some((s) => s.startsWith("enterprise-systems-analyst"))).toBe(false);
    } finally {
      restore();
    }
  });

  it("never includes 'programmer' under the refactorer role (avoids the scope-blur collision)", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      header("programmer"),
      header("software-engineer"),
      header("rca"),
    ]);
    try {
      const result = getRoutedExternalSkills("refactorer");
      expect(result.some((s) => s.startsWith("programmer:"))).toBe(false);
      expect(result).toContain("software-engineer: software-engineer description");
    } finally {
      restore();
    }
  });

  it("never includes 'scrum-master-agent' under the scrum-master quality-gate role", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      header("scrum-master-agent"),
      header("scrum-framework"),
    ]);
    try {
      const result = getRoutedExternalSkills("scrum-master");
      expect(result).toEqual(["scrum-framework: scrum-framework description"]);
    } finally {
      restore();
    }
  });

  it("returns [] for a role with no allowlist entry (e.g. conversation)", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([header("tester")]);
    try {
      expect(getRoutedExternalSkills("conversation")).toEqual([]);
    } finally {
      restore();
    }
  });

  it("caps results at maxSkills", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      header("devops"), header("docker"), header("docker-expert"), header("kubernetes"),
    ]);
    try {
      const result = getRoutedExternalSkills("devops", { maxSkills: 2 });
      expect(result.length).toBe(2);
    } finally {
      restore();
    }
  });

  it("passes skillDir option through to the underlying loader", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([header("tester")]);
    try {
      getRoutedExternalSkills("tester", { skillDir: "/custom/skills" });
      expect(mockSkillRegistryCtor).toHaveBeenCalledWith("/custom/skills");
    } finally {
      restore();
    }
  });

  it("every allowlisted skill name is a plausible kebab-case identifier (sanity check on the table itself)", () => {
    for (const names of Object.values(ROLE_SKILL_ALLOWLIST)) {
      for (const name of names ?? []) {
        expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });
});
