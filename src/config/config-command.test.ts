// xcoder:version 5 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:29:11.351Z | xcoder:subtask code-st-f1c53a
// Contract tests for `kooder --config`: exit codes, all-or-nothing writes,
// secret-free output. Uses a temp KOODER_CONFIG_FILE so no real HOME is touched.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { runConfigCommand, type ConfigCommandResult } from "./config-command.js";
import { readUserConfig, resetUserConfigCache } from "./user-config.js";

/**
 * Mirrors user-config.ts's own frozen set: a variable exported when the
 * process started always wins over config.json, so a test must never assume it
 * can overwrite one the developer's shell already exports.
 */
const shellAtStart = new Set(Object.keys(process.env));

let dir: string;
let file: string;
let prev: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kooder-config-cmd-"));
  file = path.join(dir, ".kooder", "config.json");
  prev = process.env.KOODER_CONFIG_FILE;
  process.env.KOODER_CONFIG_FILE = file;
  resetUserConfigCache();
  delete process.env.KOODER_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.KOODER_MODEL;
  delete process.env.KOODER_BASE_URL;
});

afterEach(() => {
  if (prev === undefined) delete process.env.KOODER_CONFIG_FILE;
  else process.env.KOODER_CONFIG_FILE = prev;
  resetUserConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Collects writes so the command's output is assertable. */
function sink(): { stream: Writable; text: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += String(chunk);
      cb();
    },
  });
  return { stream, text: () => buf };
}

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(
  arg: string,
  json = false,
  quiet = true,
  env: NodeJS.ProcessEnv = {},
): Promise<Run> {
  const out = sink();
  const err = sink();
  const code = await runConfigCommand({
    arg,
    json,
    quiet,
    out: out.stream,
    err: err.stream,
    env,
  });
  return { code, out: out.text(), err: err.text() };
}

describe("runConfigCommand — persistence", () => {
  it("writes the requested provider/key and exits 0", async () => {
    const res = await run("provider=deepseek,key=356887421,model=deepseek-chat");
    expect(res.code).toBe(0);
    expect(readUserConfig()).toEqual({
      provider: "deepseek",
      key: "356887421",
      model: "deepseek-chat",
    });
    expect(res.out).toContain("provider = deepseek");
    expect(res.out).toContain("model    = deepseek-chat");
    // The secret is masked on every surface.
    expect(res.out).toContain("****7421");
    expect(res.out).not.toContain("356887421");
  });

  it("creates the file owner-only and the directory private", async () => {
    await run("provider=deepseek");
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
  });

  it("merges into an existing file instead of replacing it", async () => {
    await run("provider=deepseek");
    await run("model=deepseek-chat");
    expect(readUserConfig()).toEqual({ provider: "deepseek", model: "deepseek-chat" });
  });

  it("deletes a field with an empty value", async () => {
    await run("provider=deepseek,model=m");
    expect((await run("model=")).code).toBe(0);
    expect(readUserConfig()).toEqual({ provider: "deepseek" });
  });

  it("persists UPPER_CASE env settings", async () => {
    expect((await run("provider=deepseek,KOODER_MODEL=deepseek-chat")).code).toBe(0);
    expect(readUserConfig().env).toEqual({ KOODER_MODEL: "deepseek-chat" });
  });

  it("expands mode=ollama to an openai-compatible endpoint", async () => {
    expect((await run("mode=ollama,model=llama3")).code).toBe(0);
    expect(readUserConfig()).toEqual({
      provider: "openai-compatible",
      model: "llama3",
      base_url: "http://localhost:11434/v1",
    });
  });

  it("applies the values in-process so an attached run sees them", async () => {
    await run("provider=deepseek,key=sk-abcdefghij");
    expect(process.env.KOODER_API_KEY).toBe("sk-abcdefghij");
    // Frozen precedence: a name exported in the shell when the process started
    // is never overwritten from config.json, so only assert that path when the
    // test runner itself did not export it.
    if (!shellAtStart.has("DEEPSEEK_API_KEY")) {
      expect(process.env.DEEPSEEK_API_KEY).toBe("sk-abcdefghij");
    }
  });
});

describe("runConfigCommand — validation is all-or-nothing", () => {
  it("exits 2 and writes nothing for the contradictory mode/provider pair", async () => {
    const res = await run("mode=ollama,provider=deepseek");
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/same setting and were given different values/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("leaves an existing file byte-identical when a later token is invalid", async () => {
    await run("provider=deepseek,key=sk-keepme");
    const before = fs.readFileSync(file, "utf8");
    const res = await run("model=new-model,provider=bogus");
    expect(res.code).toBe(2);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("rejects blocked env names and non-http base urls", async () => {
    expect((await run("PATH=/evil")).code).toBe(2);
    expect((await run("base_url=ftp://x")).code).toBe(2);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("exits 1 and refuses to clobber a corrupt config.json", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json", "utf8");
    const res = await run("provider=deepseek");
    expect(res.code).toBe(1);
    expect(res.err).toMatch(/could not write/);
    expect(fs.readFileSync(file, "utf8")).toBe("{not json");
  });
});

describe("runConfigCommand — show and --json", () => {
  it("`show` prints masked settings and writes nothing", async () => {
    await run("provider=deepseek,key=sk-abcdefghij");
    const before = fs.readFileSync(file, "utf8");
    const res = await run("show");
    expect(res.code).toBe(0);
    expect(res.out).toContain("provider = deepseek");
    expect(res.out).toContain("****ghij");
    expect(res.out).not.toContain("sk-abcdefghij");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("`show` on a missing file reports an empty config and exits 0", async () => {
    const res = await run("show");
    expect(res.code).toBe(0);
    expect(res.out).toContain("(empty)");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("--json emits one parseable document that leaks no secret", async () => {
    const res = await run("provider=deepseek,key=sk-abcdefghij", true);
    expect(res.code).toBe(0);
    const doc = JSON.parse(res.out) as ConfigCommandResult;
    expect(doc.ok).toBe(true);
    expect(doc.action).toBe("written");
    expect(doc.path).toBe(file);
    expect(doc.shadowed).toEqual([]);
    expect(doc.errors).toEqual([]);
    expect(doc.effective.join("\n")).toContain("****ghij");
    expect(res.out).not.toContain("sk-abcdefghij");
  });

  it("--json on failure reports the error with ok:false and exit 2", async () => {
    const res = await run("provider=nope", true);
    expect(res.code).toBe(2);
    const doc = JSON.parse(res.out) as ConfigCommandResult;
    expect(doc.ok).toBe(false);
    expect(doc.errors.join(" ")).toMatch(/unknown provider/);
  });

  it("warns (on stderr) about shadowing shell exports without echoing values", async () => {
    const res = await run("provider=deepseek,key=sk-abcdefghij", false, false, {
      KOODER_API_KEY: "shell-secret",
    });
    expect(res.code).toBe(0);
    expect(res.err).toContain("KOODER_API_KEY");
    expect(res.err).not.toContain("shell-secret");
  });

  it("--quiet suppresses the shadow notice", async () => {
    const res = await run("provider=deepseek,key=sk-abcdefghij", false, true, {
      KOODER_API_KEY: "shell-secret",
    });
    expect(res.code).toBe(0);
    expect(res.err).toBe("");
  });
});
