// xcoder:version 2 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:29:04.487Z | xcoder:subtask code-st-39dbde
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateHandoffFiles } from "./handoff-generator.js";
import { writeHandoff } from "./gen-handoff-cli.js";
import { formatMatrix, DOCUMENT_TOOLS } from "./format-registry.js";
import { ROUNDTRIP_CASES, TOOL_SPECS, SOURCE_COMMIT } from "./handoff-content.js";

/**
 * Verifier for the porting handoff (design C15).
 *
 * These assertions are the drift and leak gates: the handoff must describe the
 * registry exactly, must contain no secret or host-specific path, and must be
 * reproducible byte-for-byte.
 */

let tmpRoot: string;
let files: Map<string, string>;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-"));
  files = generateHandoffFiles();
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("handoff completeness", () => {
  it("contains every file the contract promises", () => {
    const required = [
      "README.md",
      "VERSION.json",
      "TOOL-CONTRACT.md",
      "FORMAT-MATRIX.md",
      "FORMAT-MATRIX.json",
      "DEPENDENCIES.json",
      "PORTING-CHECKLIST.md",
      "schemas/common.result.json",
      "tests/roundtrip-cases.json",
      "reference-impl/NOTES.md",
    ];
    for (const name of required) expect(files.has(name), `missing ${name}`).toBe(true);
    for (const tool of DOCUMENT_TOOLS) {
      expect(files.has(`schemas/${tool}.tool.json`), `missing schema for ${tool}`).toBe(true);
    }
  });

  it("describes exactly the tools the registry knows about", () => {
    const registry = formatMatrix().map((entry) => entry.tool).sort();
    const documented = TOOL_SPECS.map((s) => s.tool).sort();
    expect(documented).toEqual(registry);
  });

  it("matches the registry's extensions and ops for every tool", () => {
    for (const entry of formatMatrix()) {
      const spec = TOOL_SPECS.find((s) => s.tool === entry.tool);
      expect(spec, `no spec for ${entry.tool}`).toBeDefined();
      expect(spec!.extensions).toEqual([...entry.extensions]);
      expect(spec!.ops).toEqual([...entry.ops]);
    }
  });

  it("pins the source commit in VERSION.json", () => {
    const version = JSON.parse(files.get("VERSION.json")!) as Record<string, unknown>;
    expect(version.sourceCommit).toBe(SOURCE_COMMIT);
    expect(String(version.handoffVersion)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(String(version.protocolVersion)).toMatch(/^\d+$/);
  });

  it("gives every tool at least one conformance case", () => {
    for (const tool of DOCUMENT_TOOLS) {
      expect(
        ROUNDTRIP_CASES.some((c) => c.tool === tool),
        `no round-trip case for ${tool}`
      ).toBe(true);
    }
  });

  it("parses every JSON file it emits", () => {
    for (const [name, content] of files) {
      if (!name.endsWith(".json")) continue;
      expect(() => JSON.parse(content), `${name} is not valid JSON`).not.toThrow();
    }
  });
});

describe("handoff leak prevention", () => {
  // The JSON Schema $schema identifier is the single permitted URL: it is a
  // specification namespace, not an endpoint anyone is asked to call.
  const ALLOWED_URL = "https://json-schema.org/draft/2020-12/schema";
  const FORBIDDEN: [RegExp, string][] = [
    [/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/, "Windows drive path"],
    [/(^|\s)\/(home|Users)\//, "absolute unix home path"],
    [/api[_-]?key/i, "api key reference"],
    [/secret[_-]?key/i, "secret key reference"],
    [/PRIVATE KEY/, "private key block"],
    [/Bearer\s+[A-Za-z0-9._-]{10,}/, "bearer token"],
  ];

  it("contains no secrets or host-specific paths", () => {
    for (const [name, content] of files) {
      for (const [pattern, label] of FORBIDDEN) {
        expect(pattern.test(content), `${name} contains a ${label}`).toBe(false);
      }
    }
  });

  it("contains no URL other than the JSON Schema namespace", () => {
    for (const [name, content] of files) {
      const urls = content.match(/https?:\/\/[^\s"'`)\]]+/g) ?? [];
      const offending = urls.filter((u) => u !== ALLOWED_URL);
      expect(offending, `${name} contains non-schema URLs: ${offending.join(", ")}`).toEqual([]);
    }
  });
});

describe("handoff determinism", () => {
  it("generates byte-identical output on consecutive runs", () => {
    const again = generateHandoffFiles();
    expect([...again.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [name, content] of files) expect(again.get(name)).toBe(content);
  });

  it("writes the tree to disk and re-running leaves it unchanged", async () => {
    const first = await writeHandoff(tmpRoot);
    const snapshot = new Map<string, string>();
    for (const rel of first.written) {
      snapshot.set(rel, await fs.readFile(path.join(tmpRoot, rel), "utf8"));
    }

    await writeHandoff(tmpRoot);
    for (const [rel, content] of snapshot) {
      expect(await fs.readFile(path.join(tmpRoot, rel), "utf8"), `${rel} drifted`).toBe(content);
    }
    expect(first.written.length).toBe(files.size);
  });
});
