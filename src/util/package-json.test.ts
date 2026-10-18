// xcoder:version 1 | xcoder:task task-a616bd | xcoder:updated 2026-08-05T07:29:58.208Z | xcoder:subtask test-st-a0969d
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readPackageJsonContext } from "./package-json.js";

function tmpRoot(): string {
  return path.join(
    os.tmpdir(),
    `xcoder-pkg-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

describe("readPackageJsonContext", () => {
  let root: string;

  beforeEach(async () => {
    root = tmpRoot();
    await fs.mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns null when package.json does not exist", async () => {
    const result = await readPackageJsonContext(root);
    expect(result).toBeNull();
  });

  it("returns null when package.json is empty", async () => {
    await fs.writeFile(path.join(root, "package.json"), "");
    const result = await readPackageJsonContext(root);
    expect(result).toBeNull();
  });

  it("returns null when package.json is invalid JSON", async () => {
    await fs.writeFile(path.join(root, "package.json"), "not-json");
    const result = await readPackageJsonContext(root);
    expect(result).toBeNull();
  });

  it("returns null when package.json contains only whitespace", async () => {
    await fs.writeFile(path.join(root, "package.json"), "   \n\t  ");
    const result = await readPackageJsonContext(root);
    expect(result).toBeNull();
  });

  it("returns a string with the package name", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!).toContain("test-pkg");
    expect(result!).toContain("1.0.0");
  });

  it("includes scripts section when present", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "my-app",
        scripts: { build: "tsc", test: "vitest" },
      })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!).toContain("build");
    expect(result!).toContain("tsc");
    expect(result!).toContain("test");
    expect(result!).toContain("vitest");
  });

  it("shows (not set) for missing name and version", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({})
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!).toContain("(not set)");
  });

  it("includes dependencies", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "dep-test",
        dependencies: { lodash: "^4.0.0" },
        devDependencies: { vitest: "^1.0.0" },
      })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    // Both dependencies and devDependencies should appear in the merged list
    expect(result!).toContain("lodash");
    expect(result!).toContain("vitest");
  });

  it("handles empty scripts gracefully", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "no-scripts", scripts: {} })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!).toContain("scripts");
  });

  it("returns a trimmed string (no leading/trailing whitespace)", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "trim-test" })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe(result!);
    expect(result!.startsWith("\n")).toBe(false);
    expect(result!.endsWith("\n")).toBe(false);
  });

  it("describes the project even without name", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ description: "A test project" })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!).toContain("A test project");
  });

  it("does not throw when the file is a directory (caught by try/catch)", async () => {
    // Create a directory named package.json (edge case)
    await fs.mkdir(path.join(root, "package.json"));
    const result = await readPackageJsonContext(root);
    expect(result).toBeNull();
  });

  it("handles large package.json with many dependencies", async () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      deps[`dep-${i}`] = `^${i}.0.0`;
    }
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "big", dependencies: deps })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    expect(result!).toContain("dep-0");
    expect(result!).toContain("dep-99");
  });

  it("uses correct stack (node:) info in the prompt", async () => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "xcoder-test",
        scripts: { build: "npm run build", test: "npm test", typecheck: "npm run typecheck" },
      })
    );
    const result = await readPackageJsonContext(root);
    expect(result).not.toBeNull();
    // Should contain the section headers
    expect(result!).toContain("Project package.json");
    expect(result!).toContain("scripts");
  });
});
