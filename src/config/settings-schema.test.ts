// xcoder:version 1 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:27:44.906Z | xcoder:subtask code-st-f1c53a
// Table-driven tests for the pure settings resolver: no fs, no env mutation.
import { describe, it, expect } from "vitest";
import { parseConfigArg } from "./user-config.js";
import { OLLAMA_BASE_URL, findShellShadows, resolveSettings } from "./settings-schema.js";

/** Convenience wrapper: resolve a raw arg exactly as the command does. */
function resolve(arg: string) {
  return resolveSettings(parseConfigArg(arg), arg);
}

function fieldMap(arg: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of resolve(arg).fields) out[f.field] = f.value;
  return out;
}

describe("resolveSettings", () => {
  it("parses the requested provider/key form", () => {
    expect(resolve("provider=deepseek,key=356887421").errors).toEqual([]);
    expect(fieldMap("provider=deepseek,key=356887421")).toEqual({
      provider: "deepseek",
      key: "356887421",
    });
  });

  it("treats `mode` as an alias of `provider`", () => {
    expect(fieldMap("mode=deepseek")).toEqual({ provider: "deepseek" });
    expect(fieldMap("mode=anthropic,model=claude-3")).toEqual({
      provider: "anthropic",
      model: "claude-3",
    });
  });

  it("expands ollama to openai-compatible plus an implied base_url", () => {
    const result = resolve("mode=ollama,model=llama3");
    expect(result.errors).toEqual([]);
    const baseUrl = result.fields.find((f) => f.field === "base_url");
    expect(baseUrl).toMatchObject({ value: OLLAMA_BASE_URL, implied: true });

    const provider = result.fields.find((f) => f.field === "provider");
    expect(provider).toMatchObject({ value: "openai-compatible" });
    expect(provider?.implied).toBeUndefined();
    // Never write a placeholder key to disk (the client substitutes it).
    expect(result.fields.some((f) => f.field === "key")).toBe(false);
  });

  it("keeps an explicit base_url instead of the ollama default", () => {
    const result = resolve("mode=ollama,base_url=http://gpu-box:11434/v1");
    const baseUrl = result.fields.find((f) => f.field === "base_url");
    expect(baseUrl?.value).toBe("http://gpu-box:11434/v1");
    expect(baseUrl?.implied).toBeUndefined();
  });

  it("warns about a missing ollama model instead of inventing one", () => {
    const result = resolve("mode=ollama");
    expect(result.fields.some((f) => f.field === "model")).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/without a model/);
  });

  it("rejects the request's literal mode=ollama,provider=deepseek combination", () => {
    const result = resolve("mode=ollama,provider=deepseek");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/same setting and were given different values/);
  });

  it("accepts an idempotent duplicate and rejects a differing one", () => {
    expect(resolve("mode=deepseek,provider=deepseek").errors).toEqual([]);
    expect(resolve("model=a,model=a").errors).toEqual([]);
    const dup = resolve("model=a,model=b");
    expect(dup.errors).toHaveLength(1);
    expect(dup.errors[0]).toMatch(/`model` was given two different values/);
  });

  it("never echoes a secret value in a conflicting-key error", () => {
    const result = resolve("key=sk-firstvalue123,key=sk-secondvalue456");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).not.toContain("firstvalue");
    expect(result.errors[0]).not.toContain("secondvalue");
  });

  it("carries lexical errors from parseConfigArg through unchanged", () => {
    expect(resolve("provider=nope").errors.join(" ")).toMatch(/unknown provider/);
    expect(resolve("base_url=ftp://x").errors.join(" ")).toMatch(/base_url must start with/);
    expect(resolve("PATH=/evil").errors.join(" ")).toMatch(/cannot be set from config/);
    expect(resolve("colour=red").errors.join(" ")).toMatch(/unknown setting/);
  });

  it("marks empty values as deletions", () => {
    expect(fieldMap("model=")).toEqual({ model: "" });
  });

  it("is order-independent for conflicts", () => {
    expect(resolve("provider=deepseek,mode=ollama").errors).toHaveLength(1);
  });

  it("warns when a secret arrives on the command line, without the value", () => {
    const result = resolve("provider=deepseek,key=sk-abcdefghijkl");
    const joined = result.warnings.join(" ");
    expect(joined).toMatch(/command line/);
    expect(joined).not.toContain("abcdefghijkl");
  });

  it("rejects an empty arg", () => {
    expect(resolve("").errors).toHaveLength(1);
  });
});

describe("findShellShadows", () => {
  it("reports env names already exported, and nothing when unset", () => {
    const fields = resolve("provider=deepseek,key=sk-x,model=m").fields;
    expect(findShellShadows(fields, {}, {})).toEqual([]);
    expect(findShellShadows(fields, {}, { DEEPSEEK_API_KEY: "x", KOODER_MODEL: "y" })).toEqual([
      "DEEPSEEK_API_KEY",
      "KOODER_MODEL",
    ]);
  });

  it("includes the provider-specific key and any explicit env vars", () => {
    const fields = resolve("provider=anthropic,key=k").fields;
    const shadows = findShellShadows(fields, { MY_VAR: "v" }, {
      ANTHROPIC_API_KEY: "a",
      MY_VAR: "b",
    });
    expect(shadows).toEqual(["ANTHROPIC_API_KEY", "MY_VAR"]);
  });

  it("ignores empty shell exports (they count as unset)", () => {
    const fields = resolve("key=k").fields;
    expect(findShellShadows(fields, {}, { KOODER_API_KEY: "" })).toEqual([]);
  });
});
