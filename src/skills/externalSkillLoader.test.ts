import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks ──
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

// We import AFTER the mock so the ModuleCache picks up the mocked dependency.
import {
  isExternalSkillsEnabled,
  getExternalSkills,
  resetExternalSkillCache,
} from "./externalSkillLoader.js";

// ── Helpers ──

/** Save and restore process.env.KOODER_EXTERNAL_SKILLS across tests. */
function withEnv(value: string | undefined): () => void {
  const original = process.env["KOODER_EXTERNAL_SKILLS"];
  if (value === undefined) {
    delete process.env["KOODER_EXTERNAL_SKILLS"];
  } else {
    process.env["KOODER_EXTERNAL_SKILLS"] = value;
  }
  return () => {
    if (original === undefined) {
      delete process.env["KOODER_EXTERNAL_SKILLS"];
    } else {
      process.env["KOODER_EXTERNAL_SKILLS"] = original;
    }
  };
}

// ── isExternalSkillsEnabled ──

describe("isExternalSkillsEnabled", () => {
  beforeEach(() => {
    resetExternalSkillCache();
  });

  it("returns false when env var is unset", () => {
    const restore = withEnv(undefined);
    try {
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it("returns false for empty string", () => {
    const restore = withEnv("");
    try {
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it('returns true for "true" (case-insensitive)', () => {
    const restore = withEnv("true");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns true for "TRUE"', () => {
    const restore = withEnv("TRUE");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns true for "True"', () => {
    const restore = withEnv("True");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns true for "1"', () => {
    const restore = withEnv("1");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns true for "yes" (case-insensitive)', () => {
    const restore = withEnv("yes");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns true for "YES"', () => {
    const restore = withEnv("YES");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns false for "false"', () => {
    const restore = withEnv("false");
    try {
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it('returns false for "0"', () => {
    const restore = withEnv("0");
    try {
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it('returns false for "no"', () => {
    const restore = withEnv("no");
    try {
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it("returns false for arbitrary values (e.g. 'enabled')", () => {
    const restore = withEnv("enabled");
    try {
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it("trims whitespace from the env value", () => {
    const restore = withEnv("  true  ");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore();
    }
  });

  it("caches the result (second call does not re-read env)", () => {
    // Start with flag ON
    const restore1 = withEnv("true");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
      // Change flag underneath
      delete process.env["KOODER_EXTERNAL_SKILLS"];
      process.env["KOODER_EXTERNAL_SKILLS"] = "false";
      // Cached result should still be true
      expect(isExternalSkillsEnabled()).toBe(true);
    } finally {
      restore1();
    }
  });
});

// ── getExternalSkills ──

describe("getExternalSkills", () => {
  beforeEach(() => {
    resetExternalSkillCache();
    vi.clearAllMocks();
  });

  it("returns [] when flag is OFF", () => {
    const restore = withEnv(undefined);
    try {
      const skills = getExternalSkills();
      expect(skills).toEqual([]);
      // SkillRegistry should never be instantiated when flag is off
      expect(mockSkillRegistryCtor).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("returns [] when flag is OFF even for 'false' string", () => {
    const restore = withEnv("false");
    try {
      const skills = getExternalSkills();
      expect(skills).toEqual([]);
      expect(mockSkillRegistryCtor).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("returns formatted skill list when flag ON and headers exist", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      { name: "docker-expert", description: "Docker container expertise", triggers: [], version: "1.0.0", role: "devops", requires_tools: [], composes_with: [] },
      { name: "kubernetes", description: "K8s orchestration", triggers: [], version: "1.0.0", role: "devops", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills = getExternalSkills();
      expect(skills).toEqual([
        "docker-expert: Docker container expertise",
        "kubernetes: K8s orchestration",
      ]);
      expect(mockSkillRegistryCtor).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("returns [] when flag ON but no headers found", () => {
    const restore = withEnv("1");
    mockLoadHeaders.mockReturnValue([]);
    try {
      const skills = getExternalSkills();
      expect(skills).toEqual([]);
    } finally {
      restore();
    }
  });

  it("returns [] when flag ON but SkillRegistry throws", () => {
    const restore = withEnv("yes");
    mockLoadHeaders.mockImplementation(() => {
      throw new Error("ENOENT: no such directory");
    });
    try {
      const skills = getExternalSkills();
      expect(skills).toEqual([]);
    } finally {
      restore();
    }
  });

  it("respects custom skillDir option when flag ON", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      { name: "custom-skill", description: "A custom one", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills = getExternalSkills({ skillDir: "/custom/skills" });
      expect(skills).toEqual(["custom-skill: A custom one"]);
      expect(mockSkillRegistryCtor).toHaveBeenCalledWith("/custom/skills");
    } finally {
      restore();
    }
  });

  it("passes undefined skillDir when no option is given", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([]);
    try {
      getExternalSkills();
      // No explicit skillDir → constructor receives undefined (relies on default)
      expect(mockSkillRegistryCtor).toHaveBeenCalledWith(undefined);
    } finally {
      restore();
    }
  });

  it("caches the result — second call does not reload", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      { name: "s1", description: "first load", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills1 = getExternalSkills();
      expect(skills1).toEqual(["s1: first load"]);
      expect(mockSkillRegistryCtor).toHaveBeenCalledTimes(1);
      expect(mockLoadHeaders).toHaveBeenCalledTimes(1);

      // Second call — cached, no new Registry or loadHeaders
      const skills2 = getExternalSkills();
      expect(skills2).toEqual(["s1: first load"]);
      expect(mockSkillRegistryCtor).toHaveBeenCalledTimes(1);
      expect(mockLoadHeaders).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});

// ── resetExternalSkillCache ──

describe("resetExternalSkillCache", () => {
  beforeEach(() => {
    resetExternalSkillCache();
    vi.clearAllMocks();
  });

  it("clears the isExternalSkillsEnabled cache so it re-reads env", () => {
    const restore = withEnv("true");
    try {
      expect(isExternalSkillsEnabled()).toBe(true);
      // Change flag
      delete process.env["KOODER_EXTERNAL_SKILLS"];
      process.env["KOODER_EXTERNAL_SKILLS"] = "false";
      // Before reset, cache says true
      expect(isExternalSkillsEnabled()).toBe(true);
      resetExternalSkillCache();
      // After reset, re-reads env → false
      expect(isExternalSkillsEnabled()).toBe(false);
    } finally {
      restore();
    }
  });

  it("clears the getExternalSkills cache so it reloads headers", () => {
    const restore = withEnv("1");
    mockLoadHeaders.mockReturnValueOnce([
      { name: "s1", description: "batch 1", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    mockLoadHeaders.mockReturnValueOnce([
      { name: "s2", description: "batch 2", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills1 = getExternalSkills();
      expect(skills1).toEqual(["s1: batch 1"]);

      resetExternalSkillCache();

      const skills2 = getExternalSkills();
      expect(skills2).toEqual(["s2: batch 2"]);
      expect(mockLoadHeaders).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("is idempotent — calling it multiple times is safe", () => {
    // Should not throw
    resetExternalSkillCache();
    resetExternalSkillCache();
    resetExternalSkillCache();
  });
});

// ── SubAgent integration (unit-level) ──
// We verify the contract: external skills are appended only when
//   - KOODER_EXTERNAL_SKILLS is ON, AND
//   - role !== 'conversation'
// This is tested by exercising the logic path from sub-agent.ts without
// running the full agent loop.

describe("SubAgent external-skills integration (contract)", () => {
  beforeEach(() => {
    resetExternalSkillCache();
    vi.clearAllMocks();
  });

  // Re-implement the exact logic from SubAgent.run()
  // (lines 69-74 of sub-agent.ts) so we can assert against it.
  function computeEffectiveSkills(
    role: string,
    baseSkills: string[],
  ): string[] {
    if (role !== "conversation" && isExternalSkillsEnabled()) {
      return [...baseSkills, ...getExternalSkills()];
    }
    return baseSkills;
  }

  it("does NOT append external skills for conversation role when flag ON", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      { name: "ext", description: "external", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills = computeEffectiveSkills("conversation", ["Chat"]);
      expect(skills).toEqual(["Chat"]);
    } finally {
      restore();
    }
  });

  it("does NOT append external skills for any role when flag OFF", () => {
    const restore = withEnv(undefined);
    try {
      const skills = computeEffectiveSkills("tester", ["Testing"]);
      expect(skills).toEqual(["Testing"]);
    } finally {
      restore();
    }
  });

  it("appends external skills for non-conversation role when flag ON", () => {
    const restore = withEnv("1");
    mockLoadHeaders.mockReturnValue([
      { name: "docker-expert", description: "Container skills", triggers: [], version: "1.0.0", role: "devops", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills = computeEffectiveSkills("programmer", [
        "TypeScript expertise",
        "git skills",
      ]);
      expect(skills).toEqual([
        "TypeScript expertise",
        "git skills",
        "docker-expert: Container skills",
      ]);
    } finally {
      restore();
    }
  });

  it("appends multiple external skills for non-conversation roles", () => {
    const restore = withEnv("yes");
    mockLoadHeaders.mockReturnValue([
      { name: "a", description: "first", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
      { name: "b", description: "second", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      const skills = computeEffectiveSkills("architect", ["Design"]);
      expect(skills).toEqual(["Design", "a: first", "b: second"]);
    } finally {
      restore();
    }
  });

  it("does not mutate the original baseSkills array", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      { name: "ext", description: "desc", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      const original = ["BaseSkill"];
      const result = computeEffectiveSkills("tester", original);
      expect(result).toEqual(["BaseSkill", "ext: desc"]);
      // Original array unchanged
      expect(original).toEqual(["BaseSkill"]);
    } finally {
      restore();
    }
  });

  it("appends nothing when flag ON but no external skills exist", () => {
    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([]);
    try {
      const skills = computeEffectiveSkills("refactorer", ["Refactoring"]);
      expect(skills).toEqual(["Refactoring"]);
    } finally {
      restore();
    }
  });

  it("all known non-conversation roles can receive external skills", () => {
    const allRoles: string[] = [
      "requirements-analyst",
      "architect",
      "programmer",
      "refactorer",
      "tester",
      "ui-api-tester",
      "technical-writer",
      "devops",
      "business-analyst",
      "defect-manager",
    ];

    const restore = withEnv("true");
    mockLoadHeaders.mockReturnValue([
      { name: "shared", description: "shared skill", triggers: [], version: "1.0.0", role: "tester", requires_tools: [], composes_with: [] },
    ]);
    try {
      for (const role of allRoles) {
        const skills = computeEffectiveSkills(role, ["Base"]);
        expect(skills).toEqual(["Base", "shared: shared skill"]);
      }
    } finally {
      restore();
    }
  });
});
