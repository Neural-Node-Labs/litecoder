import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks (same pattern as externalSkillLoader.test.ts) ──
const mockIsExternalSkillsEnabled = vi.hoisted(() => vi.fn());
const mockRegistryLoadHeaders = vi.hoisted(() => vi.fn());
const mockRegistryLoadSkill = vi.hoisted(() => vi.fn());
const mockRegistryRoute = vi.hoisted(() => vi.fn());
const mockRegistryCtor = vi.hoisted(() => vi.fn());

vi.mock("../skills/externalSkillLoader.js", () => ({
  isExternalSkillsEnabled: mockIsExternalSkillsEnabled,
}));

vi.mock("../skills/externalSkillRegistry.js", () => ({
  SkillRegistry: class {
    constructor(skillDir?: string) {
      mockRegistryCtor(skillDir);
    }
    loadHeaders = mockRegistryLoadHeaders;
    loadSkill = mockRegistryLoadSkill;
    route = mockRegistryRoute;
  },
}));

const MOCK_ALLOWLIST: Record<string, string[]> = {
  tester: ["tester", "qa-engineer", "rca", "performance-tester"],
  architect: ["architect", "software-architect", "design-patterns"],
  "empty-role": [],
};

let mockRoleSkillAllowlist: Record<string, string[]> = { ...MOCK_ALLOWLIST };

vi.mock("../skills/skillRouter.js", () => ({
  get ROLE_SKILL_ALLOWLIST() {
    return mockRoleSkillAllowlist;
  },
}));

import { loadSkillTool } from "./load-skill-tool.js";
import type { LoadedSkill } from "../types.js";
import type { ToolCallResult } from "./tool-registry.js";

// ── Helpers ──

function o(result: ToolCallResult): Record<string, unknown> {
  return result.output as Record<string, unknown>;
}

function makeLoadedSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    header: {
      name: overrides.header?.name ?? "tester",
      role: overrides.header?.role ?? "quality",
      description: overrides.header?.description ?? "A test skill",
      triggers: overrides.header?.triggers ?? ["test"],
      version: overrides.header?.version ?? "1.0.0",
      requires_tools: overrides.header?.requires_tools ?? [],
      composes_with: overrides.header?.composes_with ?? [],
    },
    body: overrides.body ?? "# Skill Body",
    path: overrides.path ?? "/skills/tester/SKILL.md",
  };
}

function makeSkillHeader(name: string, description: string, triggers: string[] = [name]) {
  return {
    name,
    role: "any",
    description,
    triggers,
    version: "1.0.0",
    requires_tools: [] as string[],
    composes_with: [] as string[],
  };
}

function resetAllMocks() {
  mockIsExternalSkillsEnabled.mockReset();
  mockRegistryLoadHeaders.mockReset();
  mockRegistryLoadSkill.mockReset();
  mockRegistryRoute.mockReset();
  mockRegistryCtor.mockReset();
  mockRoleSkillAllowlist = { ...MOCK_ALLOWLIST };
}

beforeEach(resetAllMocks);

// ── Tests ──

describe("loadSkillTool", () => {
  describe("when external skills are disabled", () => {
    beforeEach(() => {
      mockIsExternalSkillsEnabled.mockReturnValue(false);
    });

    it("returns ok with empty skills and reason", async () => {
      const result = await loadSkillTool({ role: "tester" }, {});
      expect(result.ok).toBe(true);
      expect(result.tool).toBe("load_skill");
      expect(o(result)).toEqual({ skills: [], reason: "external skills disabled" });
    });

    it("does not create a SkillRegistry", async () => {
      await loadSkillTool({ role: "tester" }, {});
      expect(mockRegistryCtor).not.toHaveBeenCalled();
    });

    it("skips input validation and returns disabled message", async () => {
      const result = await loadSkillTool({}, {});
      expect(result.ok).toBe(true);
      expect(o(result)).toEqual({ skills: [], reason: "external skills disabled" });
    });
  });

  describe("input validation", () => {
    beforeEach(() => {
      mockIsExternalSkillsEnabled.mockReturnValue(true);
    });

    describe("when neither role nor keyword is provided", () => {
      it("returns an error for empty object", async () => {
        const result = await loadSkillTool({}, {});
        expect(result.ok).toBe(false);
        expect(result.tool).toBe("load_skill");
        expect(o(result)).toHaveProperty("error");
        expect(o(result).error as string).toContain("exactly one of");
      });

      it("returns an error when role is empty string", async () => {
        const result = await loadSkillTool({ role: "" }, {});
        expect(result.ok).toBe(false);
        expect(o(result).error as string).toContain("exactly one of");
      });

      it("returns an error when role is whitespace only", async () => {
        const result = await loadSkillTool({ role: "   " }, {});
        expect(result.ok).toBe(false);
        expect(o(result).error as string).toContain("exactly one of");
      });

      it("returns an error when keyword is empty string", async () => {
        const result = await loadSkillTool({ keyword: "" }, {});
        expect(result.ok).toBe(false);
        expect(o(result).error as string).toContain("exactly one of");
      });

      it("returns an error when keyword is whitespace only", async () => {
        const result = await loadSkillTool({ keyword: "   " }, {});
        expect(result.ok).toBe(false);
        expect(o(result).error as string).toContain("exactly one of");
      });
    });

    describe("when both role and keyword are provided", () => {
      it("returns an error", async () => {
        const result = await loadSkillTool({ role: "tester", keyword: "penetration" }, {});
        expect(result.ok).toBe(false);
        expect(result.tool).toBe("load_skill");
        expect(o(result).error as string).toContain("both");
        expect(o(result).error as string).toContain("Choose one mode");
      });
    });

    describe("when only role is provided with a valid value", () => {
      it("passes validation and proceeds to role lookup", async () => {
        const result = await loadSkillTool({ role: "tester" }, {});
        expect(result.ok).toBe(true);
        expect(o(result).mode).toBe("role");
        expect(o(result).role).toBe("tester");
      });
    });

    describe("when only keyword is provided with a valid value", () => {
      it("passes validation and proceeds to keyword search", async () => {
        mockRegistryLoadHeaders.mockReturnValue([]);
        mockRegistryRoute.mockReturnValue([]);
        mockRegistryLoadSkill.mockReturnValue(null);
        const result = await loadSkillTool({ keyword: "penetration testing" }, {});
        expect(result.ok).toBe(true);
        expect(o(result).mode).toBe("keyword");
        expect(o(result).keyword).toBe("penetration testing");
      });
    });
  });

  describe("role-based lookup", () => {
    beforeEach(() => {
      mockIsExternalSkillsEnabled.mockReturnValue(true);
    });

    it("returns empty skills for a role with empty allowlist", async () => {
      const result = await loadSkillTool({ role: "empty-role" }, {});
      expect(result.ok).toBe(true);
      expect(o(result).skills as unknown[]).toEqual([]);
    });

    it("returns empty skills for an unrecognised role", async () => {
      const result = await loadSkillTool({ role: "unknown-role" }, {});
      expect(result.ok).toBe(true);
      expect(o(result).skills as unknown[]).toEqual([]);
    });

    it("loads skills for each name in the role's allowlist", async () => {
      mockRegistryLoadSkill.mockImplementation((name: string) => {
        if (name === "tester" || name === "qa-engineer") {
          return makeLoadedSkill({
            header: {
              name,
              role: "quality",
              description: "test",
              triggers: [name],
              version: "1.0.0",
              requires_tools: [],
              composes_with: [],
            },
          });
        }
        return null;
      });
      const result = await loadSkillTool({ role: "tester" }, {});
      expect(result.ok).toBe(true);
      expect(o(result).skills as unknown[]).toHaveLength(2);
    });

    it("skips names that loadSkill returns null for", async () => {
      mockRegistryLoadSkill.mockReturnValue(null);
      const result = await loadSkillTool({ role: "tester" }, {});
      expect(result.ok).toBe(true);
      expect(o(result).skills as unknown[]).toEqual([]);
    });

    it("passes skillDir opt to SkillRegistry constructor", async () => {
      mockRegistryLoadSkill.mockReturnValue(null);
      await loadSkillTool({ role: "tester" }, { skillDir: "/custom/skills" });
      expect(mockRegistryCtor).toHaveBeenCalledWith("/custom/skills");
    });
  });

  describe("keyword-based search", () => {
    beforeEach(() => {
      mockIsExternalSkillsEnabled.mockReturnValue(true);
    });

    it("calls registry.route with the keyword", async () => {
      mockRegistryRoute.mockReturnValue([]);
      await loadSkillTool({ keyword: "penetration testing" }, {});
      expect(mockRegistryRoute).toHaveBeenCalledWith("penetration testing");
    });

    it("loads skills for each header returned by route (up to 5)", async () => {
      const headers = [
        makeSkillHeader("skillA", "desc A"),
        makeSkillHeader("skillB", "desc B"),
        makeSkillHeader("skillC", "desc C"),
        makeSkillHeader("skillD", "desc D"),
        makeSkillHeader("skillE", "desc E"),
        makeSkillHeader("skillF", "desc F"),
      ];
      mockRegistryRoute.mockReturnValue(headers);
      mockRegistryLoadSkill.mockImplementation((name: string) => {
        return makeLoadedSkill({
          header: {
            name,
            role: "any",
            description: "test",
            triggers: [name],
            version: "1.0.0",
            requires_tools: [],
            composes_with: [],
          },
        });
      });
      const result = await loadSkillTool({ keyword: "test" }, {});
      expect(result.ok).toBe(true);
      expect(o(result).skills as unknown[]).toHaveLength(5);
    });

    it("skips headers where loadSkill returns null", async () => {
      mockRegistryRoute.mockReturnValue([
        makeSkillHeader("exists", "exists"),
        makeSkillHeader("missing", "missing"),
      ]);
      mockRegistryLoadSkill.mockImplementation((name: string) => {
        if (name === "exists") return makeLoadedSkill();
        return null;
      });
      const result = await loadSkillTool({ keyword: "test" }, {});
      expect(result.ok).toBe(true);
      expect(o(result).skills as unknown[]).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockIsExternalSkillsEnabled.mockReturnValue(true);
    });

    it("catches errors during role lookup and returns ok: false", async () => {
      mockRegistryLoadSkill.mockImplementation(() => {
        throw new Error("registry explode");
      });
      const result = await loadSkillTool({ role: "tester" }, {});
      expect(result.ok).toBe(false);
      expect(o(result).error as string).toContain("unexpected error");
      expect(o(result).error as string).toContain("registry explode");
    });

    it("catches errors during keyword search and returns ok: false", async () => {
      mockRegistryRoute.mockReturnValue([makeSkillHeader("x", "x")]);
      mockRegistryLoadSkill.mockImplementation(() => {
        throw new Error("keyword explode");
      });
      const result = await loadSkillTool({ keyword: "test" }, {});
      expect(result.ok).toBe(false);
      expect(o(result).error as string).toContain("unexpected error");
      expect(o(result).error as string).toContain("keyword explode");
    });
  });
});
