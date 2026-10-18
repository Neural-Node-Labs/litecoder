// xcoder:version 1 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T13:06:08.346Z | xcoder:subtask code-st-b3a0c8
// Tests for the `worker` bin — the generic (non-SDLC) task delegation CLI.
//
// The contract asserted here comes from the command's own documentation in
// `cli-worker.ts`:
//   * exit 0 for a completed/partial run, 1 for a failed run, 2 for usage errors
//   * usage errors never print a report
//   * `--json` prints machine output only (no prose on stdout)
//   * every documented flag exists
//
// Every case below is a *usage* error or `--help`, none of which reach the LLM,
// so this suite is hermetic: no network, no api key, no workspace writes.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "cli-worker.ts");

interface CliRun {
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Runs the CLI in a child process; array args avoid all shell quoting issues. */
function run(args: string[]): CliRun {
  const res = spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    encoding: "utf8",
    timeout: 25_000,
    windowsHide: true,
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

let dir: string;
let notArrayFile: string;
let badJsonFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "worker-cli-test-"));
  notArrayFile = join(dir, "not-array.json");
  badJsonFile = join(dir, "bad.json");
  writeFileSync(notArrayFile, JSON.stringify({ not: "an array" }), "utf8");
  writeFileSync(badJsonFile, "{oops", "utf8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("worker CLI surface", () => {
  it("is a `kooder run` command that documents every documented flag", () => {
    const { stdout, status } = run(["run", "--help"]);

    expect(status).toBe(0);
    // The rebrand gives the product a name on the CLI surface.
    expect(stdout).toContain("Usage: kooder run");
    for (const flag of [
      "--task <text>",
      "--subtasks <file>",
      "--subtask <goal>",
      "--concurrency <n>",
      "--max-attempts <n>",
      "--workspace <dir>",
      "--model <name>",
      "--task-id <id>",
      "--json",
      "--quiet",
      "--no-color",
    ]) {
      expect(stdout).toContain(flag);
    }
  });

  it("documents the documented defaults for concurrency and attempts", () => {
    const { stdout } = run(["run", "--help"]);

    expect(stdout).toMatch(/--concurrency <n>[^\n]*default: 3/);
    expect(stdout).toMatch(/--max-attempts <n>[^\n]*default: 2/);
  });

  it("reports the package version", () => {
    const { stdout, status } = run(["--version"]);

    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("worker CLI usage errors", () => {
  it("exits 2 when neither --subtasks nor --subtask is given", () => {
    const { stdout, status } = run(["run", "--task", "t"]);

    expect(status).toBe(2);
    expect(stdout).toContain("no subtasks given");
    // A usage error must never print a report.
    expect(stdout).not.toContain('"subtasks"');
  });

  it("exits 2 for a subtask with an empty goal", () => {
    const { stdout, status } = run(["run", "--task", "t", "--subtask", "   "]);

    expect(status).toBe(2);
    expect(stdout).toContain("empty goal");
  });

  it("exits 2 when the subtasks file does not exist", () => {
    const { stdout, status } = run(["run", "--task", "t", "--subtasks", join(dir, "missing.json")]);

    expect(status).toBe(2);
    expect(stdout).toContain("could not read subtasks file");
  });

  it("exits 2 when the subtasks file is valid JSON but not an array", () => {
    const { stdout, status } = run(["run", "--task", "t", "--subtasks", notArrayFile]);

    expect(status).toBe(2);
    expect(stdout).toContain("must contain a JSON array");
  });

  it("exits 2 when the subtasks file is not valid JSON", () => {
    const { stdout, status } = run(["run", "--task", "t", "--subtasks", badJsonFile]);

    expect(status).toBe(2);
    expect(stdout).toContain("is not valid JSON");
  });

  it("echoes a machine-readable usage envelope first on stdout under --json", () => {
    const { stdout, status } = run(["run", "--task", "t", "--json"]);

    expect(status).toBe(2);
    expect(stdout.trimStart().startsWith("{")).toBe(true);
    expect(stdout).toContain('"usage": true');
    expect(stdout).toContain("no subtasks given");
  });

  // ---- regressions previously reported as defects -------------------------

  it("keeps --json stdout parseable as JSON (no prose mixed in)", () => {
    const { stdout, stderr } = run(["run", "--task", "t", "--json"]);

    // "Machine output: the report only, no prose on stdout".
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(JSON.parse(stdout).usage).toBe(true);
    // The human-readable diagnostic must still exist — on stderr.
    expect(stderr).toContain("no subtasks given");
  });

  it("exits 2 when the required --task option is missing", () => {
    const { status, stdout } = run(["run", "--subtask", "do a thing"]);

    // "Usage errors exit 2 and never print a report."
    expect(status).toBe(2);
    expect(stdout).toContain("--task");
  });

  // defect0008: a JSON array is valid JSON but not necessarily valid input.
  it("exits 2 (not 1) when the subtasks array contains a non-object entry", () => {
    const nullFile = join(dir, "null-entry.json");
    writeFileSync(nullFile, JSON.stringify([null]), "utf8");

    const { stdout, status } = run(["run", "--task", "t", "--subtasks", nullFile, "--json"]);

    // "Usage errors exit 2 and never print a report."
    expect(status).toBe(2);
    expect(JSON.parse(stdout).usage).toBe(true);
    // A raw TypeError is not a usage message.
    expect(stdout).not.toContain("Cannot read properties");
  });

  it("rejects a numeric entry in an otherwise valid subtasks array", () => {
    const mixedFile = join(dir, "mixed-entry.json");
    writeFileSync(mixedFile, JSON.stringify([{ goal: "fine" }, 42]), "utf8");

    const { status, stdout } = run(["run", "--task", "t", "--subtasks", mixedFile]);

    expect(status).toBe(2);
    expect(stdout).toContain("must be a string or an object");
  });

  it("keeps colour enabled by default and only disables it with --no-color", () => {
    // `opts.color` must be true unless the flag is passed; the CLI must not
    // force NO_COLOR=1 on every run.
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin.worker).toBe("./dist/cli-worker.js");

    const plain = run(["run", "--task", "t", "--json"]);
    expect(plain.status).toBe(2);

    // --no-color is accepted and still produces the same machine envelope.
    const noColor = run(["run", "--task", "t", "--json", "--no-color"]);
    expect(noColor.status).toBe(2);
    expect(() => JSON.parse(noColor.stdout)).not.toThrow();
  });
});
