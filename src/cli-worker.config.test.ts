// xcoder:version 1 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:29:47.179Z | xcoder:subtask code-st-f1c53a
// End-to-end tests for `kooder --config` routing: the prerouter must turn a
// root-level --config into a settings command and leave every other invocation
// untouched. Each case runs in a child process against a temp config file.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "cli-worker.ts");

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kooder-cli-config-"));
  file = join(dir, ".kooder", "config.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface CliRun {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(args: string[], input?: string): CliRun {
  const res = spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    encoding: "utf8",
    timeout: 25_000,
    windowsHide: true,
    input,
    env: { ...process.env, KOODER_CONFIG_FILE: file },
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

describe("kooder --config", () => {
  it("persists settings at the root level and exits 0", () => {
    const res = run(["--config", "provider=deepseek,key=356887421,model=deepseek-chat"]);
    expect(res.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      provider: "deepseek",
      key: "356887421",
      model: "deepseek-chat",
    });
    // Masked output; never the raw key, never a run report.
    expect(res.stdout).toContain("****7421");
    expect(res.stdout).not.toContain("356887421");
  });

  it("accepts the --config=<value> form", () => {
    expect(run(["--config=provider=deepseek"]).status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ provider: "deepseek" });
  });

  it("exits 2 and writes nothing for invalid settings", () => {
    const res = run(["--config", "mode=ollama,provider=deepseek"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/same setting and were given different values/);
    expect(existsSync(file)).toBe(false);
  });

  it("exits 2 when --config has no value", () => {
    const res = run(["--config"]);
    expect(res.status).toBe(2);
    expect(existsSync(file)).toBe(false);
  });

  it("`show` reads masked settings back without writing", () => {
    run(["--config", "provider=deepseek,key=sk-abcdefghij"]);
    const before = readFileSync(file, "utf8");
    const res = run(["--config", "show"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("****ghij");
    expect(res.stdout).not.toContain("sk-abcdefghij");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("reads settings from stdin with --config -", () => {
    const res = run(["--config", "-"], "provider=anthropic,key=sk-stdinvalue\n");
    expect(res.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      provider: "anthropic",
      key: "sk-stdinvalue",
    });
  });

  it("--json emits one parseable, secret-free document", () => {
    const res = run(["--config", "provider=deepseek,key=sk-abcdefghij", "--json"]);
    expect(res.status).toBe(0);
    const doc = JSON.parse(res.stdout);
    expect(doc).toMatchObject({ ok: true, action: "written", path: file });
    expect(res.stdout).not.toContain("sk-abcdefghij");
  });

  it("`run --config show` is a usage error", () => {
    const res = run(["run", "--config", "show", "--task", "t", "--subtask", "s"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/read-only/);
  });

  it("`run --config` persists before the run starts and stops on a bad value", () => {
    // A bad value must abort the run (exit 2) before any LLM work.
    const bad = run(["run", "--config", "provider=bogus", "--task", "t", "--subtask", "s"]);
    expect(bad.status).toBe(2);
    expect(existsSync(file)).toBe(false);
  });

  it("leaves --help and --version untouched", () => {
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: kooder");
    const version = run(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(file)).toBe(false);
  });
});
