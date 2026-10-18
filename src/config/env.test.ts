// xcoder:version 2 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T12:59:51.873Z | xcoder:subtask code-st-b3a0c8
// Regression tests for defect0001: legacy aliases must resolve to the right
// name (whole-prefix replacement, not positional slicing). Extended for the
// three-tier KOODER_/KOOBER_/XCODER_ chain.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  deriveLegacyAliases,
  readKooderEnv,
  resetDeprecationWarnings,
  type KooderEnvKey,
} from "./env.js";

const ALL_KEYS: KooderEnvKey[] = [
  "KOODER_DIR",
  "KOODER_HOME",
  "KOODER_MODEL",
  "KOODER_CONFIG_FILE",
  "KOODER_DEBUG_CONFIG_PATH",
  "KOODER_EXTERNAL_SKILLS",
];

/** Every process.env name any test here may touch. */
const TOUCHED = ALL_KEYS.flatMap((k) => [k, ...deriveLegacyAliases(k).map((a) => a.key)]);

const saved = new Map<string, string | undefined>();
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const key of TOUCHED) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  resetDeprecationWarnings();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  resetDeprecationWarnings();
});

describe("deriveLegacyAliases", () => {
  it.each(ALL_KEYS)("derives exactly the two documented names for %s", (key) => {
    const aliases = deriveLegacyAliases(key);

    expect(aliases).toEqual([
      { key: key.replace(/^KOODER_/, "KOOBER_"), tier: "koober" },
      { key: key.replace(/^KOODER_/, "XCODER_"), tier: "xcoder" },
    ]);
    expect(aliases).toHaveLength(2);
  });

  it.each(ALL_KEYS)("never derives a nonsense XOOBER_/KOO- alias for %s", (key) => {
    for (const { key: alias } of deriveLegacyAliases(key)) {
      expect(alias).not.toMatch(/^XOOBER_/);
      expect(alias).not.toMatch(/^KOO(?!BER_|DER_)/);
      expect(alias).toMatch(/^(KOOBER|XCODER)_/);
    }
  });
});

describe("readKooderEnv", () => {
  it("honours XCODER_MODEL when nothing newer is set (defect0001)", () => {
    process.env.XCODER_MODEL = "deepseek-reasoner";

    expect(readKooderEnv("KOODER_MODEL")).toBe("deepseek-reasoner");
  });

  it("honours KOOBER_MODEL when KOODER_MODEL is unset", () => {
    process.env.KOOBER_MODEL = "koober-model";

    expect(readKooderEnv("KOODER_MODEL")).toBe("koober-model");
  });

  it("applies precedence KOODER > KOOBER > XCODER", () => {
    process.env.XCODER_MODEL = "tier-3";
    expect(readKooderEnv("KOODER_MODEL")).toBe("tier-3");

    resetDeprecationWarnings();
    process.env.KOOBER_MODEL = "tier-2";
    expect(readKooderEnv("KOODER_MODEL")).toBe("tier-2");

    resetDeprecationWarnings();
    process.env.KOODER_MODEL = "tier-1";
    expect(readKooderEnv("KOODER_MODEL")).toBe("tier-1");
  });

  it("emits exactly one notice naming the key the user actually set", () => {
    process.env.XCODER_MODEL = "deepseek-reasoner";

    readKooderEnv("KOODER_MODEL");
    readKooderEnv("KOODER_MODEL");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const notice = String(stderrSpy.mock.calls[0][0]);
    expect(notice).toContain("XCODER_MODEL");
    expect(notice).toContain("KOODER_MODEL");
    expect(notice).not.toContain("KOOBER_MODEL");
  });

  it("names KOOBER_* when that is the tier in use", () => {
    process.env.KOOBER_MODEL = "koober-model";

    readKooderEnv("KOODER_MODEL");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain("KOOBER_MODEL");
  });

  it("never leaks the configured value into the notice", () => {
    process.env.XCODER_MODEL = "super-secret-model-name";

    readKooderEnv("KOODER_MODEL");

    expect(String(stderrSpy.mock.calls[0][0])).not.toContain("super-secret-model-name");
  });

  it("prefers KOODER_* and does not warn", () => {
    process.env.KOODER_MODEL = "kooder-model";
    process.env.KOOBER_MODEL = "koober-model";
    process.env.XCODER_MODEL = "legacy-model";

    expect(readKooderEnv("KOODER_MODEL")).toBe("kooder-model");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it.each(ALL_KEYS)("resolves the XCODER alias for %s via prefix replacement", (key) => {
    const xcoder = deriveLegacyAliases(key)[1].key;
    process.env[xcoder] = "legacy-value";

    expect(readKooderEnv(key)).toBe("legacy-value");
  });

  it.each(ALL_KEYS)("resolves the KOOBER alias for %s", (key) => {
    const koober = deriveLegacyAliases(key)[0].key;
    process.env[koober] = "middle-value";

    expect(readKooderEnv(key)).toBe("middle-value");
  });

  it("never derives a nonsense XOOBER_* alias", () => {
    expect(process.env.XOOBER_MODEL).toBeUndefined();
    process.env.XOOBER_MODEL = "bogus";
    try {
      expect(readKooderEnv("KOODER_MODEL")).toBeUndefined();
    } finally {
      delete process.env.XOOBER_MODEL;
    }
  });

  it("treats an empty string as unset at all three tiers", () => {
    process.env.KOODER_MODEL = "";
    process.env.KOOBER_MODEL = "";
    process.env.XCODER_MODEL = "";

    expect(readKooderEnv("KOODER_MODEL")).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("falls through an empty modern tier to a populated legacy tier", () => {
    process.env.KOODER_MODEL = "";
    process.env.KOOBER_MODEL = "middle-value";

    expect(readKooderEnv("KOODER_MODEL")).toBe("middle-value");
  });
});
