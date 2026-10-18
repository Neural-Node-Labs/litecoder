import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeFileTool } from "./fs-tools.js";
import { editFileTool } from "./edit-tool.js";
import { sedTool } from "./sed-tool.js";
import { loadFileVersions } from "../store/file-version-store.js";

/**
 * Integration test suite: end-to-end file header injection + version tracking + report generation.
 *
 * Design contract (from code-st-b64124):
 *  - writeFileTool, editFileTool, and sedTool inject xcoder version headers when ctx is provided.
 *  - Headers include xcoder:version, xcoder:task, xcoder:subtask, xcoder:updated fields.
 *  - .xcoder/file-versions.json tracks canonical per-file version counters.
 *  - summarize() renders _filesTouchedMeta in the final markdown report.
 *  - Files without comment syntax (JSON, binary) are skipped for header injection.
 */

// ─── Helpers ──────────────────────────────────────────────────────────

async function tmpRoot(): Promise<string> {
  const dir = path.join(
    tmpdir(),
    `xcoder-header-int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, ".xcoder"), { recursive: true });
  return dir;
}

async function cleanup(dir: string) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ─── write_file header injection ───────────────────────────────────────

describe("writeFileTool with header injection", () => {
  let root: string;

  beforeEach(async () => {
    root = await tmpRoot();
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it("injects xcoder version header into .ts files when context is provided", async () => {
    const content = "export const x = 1;\n";
    const result = await writeFileTool(root, "src/app.ts", content, {
      taskId: "TASK-001",
      subtaskId: "code-st-abc",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected write to succeed");

    const written = await fs.readFile(path.join(root, "src/app.ts"), "utf8");
// xcoder:version 3 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:33:31.039Z | xcoder:subtask code-st-1a0810
    expect(written).toContain("xcoder:task TASK-001");
    expect(written).toContain("xcoder:subtask code-st-abc");
    expect(written).toContain("export const x = 1;");
  });

  it("increments version on second write to the same file", async () => {
    const ctx = { taskId: "TASK-001", subtaskId: "code-st-abc" };

    await writeFileTool(root, "src/app.ts", "// first\n", ctx);
    const first = await fs.readFile(path.join(root, "src/app.ts"), "utf8");
    expect(first).toContain("xcoder:version 1");

    await writeFileTool(root, "src/app.ts", "// second\n", ctx);
    const second = await fs.readFile(path.join(root, "src/app.ts"), "utf8");
    expect(second).toContain("xcoder:version 2");
    expect(second).toContain("// second");
  });

  it("tracks different files independently", async () => {
    const ctx = { taskId: "TASK-001", subtaskId: "code-st-abc" };

    await writeFileTool(root, "src/a.ts", "// a\n", ctx);
    await writeFileTool(root, "src/b.ts", "// b\n", ctx);
    await writeFileTool(root, "src/a.ts", "// a v2\n", ctx);

    const a = await fs.readFile(path.join(root, "src/a.ts"), "utf8");
    const b = await fs.readFile(path.join(root, "src/b.ts"), "utf8");

    expect(a).toContain("xcoder:version 2");
    expect(b).toContain("xcoder:version 1");
  });

  it("does not inject headers when no context is provided", async () => {
    const content = "export const y = 2;\n";
    const result = await writeFileTool(root, "src/noctx.ts", content);

    expect(result.ok).toBe(true);
    const written = await fs.readFile(path.join(root, "src/noctx.ts"), "utf8");
    expect(written).toBe(content);
    expect(written).not.toContain("xcoder:version");
  });

  it("skips header injection for .json files (no comment syntax)", async () => {
    const ctx = { taskId: "TASK-001", subtaskId: "code-st-abc" };
    const content = JSON.stringify({ key: "value" }, null, 2);
    const result = await writeFileTool(root, "data.json", content, ctx);

    expect(result.ok).toBe(true);
    const written = await fs.readFile(path.join(root, "data.json"), "utf8");
    expect(written).not.toContain("xcoder:version");
    expect(written).toBe(content);
  });

  it("updates .xcoder/file-versions.json with canonical version data", async () => {
    const ctx = { taskId: "TASK-001", subtaskId: "code-st-abc" };
    await writeFileTool(root, "src/versioned.ts", "// content\n", ctx);

    const versions = await loadFileVersions(root);
    expect(versions).toHaveProperty("src/versioned.ts");
    expect(versions["src/versioned.ts"].version).toBe(1);
    expect(versions["src/versioned.ts"].lastTask).toBe("TASK-001");
    expect(versions["src/versioned.ts"].lastSubtask).toBe("code-st-abc");
  });
});

// ─── edit_file header injection ──────────────────────────────────────

describe("editFileTool with header injection", () => {
  let root: string;

  beforeEach(async () => {
    root = await tmpRoot();
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it("adds a xcoder version header to a .ts file on first edit with context", async () => {
    // First create the file without a header
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/edit.ts"), "const x = 1;\n", "utf8");

    const result = await editFileTool(
      root,
      { path: "src/edit.ts", old_str: "const x = 1;", new_str: "const x = 2;" },
      { taskId: "TASK-002", subtaskId: "code-st-def" }
    );

    expect(result.ok).toBe(true);
    const written = await fs.readFile(path.join(root, "src/edit.ts"), "utf8");
    expect(written).toContain("xcoder:version 1");
    expect(written).toContain("xcoder:task TASK-002");
    expect(written).toContain("xcoder:subtask code-st-def");
    expect(written).toContain("const x = 2;");
  });

  it("updates an existing xcoder version header on subsequent edits", async () => {
    const ctx = { taskId: "TASK-002", subtaskId: "code-st-def" };

    // First edit creates the header with version 1
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/edit2.ts"), "const a = 1;\n", "utf8");
    await editFileTool(root, { path: "src/edit2.ts", old_str: "const a = 1;", new_str: "const a = 2;" }, ctx);

    // Second edit should update header to version 2
    await editFileTool(root, { path: "src/edit2.ts", old_str: "const a = 2;", new_str: "const a = 3;" }, ctx);

    const written = await fs.readFile(path.join(root, "src/edit2.ts"), "utf8");
    expect(written).toContain("xcoder:version 2");
    expect(written).toContain("const a = 3;");
  });

  it("does not inject header when no context is provided", async () => {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/noctx-edit.ts"), "const z = 1;\n", "utf8");

    const result = await editFileTool(root, {
      path: "src/noctx-edit.ts",
      old_str: "const z = 1;",
      new_str: "const z = 2;",
    });

    expect(result.ok).toBe(true);
    const written = await fs.readFile(path.join(root, "src/noctx-edit.ts"), "utf8");
    expect(written).not.toContain("xcoder:version");
  });
});

// ─── sedTool header injection ────────────────────────────────────────

describe("sedTool with header injection", () => {
  let root: string;

  beforeEach(async () => {
    root = await tmpRoot();
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it("adds a xcoder version header to a .js file on sed with context", async () => {
    const filePath = "src/seded.js";
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, filePath), "let count = 0;\n", "utf8");

    const result = await sedTool(root, {
      path: filePath,
      operation: "substitute",
      pattern: "count = 0",
      replacement: "count = 1",
    }, { taskId: "TASK-003", subtaskId: "code-st-ghi" });

    expect(result.ok).toBe(true);
    const written = await fs.readFile(path.join(root, filePath), "utf8");
    expect(written).toContain("xcoder:version 1");
    expect(written).toContain("xcoder:task TASK-003");
    expect(written).toContain("xcoder:subtask code-st-ghi");
    expect(written).toContain("let count = 1;");
  });

  it("updates an existing header on subsequent sed operations", async () => {
    const filePath = "src/seded2.sh";
    const ctx = { taskId: "TASK-003", subtaskId: "code-st-ghi" };
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, filePath), "echo hello\n", "utf8");

    await sedTool(root, { path: filePath, operation: "substitute", pattern: "hello", replacement: "world" }, ctx);
    await sedTool(root, { path: filePath, operation: "substitute", pattern: "world", replacement: "universe" }, ctx);

    const written = await fs.readFile(path.join(root, filePath), "utf8");
    expect(written).toContain("xcoder:version 2");
    expect(written).toContain("# xcoder:");
    expect(written).toContain("echo universe");
  });

  it("does not inject header when no context is provided", async () => {
    const filePath = "src/seded-nocontext.txt";
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, filePath), "original\n", "utf8");

    const result = await sedTool(root, {
      path: filePath,
      operation: "substitute",
      pattern: "original",
      replacement: "modified",
    });

    expect(result.ok).toBe(true);
    const written = await fs.readFile(path.join(root, filePath), "utf8");
    expect(written).not.toContain("xcoder:version");
    expect(written).toContain("modified");
  });
});

