// xcoder:version 5 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:45:58.916Z | xcoder:subtask code-st-cd4444
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitDiffTool, gitLogTool, applyUnifiedDiffTool } from "./git-tools.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "git-tools-test-"));
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(root: string): void {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
}

describe("git_diff / git_log (AC-08)", () => {
  it("not_a_git_repo typed error in a non-repo dir, never throws", async () => {
    const dir = tempDir();
    const res = await gitDiffTool(dir);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("not_a_git_repo");
    }
    const log = await gitLogTool(dir, { path: "src/a.ts" });
    expect(log.ok).toBe(false);
    if (!log.ok) {
      expect(log.code).toBe("not_a_git_repo");
    }
  });

  it("returns a summary with entries and hasDiff once something changes", async () => {
    const dir = tempDir();
    initRepo(dir);
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src/a.ts"), "a\nb\n", "utf8");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "first"]);
    writeFileSync(path.join(dir, "src/a.ts"), "a\nb\nc\n", "utf8");

    const res = await gitDiffTool(dir);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.hasDiff).toBe(true);
      expect(res.statsOnly).toBe(true);
      expect(res.summary.length).toBeGreaterThan(0);
    }

    const log = await gitLogTool(dir, { path: "src/a.ts", maxCount: 5 });
    expect(log.ok).toBe(true);
    if (log.ok) {
      expect(log.commits.length).toBe(1);
      expect(log.commits[0].subject).toBe("first");
      expect(log.commits[0].shortHash.length).toBe(7);
    }
  });
});

describe("applyUnifiedDiffTool (AC-12)", () => {
  it("applies a valid diff in a repo and reports hunks", async () => {
    const dir = tempDir();
    initRepo(dir);
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src/a.ts"), "one\ntwo\nthree\n", "utf8");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "base"]);

    const diff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 one
-two
+TWO
 three
+four
`;
    const res = await applyUnifiedDiffTool(dir, { path: "src/a.ts", diff });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.hunksApplied).toBe(1);
      expect(res.linesChanged).toBe(3);
      // Normalize line endings — git apply uses core.autocrlf on Windows.
      expect(readFileSync(path.join(dir, "src/a.ts"), "utf8").replace(/\r\n/g, "\n")).toBe("one\nTWO\nthree\nfour\n");
    }
  });

  it("diff_check_failed with checkOutput and ZERO writes on a bad diff", async () => {
    const dir = tempDir();
    initRepo(dir);
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src/a.ts"), "one\ntwo\n", "utf8");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "base"]);

    const before = readFileSync(path.join(dir, "src/a.ts"), "utf8");
    const badDiff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 one
-two
+NOPE
+EXTRA
`; // hunk context expects 3 lines, file has 2 — git apply --check must refuse
    const res = await applyUnifiedDiffTool(dir, { path: "src/a.ts", diff: badDiff });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("diff_check_failed");
      expect(res.checkOutput?.length).toBeGreaterThan(0);
      // Zero-write proof.
      expect(readFileSync(path.join(dir, "src/a.ts"), "utf8")).toBe(before);
    }
  });
});
