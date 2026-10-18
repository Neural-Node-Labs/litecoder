import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  loadFileVersions,
  incrementFileVersion,
} from "./file-version-store.js";
import type { HeaderMeta } from "./file-version-store.js";

/**
 * Test suite for FileVersionStore — the canonical per-file version counter
 * stored in .kooder/file-versions.json.
 *
 * Design contract:
 *  - loadFileVersions() returns an empty object when the file doesn't exist.
 *  - loadFileVersions() returns an empty object when the file is malformed JSON.
 *  - loadFileVersions() sanitises entries missing required fields.
 *  - incrementFileVersion() creates the file if it doesn't exist, sets version=1.
 *  - incrementFileVersion() bumps version by 1 on each call for the same file.
 *  - incrementFileVersion() handles backslash paths (normalises to POSIX).
 *  - incrementFileVersion() is independent across different files.
 */

async function tmpWorkspace(): Promise<string> {
  const dir = path.join(
    tmpdir(),
    `kooder-fvs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

describe("loadFileVersions", () => {
  let root: string;

  beforeEach(async () => {
    root = await tmpWorkspace();
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it("returns empty object when .kooder/file-versions.json does not exist", async () => {
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("returns empty object when file is empty", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(path.join(root, ".kooder", "file-versions.json"), "", "utf8");
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("returns empty object when file is malformed JSON", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      "not valid { json",
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("returns empty object when file contains a non-object (array)", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      "[]",
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("returns empty object when file contains a non-object (string)", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      '"just a string"',
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("returns empty object when file contains null", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      "null",
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("loads valid entries from the file", async () => {
    const data = {
      "src/app.ts": {
        version: 3,
        lastTask: "TASK-001",
        lastSubtask: "code-st-abc123",
        lastUpdated: "2026-01-23T10:00:00.000Z",
      },
      "README.md": {
        version: 1,
        lastTask: "TASK-001",
        lastSubtask: "document-st-xyz789",
        lastUpdated: "2026-01-23T11:00:00.000Z",
      },
    };
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      JSON.stringify(data),
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual(data);
  });

  it("sanitises entries missing version field", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      JSON.stringify({
        "src/bad.ts": {
          lastTask: "TASK-001",
          lastSubtask: "code-st-000",
        },
        "src/good.ts": {
          version: 1,
          lastTask: "TASK-001",
          lastSubtask: "code-st-111",
        },
      }),
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toHaveProperty("src/good.ts");
    expect(index).not.toHaveProperty("src/bad.ts");
  });

  it("sanitises entries missing lastTask field", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      JSON.stringify({
        "src/bad.ts": {
          version: 1,
          lastSubtask: "code-st-000",
        },
      }),
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("sanitises entries missing lastSubtask field", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      JSON.stringify({
        "src/bad.ts": {
          version: 1,
          lastTask: "TASK-001",
        },
      }),
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index).toEqual({});
  });

  it("fills missing lastUpdated with current timestamp", async () => {
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      JSON.stringify({
        "src/good.ts": {
          version: 5,
          lastTask: "TASK-001",
          lastSubtask: "code-st-222",
        },
      }),
      "utf8"
    );
    const index = await loadFileVersions(root);
    expect(index["src/good.ts"]).toBeDefined();
    expect(index["src/good.ts"].lastUpdated).toBeTruthy();
    expect(index["src/good.ts"].lastUpdated).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });
});

describe("incrementFileVersion", () => {
  let root: string;

  beforeEach(async () => {
    root = await tmpWorkspace();
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it("creates .kooder/file-versions.json with version=1 for a new file", async () => {
    const meta = await incrementFileVersion(
      root,
      "src/newfile.ts",
      "TASK-001",
      "code-st-abc"
    );

    expect(meta.version).toBe(1);
    expect(meta.taskId).toBe("TASK-001");
    expect(meta.subtaskId).toBe("code-st-abc");
    expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Verify the file was actually written
    const raw = await fs.readFile(
      path.join(root, ".kooder", "file-versions.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw);
    expect(parsed["src/newfile.ts"].version).toBe(1);
  });

  it("increments version for the same file on subsequent calls", async () => {
    const meta1 = await incrementFileVersion(
      root,
      "src/app.ts",
      "TASK-001",
      "code-st-aaa"
    );
    expect(meta1.version).toBe(1);

    const meta2 = await incrementFileVersion(
      root,
      "src/app.ts",
      "TASK-002",
      "fix-st-bbb"
    );
    expect(meta2.version).toBe(2);

    const meta3 = await incrementFileVersion(
      root,
      "src/app.ts",
      "TASK-003",
      "refactor-st-ccc"
    );
    expect(meta3.version).toBe(3);

    // Verify the stored state
    const index = await loadFileVersions(root);
    expect(index["src/app.ts"].version).toBe(3);
    expect(index["src/app.ts"].lastTask).toBe("TASK-003");
    expect(index["src/app.ts"].lastSubtask).toBe("refactor-st-ccc");
  });

  it("normalises backslash paths to POSIX", async () => {
    const meta = await incrementFileVersion(
      root,
      "src\\sub\\file.ts",
      "TASK-001",
      "code-st-win"
    );
    expect(meta.version).toBe(1);

    // The stored key should be POSIX-style
    const index = await loadFileVersions(root);
    expect(index["src/sub/file.ts"]).toBeDefined();
    expect(index["src\\sub\\file.ts"]).toBeUndefined();
  });

  it("tracks two different files independently", async () => {
    const metaA = await incrementFileVersion(
      root,
      "src/a.ts",
      "TASK-001",
      "code-st-a"
    );
    const metaB = await incrementFileVersion(
      root,
      "src/b.ts",
      "TASK-001",
      "code-st-b"
    );

    expect(metaA.version).toBe(1);
    expect(metaB.version).toBe(1);

    const metaA2 = await incrementFileVersion(
      root,
      "src/a.ts",
      "TASK-002",
      "code-st-a2"
    );
    expect(metaA2.version).toBe(2);

    // b version unchanged
    const index = await loadFileVersions(root);
    expect(index["src/a.ts"].version).toBe(2);
    expect(index["src/b.ts"].version).toBe(1);
  });

  it("returns a valid ISO 8601 timestamp", async () => {
    const meta = await incrementFileVersion(
      root,
      "src/timestamp-test.ts",
      "TASK-TS",
      "test-st-ts"
    );
    const date = new Date(meta.timestamp);
    expect(date.getTime()).toBeGreaterThan(0);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it("writes atomically (no .tmp file left behind)", async () => {
    await incrementFileVersion(
      root,
      "src/atomic.ts",
      "TASK-ATOMIC",
      "test-st-atomic"
    );

    const kooderDir = path.join(root, ".kooder");
    const files = await fs.readdir(kooderDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp"));
    expect(tmpFiles.length).toBe(0);
  });

  it("handles concurrent increments for same file sequentially", async () => {
    // Sequential promises for the same file should produce version 1, 2, 3
    const metas: HeaderMeta[] = [];
    for (let i = 0; i < 5; i++) {
      const meta = await incrementFileVersion(
        root,
        "src/concurrent.ts",
        `TASK-00${i}`,
        `subtask-${i}`
      );
      metas.push(meta);
    }

    expect(metas.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);

    const index = await loadFileVersions(root);
    expect(index["src/concurrent.ts"].version).toBe(5);
  });

  it("stores distinct lastUpdated for each increment", async () => {
    const meta1 = await incrementFileVersion(
      root,
      "src/timestamps.ts",
      "TASK-TS",
      "st-ts-1"
    );

    // Small delay to ensure distinct timestamp
    await new Promise((r) => setTimeout(r, 5));

    const meta2 = await incrementFileVersion(
      root,
      "src/timestamps.ts",
      "TASK-TS",
      "st-ts-2"
    );

    expect(meta2.timestamp).not.toBe(meta1.timestamp);
    expect(new Date(meta2.timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(meta1.timestamp).getTime()
    );
  });

  it("can increment a file that already had a version from disk", async () => {
    // Pre-populate the versions file with version 10
    await fs.mkdir(path.join(root, ".kooder"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".kooder", "file-versions.json"),
      JSON.stringify({
        "src/preexisting.ts": {
          version: 10,
          lastTask: "OLD-TASK",
          lastSubtask: "old-st",
          lastUpdated: "2025-01-01T00:00:00.000Z",
        },
      }),
      "utf8"
    );

    const meta = await incrementFileVersion(
      root,
      "src/preexisting.ts",
      "NEW-TASK",
      "new-st"
    );

    expect(meta.version).toBe(11);
    expect(meta.taskId).toBe("NEW-TASK");
    expect(meta.subtaskId).toBe("new-st");
  });

  it("loadFileVersions returns the data written by incrementFileVersion", async () => {
    await incrementFileVersion(root, "src/roundtrip.ts", "TASK-RT", "st-rt");
    await incrementFileVersion(root, "src/roundtrip.ts", "TASK-RT2", "st-rt2");

    const index = await loadFileVersions(root);
    expect(index["src/roundtrip.ts"].version).toBe(2);
    expect(index["src/roundtrip.ts"].lastTask).toBe("TASK-RT2");
    expect(index["src/roundtrip.ts"].lastSubtask).toBe("st-rt2");
  });
});
