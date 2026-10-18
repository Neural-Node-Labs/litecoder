// xcoder:version 6 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:40:57.913Z | xcoder:subtask test-st-8ac478
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockReadFileTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, body: "content" }));
const mockWriteFileTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const mockListDirTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, matches: [] }));
const mockEditFileTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const mockGlobTool = vi.hoisted(() => vi.fn().mockResolvedValue(["file1.ts", "file2.ts"]));
const mockGrepTool = vi.hoisted(() => vi.fn().mockResolvedValue([{ file: "a.ts", line: 1, text: "match" }]));
const mockTestApiEndpoint = vi.hoisted(() => vi.fn().mockResolvedValue({
  url: "https://example.com/api",
  method: "GET",
  statusCode: 200,
  statusText: "OK",
  headers: {},
  body: { ok: true },
  bodyTruncated: false,
  durationMs: 10,
  contentType: "application/json",
}));
const mockScheduleCron = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "j1", cronExpr: "0 9 * * *" }));
const mockScheduleOnce = vi.hoisted(() => vi.fn().mockResolvedValue({ scheduledFor: "2026-01-01T00:00:00.000Z" }));
const mockListScheduled = vi.hoisted(() => vi.fn().mockResolvedValue([{ id: "j1", cronExpr: "0 9 * * *", command: "echo hi" }]));
const mockRemoveScheduled = vi.hoisted(() => vi.fn().mockResolvedValue({ removed: true }));
const mockRunCommandTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: "ok", stderr: "", timedOut: false }));
const mockRunUiTest = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, detail: "passed", steps: [] }));
const mockGithubCreateRepo = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, url: "https://github.com/u/r.git" }));
const mockGithubClone = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, dir: "/tmp/r" }));
const mockGithubCommit = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, hash: "abc" }));
const mockGithubPush = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const mockSedTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const mockLoadSkillTool = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, output: { skills: [] } }));
const mockCrawlSiteMap = vi.hoisted(() => vi.fn().mockResolvedValue({
  rootUrl: "https://example.com/",
  totalPages: 2,
  maxDepth: 1,
  pages: [
    { url: "https://example.com/", title: "Home", depth: 0, links: ["https://example.com/about"], status: 200 },
    { url: "https://example.com/about", title: "About", depth: 1, links: [], status: 200 },
  ],
  graph: { "https://example.com/": ["https://example.com/about"], "https://example.com/about": [] },
  parent: { "https://example.com/about": "https://example.com/" },
}));
const mockFormatSiteMap = vi.hoisted(() => vi.fn().mockReturnValue(
  "Site Map for: https://example.com/\nTotal pages: 2, Max depth: 1\n\nhttps://example.com/\n├── https://example.com/about\n\n--- Page Details ---\n  [200] https://example.com/\n    Title: Home\n\n  [200] https://example.com/about\n    Title: About\n"
));
const mockSearchIndex = vi.hoisted(() => vi.fn().mockReturnValue([{ relPath: "src/a.ts" }]));
const mockBuilder = vi.hoisted(() => () => ({
  entries: [{ relPath: "src/a.ts", size: 100 }],
  builtAt: "2020-01-01T00:00:00Z",
}));

vi.mock("./fs-tools.js", () => ({
  readFileTool: mockReadFileTool,
  writeFileTool: mockWriteFileTool,
  listDirTool: mockListDirTool,
  resolveInWorkspace: vi.fn((_: string, p: string) => "/root/" + p),
}));

vi.mock("./edit-tool.js", () => ({
  editFileTool: mockEditFileTool,
}));

vi.mock("./workspace-index.js", () => ({
  getOrBuildIndex: vi.fn().mockImplementation(() => Promise.resolve(mockBuilder())),
  buildIndex: vi.fn().mockImplementation(() => Promise.resolve(mockBuilder())),
  searchIndex: mockSearchIndex,
  toPosixPath: vi.fn((p: string) => p.replace(/\\/g, "/")),
}));

vi.mock("./globTool.js", () => ({
  globTool: mockGlobTool,
}));

vi.mock("./grepTool.js", () => ({
  grepTool: mockGrepTool,
}));

vi.mock("./apiTestTool.js", () => ({
  testApiEndpoint: mockTestApiEndpoint,
}));

vi.mock("./scheduleTool.js", () => ({
  scheduleCron: mockScheduleCron,
  scheduleOnce: mockScheduleOnce,
  listScheduled: mockListScheduled,
  removeScheduled: mockRemoveScheduled,
}));

vi.mock("./shell-tool.js", () => ({
  runCommandTool: mockRunCommandTool,
}));

vi.mock("./playwright-tool.js", () => ({
  runPlaywrightTool: vi.fn(),
  runUiTest: mockRunUiTest,
}));

vi.mock("./github-tool.js", () => ({
  githubCreateRepo: mockGithubCreateRepo,
  githubClone: mockGithubClone,
  githubCommit: mockGithubCommit,
  githubPush: mockGithubPush,
}));

vi.mock("./sed-tool.js", () => ({
  sedTool: mockSedTool,
}));

vi.mock("./load-skill-tool.js", () => ({
  loadSkillTool: mockLoadSkillTool,
}));

vi.mock("./siteCrawlerTool.js", () => ({
  crawlSiteMap: mockCrawlSiteMap,
  formatSiteMap: mockFormatSiteMap,
}));

vi.mock("../llm/client.js", () => ({
  LlmClient: class {
    complete = vi.fn();
  },
}));

// Re-import after mocks
import { dispatchTool, buildToolManifest, TOOL_MANIFEST } from "./tool-registry.js";

const ROOT = "/fake/workspace";

describe("tool-registry — comprehensive regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── TOOL_MANIFEST coverage ────────────────────────────────────────
  it("contains all expected tools", () => {
    const names = TOOL_MANIFEST.map((t) => t.name);
    expect(names).toContain("search_workspace");
    expect(names).toContain("glob");
    expect(names).toContain("grep");
    expect(names).toContain("read_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("reindex_workspace");
    expect(names).toContain("run_command");
    expect(names).toContain("ui_test");
    expect(names).toContain("api_test");
    expect(names).toContain("github_create_repo");
    expect(names).toContain("github_clone");
    expect(names).toContain("github_commit");
    expect(names).toContain("github_push");
    expect(names).toContain("sed_tool");
    expect(names).toContain("load_skill");
    expect(names).toContain("schedule");
    expect(names).toContain("site_crawler");
  });

  it("buildToolManifest never includes the removed record_lesson tool", () => {
    const m = buildToolManifest();
    expect(m.map((t) => t.name)).not.toContain("record_lesson");
  });

  it("buildToolManifest never includes the removed call_swarm tool", () => {
    const m = buildToolManifest();
    expect(m.map((t) => t.name)).not.toContain("call_swarm");
  });

  // ── Happy Path Dispatch Regression ───────────────────────────────

  it("search_workspace — dispatches to searchIndex", async () => {
    const r = await dispatchTool(ROOT, "search_workspace", { query: "auth" });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual([{ relPath: "src/a.ts" }]);
  });

  it("glob — dispatches to filesystem globTool", async () => {
    const r = await dispatchTool(ROOT, "glob", { pattern: "src/**/*.ts" });
    expect(r.ok).toBe(true);
    expect(mockGlobTool).toHaveBeenCalledWith("src/**/*.ts", ROOT);
    expect(r.output).toEqual({ ok: true, matches: ["file1.ts", "file2.ts"] });
  });

  it("grep — dispatches to filesystem grepTool", async () => {
    const r = await dispatchTool(ROOT, "grep", { pattern: "function" });
    expect(r.ok).toBe(true);
    expect(mockGrepTool).toHaveBeenCalledWith("function", "**/*", ROOT);
    expect(r.output).toEqual({ ok: true, matches: [{ file: "a.ts", line: 1, text: "match" }] });
  });

  it("grep — passes pathGlob", async () => {
    await dispatchTool(ROOT, "grep", { pattern: "function", pathGlob: "src/**/*.ts" });
    expect(mockGrepTool).toHaveBeenCalledWith("function", "src/**/*.ts", ROOT);
  });

  it("read_file — dispatches to readFileTool", async () => {
    await dispatchTool(ROOT, "read_file", { path: "src/auth.ts" });
    expect(mockReadFileTool).toHaveBeenCalledWith(ROOT, "src/auth.ts", { startLine: undefined, endLine: undefined });
  });

  it("edit_file — dispatches to editFileTool", async () => {
    await dispatchTool(ROOT, "edit_file", { path: "f.ts", old_str: "a", new_str: "b" });
    expect(mockEditFileTool).toHaveBeenCalledWith(ROOT, { path: "f.ts", old_str: "a", new_str: "b" }, undefined);
  });

  it("write_file — dispatches to writeFileTool", async () => {
    await dispatchTool(ROOT, "write_file", { path: "f.ts", content: "x" });
    expect(mockWriteFileTool).toHaveBeenCalledWith(ROOT, "f.ts", "x", undefined);
  });

  it("list_dir — dispatches to listDirTool", async () => {
    await dispatchTool(ROOT, "list_dir", { dir: "src" });
    expect(mockListDirTool).toHaveBeenCalled();
  });

  it("reindex_workspace — dispatches to buildIndex", async () => {
    const r = await dispatchTool(ROOT, "reindex_workspace", {});
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ fileCount: 1, builtAt: "2020-01-01T00:00:00Z" });
  });

  it("run_command — dispatches to runCommandTool (shell default)", async () => {
    await dispatchTool(ROOT, "run_command", { command: "echo hello" });
    expect(mockRunCommandTool).toHaveBeenCalledWith("echo hello", ROOT, undefined);
  });

  it("ui_test — dispatches to runUiTest", async () => {
    const r = await dispatchTool(ROOT, "ui_test", { kind: "ui", url: "https://example.com" });
    expect(r.ok).toBe(true);
    expect(mockRunUiTest).toHaveBeenCalled();
  });

  it("api_test — dispatches to testApiEndpoint", async () => {
    const r = await dispatchTool(ROOT, "api_test", { url: "https://example.com", method: "GET" });
    expect(r.ok).toBe(true);
    expect(mockTestApiEndpoint).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com", method: "GET" }));
  });

  it("github_create_repo — dispatches to githubCreateRepo", async () => {
    await dispatchTool(ROOT, "github_create_repo", { name: "my-repo" });
    expect(mockGithubCreateRepo).toHaveBeenCalled();
  });

  it("github_clone — dispatches to githubClone", async () => {
    await dispatchTool(ROOT, "github_clone", { url: "https://github.com/u/r.git", dir: "r" });
    expect(mockGithubClone).toHaveBeenCalled();
  });

  it("github_commit — dispatches to githubCommit", async () => {
    await dispatchTool(ROOT, "github_commit", { message: "fix: patch" });
    expect(mockGithubCommit).toHaveBeenCalled();
  });

  it("github_push — dispatches to githubPush", async () => {
    await dispatchTool(ROOT, "github_push", {});
    expect(mockGithubPush).toHaveBeenCalled();
  });

  it("sed_tool — dispatches to sedTool", async () => {
    await dispatchTool(ROOT, "sed_tool", {});
    expect(mockSedTool).toHaveBeenCalled();
  });

  it("load_skill — dispatches to loadSkillTool", async () => {
    await dispatchTool(ROOT, "load_skill", { role: "tester" });
    expect(mockLoadSkillTool).toHaveBeenCalled();
  });

  it("call_swarm — removed with the swarm agents; dispatch reports an unknown tool", async () => {
    const r = await dispatchTool(ROOT, "call_swarm", { goal: "test", protocol: "coder" });
    expect(r.ok).toBe(false);
  });

  it("record_lesson — removed with the SDLC stages; dispatch reports an unknown tool", async () => {
    const r = await dispatchTool(ROOT, "record_lesson", { source: "test", taskId: "t1", context: "ctx", lesson: "learned" });
    expect(r.ok).toBe(false);
  });

  // ── Schedule operation discriminator ──────────────────────────

  it("schedule create_cron — dispatches to scheduleCron", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "create_cron", id: "j1", cronExpr: "0 9 * * *", command: "npm test" });
    expect(r.ok).toBe(true);
    expect(mockScheduleCron).toHaveBeenCalledWith("j1", "0 9 * * *", "npm test");
  });

  it("schedule create_once — dispatches to scheduleOnce", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "create_once", delaySeconds: 60, command: "npm test" });
    expect(r.ok).toBe(true);
    expect(mockScheduleOnce).toHaveBeenCalledWith(60, "npm test");
  });

  it("schedule list — dispatches to listScheduled", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "list" });
    expect(r.ok).toBe(true);
    expect(mockListScheduled).toHaveBeenCalled();
  });

  it("schedule remove — dispatches to removeScheduled", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "remove", id: "j1" });
    expect(r.ok).toBe(true);
    expect(mockRemoveScheduled).toHaveBeenCalledWith("j1");
  });

  it("schedule unknown operation → error", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "bogus" });
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("unknown schedule operation");
  });

  it("schedule create_cron missing fields → error", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "create_cron" });
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("requires fields");
  });

  it("schedule create_once missing delaySeconds → error", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "create_once", command: "x" });
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("requires fields");
  });

  it("schedule remove missing id → error", async () => {
    const r = await dispatchTool(ROOT, "schedule", { operation: "remove" });
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("requires field");
  });

  // ── site_crawler Dispatch ──────────────────────────────────────

  it("site_crawler — dispatches with json format (default)", async () => {
    const r = await dispatchTool(ROOT, "site_crawler", { url: "https://example.com/" });
    expect(r.ok).toBe(true);
    expect(mockCrawlSiteMap).toHaveBeenCalledWith("https://example.com/", { maxPages: undefined, maxDepth: undefined });
    expect(r.output).toEqual({
      rootUrl: "https://example.com/",
      totalPages: 2,
      maxDepth: 1,
      pages: [
        { url: "https://example.com/", title: "Home", depth: 0, links: ["https://example.com/about"], status: 200 },
        { url: "https://example.com/about", title: "About", depth: 1, links: [], status: 200 },
      ],
      graph: { "https://example.com/": ["https://example.com/about"], "https://example.com/about": [] },
      parent: { "https://example.com/about": "https://example.com/" },
    });
  });

  it("site_crawler — dispatches with tree format", async () => {
    const r = await dispatchTool(ROOT, "site_crawler", { url: "https://example.com/", format: "tree" });
    expect(r.ok).toBe(true);
    expect(mockCrawlSiteMap).toHaveBeenCalledWith("https://example.com/", { maxPages: undefined, maxDepth: undefined });
    expect(mockFormatSiteMap).toHaveBeenCalled();
    expect(r.output).toContain("Site Map for: https://example.com/");
    expect(r.output).toContain("Total pages: 2, Max depth: 1");
  });

  it("site_crawler missing url → validation error", async () => {
    const r = await dispatchTool(ROOT, "site_crawler", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("url");
  });

  // ── Input Validation — Missing Required Fields ─────────────────

  it("search_workspace missing query → validation error", async () => {
    const r = await dispatchTool(ROOT, "search_workspace", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("query");
  });

  it("glob missing pattern → validation error", async () => {
    const r = await dispatchTool(ROOT, "glob", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("pattern");
  });

  it("grep missing pattern → validation error", async () => {
    const r = await dispatchTool(ROOT, "grep", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("pattern");
  });

  it("read_file missing path → validation error", async () => {
    const r = await dispatchTool(ROOT, "read_file", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("path");
  });

  it("edit_file missing old_str → validation error", async () => {
    const r = await dispatchTool(ROOT, "edit_file", { path: "f.ts" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("old_str");
  });

  it("write_file missing content → validation error", async () => {
    const r = await dispatchTool(ROOT, "write_file", { path: "f.ts" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("content");
  });

  it("list_dir missing dir → validation error", async () => {
    const r = await dispatchTool(ROOT, "list_dir", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("dir");
  });

  it("run_command missing command → validation error", async () => {
    const r = await dispatchTool(ROOT, "run_command", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("command");
  });

  it("ui_test missing url → validation error", async () => {
    const r = await dispatchTool(ROOT, "ui_test", { kind: "ui" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("url");
  });

  it("api_test missing url → validation error", async () => {
    const r = await dispatchTool(ROOT, "api_test", { method: "GET" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("url");
  });

  it("api_test missing method → validation error", async () => {
    const r = await dispatchTool(ROOT, "api_test", { url: "https://x.com" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("method");
  });

  it("github_create_repo missing name → validation error", async () => {
    const r = await dispatchTool(ROOT, "github_create_repo", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("name");
  });

  it("github_clone missing url → validation error", async () => {
    const r = await dispatchTool(ROOT, "github_clone", { dir: "r" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("url");
  });

  it("github_commit missing message → validation error", async () => {
    const r = await dispatchTool(ROOT, "github_commit", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("message");
  });

  it("schedule missing operation → validation error", async () => {
    const r = await dispatchTool(ROOT, "schedule", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("operation");
  });

  it("record_lesson is removed → unknown tool error, not a field violation", async () => {
    const r = await dispatchTool(ROOT, "record_lesson", {} as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("unknown tool");
  });

  it("call_swarm is removed → unknown tool error, not a field violation", async () => {
    const r = await dispatchTool(ROOT, "call_swarm", { protocol: "coder" } as any);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("unknown tool");
  });

  // ── Edge Cases ──────────────────────────────────────────────────

  it("unknown tool → error", async () => {
    const r = await dispatchTool(ROOT, "bogus_tool", {});
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("unknown tool");
  });

  it("null input for a tool with required fields → validation error", async () => {
    const r = await dispatchTool(ROOT, "read_file", null);
    expect(r.ok).toBe(false);
    expect((r.output as any).error).toContain("input object");
  });
});
