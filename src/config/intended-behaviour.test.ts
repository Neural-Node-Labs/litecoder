// xcoder:version 6 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:33:41.951Z | xcoder:subtask test-st-a79890
import { describe, it, expect } from "vitest";
import { parseConfigArg } from "./user-config.js";
import { resolveSettings } from "./settings-schema.js";

function resolve(arg: string) {
  return resolveSettings(parseConfigArg(arg), arg);
}

function fieldMap(arg: string) {
  const out: Record<string, string> = {};
  for (const f of resolve(arg).fields) out[f.field] = f.value;
  return out;
}

describe("intended: kooder --config persist", () => {
  it("persists key=2222 verbatim", () => {
    expect(resolve("key=2222").errors).toEqual([]);
    expect(fieldMap("key=2222")).toEqual({ key: "2222" });
  });
});

describe("intended: ollama expansion", () => {
  it("expands mode=ollama to openai-compatible plus local base_url", () => {
    const r = resolve("mode=ollama,key=2222,model=llama3");
    expect(r.errors).toEqual([]);
    expect(fieldMap("mode=ollama,key=2222,model=llama3")).toEqual({
      provider: "openai-compatible",
      key: "2222",
      model: "llama3",
      base_url: "http://localhost:11434/v1",
    });
  });
});

describe("intended: conflicts are refused safely", () => {
  it("rejects the literal mode=ollama,provider=deepseek pair", () => {
    const r = resolve("mode=ollama,key=2222,provider=deepseek");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/same setting and were given different values/);
  });

  it("never echoes a secret value in a conflicting-key error", () => {
    const r = resolve("key=2222,key=3333");
    expect(r.errors).toHaveLength(1);
    const message = r.errors.join(" ");
    expect(message).toMatch(/two different values/);
    expect(message).not.toContain("2222");
    expect(message).not.toContain("3333");
  });
});

describe("intended: idempotent repeats and home path", () => {
  it("treats the same value given twice as one setting", () => {
    expect(resolve("mode=deepseek,provider=deepseek").errors).toEqual([]);
    expect(fieldMap("mode=deepseek,provider=deepseek")).toEqual({ provider: "deepseek" });
  });

  it("defaults the config file to <home>/.kooder/config.json", async () => {
    const { userConfigPath } = await import("./user-config.js");
    const osmod = await import("node:os");
    const p = await import("node:path");
    const saved = process.env.KOODER_CONFIG_FILE;
    delete process.env.KOODER_CONFIG_FILE;
    try {
      expect(userConfigPath()).toBe(p.join(osmod.homedir(), ".kooder", "config.json"));
    } finally {
      if (saved !== undefined) process.env.KOODER_CONFIG_FILE = saved;
    }
  });
});

// END
