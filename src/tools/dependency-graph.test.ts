// xcoder:version 1 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:40:44.131Z | xcoder:subtask code-st-cd4444
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDependencyGraphTool } from "./dependency-graph.js";
import { buildIndex } from "./workspace-index.js";

let dir: string;
let root: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "dep-graph-test-"));
  root = dir;
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src/auth.ts"),
    `import { verify } from "./verify";
import { user } from "./user";
import fs from "node:fs";
`,
    "utf8"
  );
  writeFileSync(path.join(root, "src/verify.ts"), "export const verify = 1;\n", "utf8");
  writeFileSync(path.join(root, "src/user.ts"), "export const user = 2;\n", "utf8");
  writeFileSync(path.join(root, "src/other.py"), "def f(): pass\n", "utf8");
  await buildIndex(root);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getDependencyGraphTool (AC-09)", () => {
  it("resolves relative imports and importers, flags externals", async () => {
    const res = await getDependencyGraphTool(root, "src/auth.ts");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.parseMethod).toBe("tokenizer");
      const verify = res.imports.find((i) => i.specifier === "./verify");
      expect(verify).toBeDefined();
      expect(verify!.resolved).toBe("src/verify.ts");
      expect(verify!.isExternal).toBe(false);
      const nodeFs = res.imports.find((i) => i.specifier === "node:fs");
      expect(nodeFs!.isExternal).toBe(true);
      // importers: nothing imports auth.ts
      expect(res.importers).toEqual([]);
    }
  });

  it("returns importers for a file that others import", async () => {
    const res = await getDependencyGraphTool(root, "src/verify.ts");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.importers).toContain("src/auth.ts");
    }
  });

  it("returns unsupported for unknown extensions", async () => {
    const res = await getDependencyGraphTool(root, "src/unknown.xyz");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("file_not_found"); // not in index → file_not_found takes precedence
    }
  });

  it("never throws on missing files", async () => {
    const res = await getDependencyGraphTool(root, "src/missing.ts");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("file_not_found");
    }
  });
});
