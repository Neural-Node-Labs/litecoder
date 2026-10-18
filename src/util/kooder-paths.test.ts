// xcoder:version 1 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T12:59:44.791Z | xcoder:subtask code-st-b3a0c8
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  kooderBaseName,
  resolveStateDir,
  createKooderPaths,
  resetStateDirNotices,
  DEFAULT_KOODER_DIR,
  LEGACY_KOOBER_DIR,
  LEGACY_XCODER_DIR,
} from "./kooder-paths.js";
import { resetDeprecationWarnings } from "../config/env.js";

const ENV_KEYS = ["KOODER_DIR", "KOOBER_DIR", "XCODER_DIR"] as const;
const saved = new Map<string, string | undefined>();
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  resetDeprecationWarnings();
  resetStateDirNotices();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("kooderBaseName", () => {
  it("defaults to .kooder when no env var is set", () => {
    expect(kooderBaseName()).toBe(DEFAULT_KOODER_DIR);
    expect(DEFAULT_KOODER_DIR).toBe(".kooder");
  });

  it("honours KOODER_DIR", () => {
    process.env.KOODER_DIR = ".myproject";
    expect(kooderBaseName()).toBe(".myproject");
  });

  it("KOODER_DIR wins over both deprecated aliases", () => {
    process.env.KOODER_DIR = ".modern";
    process.env.KOOBER_DIR = ".middle";
    process.env.XCODER_DIR = ".legacy";
    expect(kooderBaseName()).toBe(".modern");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("KOOBER_DIR wins over XCODER_DIR and warns once", () => {
    process.env.KOOBER_DIR = ".middle";
    process.env.XCODER_DIR = ".legacy";
    expect(kooderBaseName()).toBe(".middle");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain("KOOBER_DIR");
  });

  it("still accepts XCODER_DIR as a deprecated alias", () => {
    process.env.XCODER_DIR = ".legacy";
    expect(kooderBaseName()).toBe(".legacy");
    expect(String(stderrSpy.mock.calls[0][0])).toContain("XCODER_DIR");
  });
});

describe("resolveStateDir — normative precedence table", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kooder-paths-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("row 1: an explicit KOODER_DIR is an override, used verbatim", () => {
    const abs = path.join(tmpDir, "absolute-state");
    process.env.KOODER_DIR = abs;

    const resolved = resolveStateDir("/somewhere/else");

    expect(resolved).toEqual({ path: abs, tier: "override", legacy: false });
  });

  it("row 1: an override is never second-guessed even when .kooder exists", () => {
    fs.mkdirSync(path.join(tmpDir, ".kooder"));
    process.env.KOODER_DIR = ".explicit";

    const resolved = resolveStateDir(tmpDir);

    expect(resolved.path).toBe(path.resolve(tmpDir, ".explicit"));
    expect(resolved.tier).toBe("override");
  });

  it("row 2: an existing .kooder wins", () => {
    fs.mkdirSync(path.join(tmpDir, ".kooder"));
    fs.mkdirSync(path.join(tmpDir, ".koober"));
    fs.mkdirSync(path.join(tmpDir, ".xcoder"));

    expect(resolveStateDir(tmpDir)).toEqual({
      path: path.resolve(tmpDir, ".kooder"),
      tier: "kooder",
      legacy: false,
    });
  });

  it("row 3: falls back to .koober with a one-time notice naming the directory only", () => {
    fs.mkdirSync(path.join(tmpDir, ".koober"));

    const resolved = resolveStateDir(tmpDir);

    expect(resolved).toEqual({
      path: path.resolve(tmpDir, ".koober"),
      tier: "koober",
      legacy: true,
    });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const notice = String(stderrSpy.mock.calls[0][0]);
    expect(notice).toContain(".koober");
    // Notice hygiene: never the absolute path, never a home-directory layout.
    expect(notice).not.toContain(tmpDir);

    // Second resolution does not repeat the notice.
    resolveStateDir(tmpDir);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("row 4: falls back to .xcoder when .kooder and .koober are absent", () => {
    fs.mkdirSync(path.join(tmpDir, ".xcoder"));

    expect(resolveStateDir(tmpDir)).toEqual({
      path: path.resolve(tmpDir, ".xcoder"),
      tier: "xcoder",
      legacy: true,
    });
    expect(String(stderrSpy.mock.calls[0][0])).toContain(LEGACY_XCODER_DIR);
  });

  it("row 3 beats row 4: .koober wins over .xcoder", () => {
    fs.mkdirSync(path.join(tmpDir, ".koober"));
    fs.mkdirSync(path.join(tmpDir, ".xcoder"));

    expect(resolveStateDir(tmpDir).path).toBe(path.resolve(tmpDir, LEGACY_KOOBER_DIR));
  });

  it("row 5: a fresh workspace resolves to .kooder and emits no notice", () => {
    expect(resolveStateDir(tmpDir)).toEqual({
      path: path.resolve(tmpDir, ".kooder"),
      tier: "kooder",
      legacy: false,
    });
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("createKooderPaths", () => {
  let tmpDir: string;
  let root: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kooder-paths-"));
    root = path.resolve(tmpDir, ".kooder");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exposes the state root and its tier", () => {
    const p = createKooderPaths(tmpDir);
    expect(p.root).toBe(root);
    expect(p.tier).toBe("kooder");
  });

  it("builds task paths under the state root", () => {
    const p = createKooderPaths(tmpDir);
    expect(p.tasksDir()).toBe(path.join(root, "tasks"));
    expect(p.taskFile("t-1")).toBe(path.join(root, "tasks", "t-1.json"));
    expect(p.taskProgressFile("t-1")).toBe(path.join(root, "tasks", "t-1.md"));
  });

  it("builds config, log, screenshot and db paths under the state root", () => {
    const p = createKooderPaths(tmpDir);
    expect(p.configDir()).toBe(path.join(root, "config"));
    expect(p.llmConfigPath()).toBe(path.join(root, "config", "llm.yaml"));
    expect(p.logsDir("t-1")).toBe(path.join(root, "logs", "t-1"));
    expect(p.screenshotsDir()).toBe(path.join(root, "screenshots"));
    expect(p.outputDbPath()).toBe(path.join(root, "output.db"));
  });

  it("reads and writes through the same resolved legacy root (no split-brain)", () => {
    fs.mkdirSync(path.join(tmpDir, ".koober"));
    const p = createKooderPaths(tmpDir);

    expect(p.root).toBe(path.resolve(tmpDir, ".koober"));
    expect(p.tier).toBe("koober");
    expect(p.taskFile("t-1")).toBe(path.join(path.resolve(tmpDir, ".koober"), "tasks", "t-1.json"));
  });
});
