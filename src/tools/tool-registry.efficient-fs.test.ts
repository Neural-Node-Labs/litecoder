// xcoder:version 2 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:32:51.474Z | xcoder:subtask code-st-1a0810
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TOOL_MANIFEST, buildToolManifest, dispatchTool } from "./tool-registry.js";
import { buildAgentSystemPrompt } from "../protocol/react-contract.js";
import { getEnvironmentInfo } from "../util/env-info.js";
import { MAX_OBSERVATION_CHARS } from "./fs-tools.js";

const NEW_TOOLS = [
  "read_outline",
  "read_multiple_files",
  "read_full_file",
  "search_ast",
  "get_dependency_graph",
  "git_diff",
  "git_log",
  "line_patch",
  "apply_unified_diff",
  "update_function",
  "rename_symbol",
  "validate_file",
];

let dir: string;
let root: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "registry-efffs-test-"));
  root = dir;
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src/a.ts"),
    `export function add(a: number, b: number): number {
  return a + b;
}
const v = add(1, 2);
`,
    "utf8"
  );
  writeFileSync(path.join(root, "src/b.ts"), "export const b = 1;\n", "utf8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Efficient-filesystem manifest propagation (AC-01/02/03)", () => {
  it("all 12 new tools appear in TOOL_MANIFEST", () => {
    const names = TOOL_MANIFEST.map((t) => t.name);
    for (const name of NEW_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it("buildToolManifest() — the exact call every agent makes — includes every new name (AC-02)", () => {
    const m = buildToolManifest();
    const names = m.map((t) => t.name);
    for (const name of NEW_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it("buildAgentSystemPrompt renders every new tool name (AC-02)", () => {
    const prompt = buildAgentSystemPrompt({
      agentName: "test-agent",
      roleDescription: "test",
      directive: "test",
      goal: "test",
      isStandalone: false,
      skills: [],
      tools: buildToolManifest(),
      environment: getEnvironmentInfo(),
      detectedCommands: {
        stack: "node",
        reproduceHint: "reproduce first",
      },
    });
    for (const name of NEW_TOOLS) {
      expect(prompt).toContain(name);
    }
  });

  it("descriptions carry cheapest-first guidance fragments (AC-03)", () => {
    const byName = new Map(TOOL_MANIFEST.map((t) => [t.name, t]));
    expect(byName.get("read_outline")!.description).toMatch(/cheapest|prefer|outline/i);
    expect(byName.get("write_file")!.description).toMatch(/prefer|surgical|edit_file/i);
    expect(byName.get("git_diff")!.description).toMatch(/low-token|summary|stat/i);
    expect(byName.get("validate_file")!.description).toMatch(/validate|after any edit/i);
  });
});

describe("One dispatch per new tool against a temp workspace (AC-04/18)", () => {
  const outputJson = (o: unknown): string => JSON.stringify(o);

  it("read_outline — structural skeleton", async () => {
    const res = await dispatchTool(root, "read_outline", { path: "src/a.ts" });
    expect(res.ok).toBe(true);
    const out = outputJson(res.output);
    expect(out).toContain("add");
    expect(out.length).toBeLessThanOrEqual(MAX_OBSERVATION_CHARS);
  });

  it("read_multiple_files — batched sections", async () => {
    const res = await dispatchTool(root, "read_multiple_files", {
      files: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
    });
    expect(res.ok).toBe(true);
    const out = outputJson(res.output);
    expect(out).toContain("src/a.ts");
    expect(out).toContain("src/b.ts");
    expect(out.length).toBeLessThanOrEqual(MAX_OBSERVATION_CHARS);
  });

  it("read_full_file — gated read", async () => {
    const res = await dispatchTool(root, "read_full_file", { path: "src/a.ts", allowLarge: false });
    expect(res.ok).toBe(true);
    expect(outputJson(res.output)).toContain("function add");
  });

  it("search_ast — function query", async () => {
    const res = await dispatchTool(root, "search_ast", { query: "function add", pathGlob: "src/**/*.ts" });
    expect(res.ok).toBe(true);
    expect(outputJson(res.output)).toContain("add");
  });

  it("get_dependency_graph — imports + importers", async () => {
    const res = await dispatchTool(root, "get_dependency_graph", { path: "src/a.ts" });
    expect(res.ok).toBe(true);
    expect(outputJson(res.output)).toContain("src/a.ts");
  });

  it("git_diff — not_a_git_repo typed in temp dir, never throws", async () => {
    const res = await dispatchTool(root, "git_diff", {});
    expect(res.ok).toBe(false);
    const out = res.output as { code?: string };
    expect(out.code).toBe("not_a_git_repo");
  });

  it("git_log — not_a_git_repo typed in temp dir, never throws", async () => {
    const res = await dispatchTool(root, "git_log", { path: "src/a.ts" });
    expect(res.ok).toBe(false);
    const out = res.output as { code?: string };
    expect(out.code).toBe("not_a_git_repo");
  });

  it("line_patch — stale (zero writes) when the sha1 no longer matches", async () => {
    const res = await dispatchTool(root, "line_patch", {
      path: "src/a.ts",
      startLine: 1,
      endLine: 1,
      newContent: "x",
      expectedSha1: "0000000000000000000000000000000000000000", // never matches the real file
    });
    expect(res.ok).toBe(false);
    const out = res.output as { code?: string };
    expect(out.code).toBe("stale");
  });

  it("apply_unified_diff — JS hunk fallback works without a git repo (no throw)", async () => {
    const res = await dispatchTool(root, "apply_unified_diff", {
      path: "src/b.ts",
      diff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-export const b = 1;\n+export const b = 2;\n",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toMatchObject({ hunksApplied: 1 });
    }
  });

  it("update_function — replaces a unique function", async () => {
    const res = await dispatchTool(root, "update_function", {
      path: "src/a.ts",
      functionName: "add",
      newCode: "export function add(a: number, b: number): number {\n  return a * b;\n}",
    });
    expect(res.ok).toBe(true);
    expect(outputJson(res.output)).toContain("sha1After");
  });

  it("rename_symbol — scope-aware rename", async () => {
    const res = await dispatchTool(root, "rename_symbol", {
      path: "src/b.ts",
      name: "b",
      newName: "beta",
    });
    expect(res.ok).toBe(true);
    expect(outputJson(res.output)).toContain("count");
  });

  it("validate_file — post-edit validation on the workspace file", async () => {
    const res = await dispatchTool(root, "validate_file", { path: "src/a.ts", lang: "typescript" });
    expect(res.ok).toBe(true);
    expect(outputJson(res.output)).toContain("passed");
  });
});
