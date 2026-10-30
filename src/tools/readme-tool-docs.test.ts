// xcoder:version 2 | xcoder:task task-5f5358 | xcoder:updated 2026-10-30T18:12:53.409Z | xcoder:subtask code-st-a3d341
// Drift check for the README "CLI Agent Tools" section.
//
// The section is hand-authored prose (no generator), so the only thing keeping
// it honest is this test running in the default `npm test`. It derives every
// expected set from the real source of truth and compares it BOTH ways with the
// backticked tool rows in README.md:
//
//   litecoder -> NO_TOOLS            (src/litecoder/no-tools.ts)      -> 0 tools
//   kooder    -> TOOL_MANIFEST       (src/tools/tool-registry.ts)    -> 38 tools
//   worker    -> alias of kooder     (same dist/cli-worker.js)
//   sentinel  -> interface Firewall  (src/sentinel/system-tools.ts)   -> 3 tools
//
// Fail-closed by construction: a missing section, a missing subsection or an
// interface that cannot be located throws. No parse miss can yield an empty
// expectation set and a green run.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

import { TOOL_MANIFEST } from "./tool-registry.js";
import { DOCUMENT_TOOLS } from "./document/format-registry.js";
import { NO_TOOLS } from "../litecoder/no-tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const README = fs.readFileSync(path.join(root, "README.md"), "utf8");
const PKG = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

// ── C4: bins <-> agents <-> tool source, encoded exactly once ─────────

type AgentId = "litecoder" | "kooder" | "sentinel";

const BIN_TO_AGENT: Readonly<Record<string, AgentId>> = Object.freeze({
  litecoder: "litecoder",
  kooder: "kooder",
  // `worker` ships the very same file as `kooder`; documenting it twice would
  // create two sets to keep in sync. The alias lives here and nowhere else.
  worker: "kooder",
  sentinel: "sentinel",
});

function agentForBin(bin: string): AgentId | undefined {
  return BIN_TO_AGENT[bin];
}

// ── C1: README parsing (the heading/table grammar is the contract) ────

interface AgentSection {
  bins: string[];
  countClaim: number;
  tools: ReadonlySet<string>;
}

type ReadmeTools = Record<AgentId, AgentSection>;

const SECTION_HEADING = "## CLI Agent Tools";
const SUBSECTIONS: ReadonlyArray<{ agent: AgentId; prefix: string }> = [
  { agent: "litecoder", prefix: "### litecoder" },
  { agent: "kooder", prefix: "### kooder" },
  { agent: "sentinel", prefix: "### sentinel" },
];

function fail(reason: string): never {
  throw new Error(`README drift check could not run: ${reason}`);
}

function readmeLines(): string[] {
  return README.split(/\r?\n/);
}

/** The lines of the `## CLI Agent Tools` section, up to the next `## ` heading. */
function sectionLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  if (start === -1) fail(`missing the exact heading "${SECTION_HEADING}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## \S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The lines of one `### <prefix>` subsection, up to the next heading. */
function subsectionLines(prefix: string): string[] {
  const lines = sectionLines(README);
  const start = lines.findIndex((l) => l.startsWith(prefix));
  if (start === -1) fail(`missing the "${prefix}" subsection`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("### ") || /^## \S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Cells of a markdown table row, outer pipes removed. */
function cellsOf(line: string): string[] {
  const parts = line.trim().split("|");
  if (parts.length < 2) return [];
  return parts.slice(1, -1).map((c) => c.trim());
}

interface ToolRow {
  name: string;
  params: string;
  optional: string;
}

/** Tool-table rows: column 1 must be a single backticked identifier. */
function toolRows(lines: readonly string[]): ToolRow[] {
  const out: ToolRow[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = cellsOf(line);
    const m = /^`([A-Za-z0-9_]+)`$/.exec(cells[0] ?? "");
    if (!m) continue;
    out.push({ name: m[1], params: cells[2] ?? "", optional: cells[3] ?? "" });
  }
  return out;
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
}

function parseReadmeTools(markdown: string): ReadmeTools {
  const lines = sectionLines(markdown);

  // Everything before the first `### ` is the agent index table.
  const firstH3 = lines.findIndex((l) => l.startsWith("### "));
  const indexLines = firstH3 === -1 ? lines : lines.slice(0, firstH3);

  const index: Partial<ReadmeTools> = {};
  for (const line of indexLines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = cellsOf(line);
    if (cells.length < 4) continue;
    const label = cells[0].toLowerCase();
    const agent: AgentId | undefined = label.includes("litecoder")
      ? "litecoder"
      : label.includes("kooder")
        ? "kooder"
        : label.includes("sentinel")
          ? "sentinel"
          : undefined;
    if (!agent) continue;
    const count = /\d+/.exec(cells[2].replace(/`/g, ""));
    if (!count) fail(`index row for ${agent} has no numeric tool count`);
    index[agent] = { bins: backticked(cells[1]), countClaim: Number(count![0]), tools: new Set<string>() };
  }

  for (const { agent, prefix } of SUBSECTIONS) {
    const tools = new Set(toolRows(subsectionLines(prefix)).map((r) => r.name));
    const entry = index[agent] ?? { bins: [], countClaim: -1, tools: new Set<string>() };
    index[agent] = { ...entry, tools };
  }

  for (const { agent } of SUBSECTIONS) {
    if (!index[agent]) fail(`no index row and no subsection resolved for ${agent}`);
  }
  return index as ReadmeTools;
}

const README_TOOLS = parseReadmeTools(README);
const KOODER_ROWS = toolRows(subsectionLines("### kooder"));
const SENTINEL_ROWS = toolRows(subsectionLines("### sentinel"));

/** Bidirectional diff with the diagnostics the design specifies. */
function diff(actual: ReadonlySet<string>, expected: readonly string[], agent: string): string[] {
  const problems: string[] = [];
  const missing = expected.filter((n) => !actual.has(n)).sort();
  const extra = [...actual].filter((n) => !expected.includes(n)).sort();
  if (missing.length > 0) {
    problems.push(`${agent} tools: README is missing ${missing.length} tool(s): ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push(`README documents ${extra.length} non-existent tool(s): ${extra.join(", ")}`);
  }
  return problems;
}

// ── C2: DocsSources — read-only adapters over the canonical exports ───

function workerTools(): string[] {
  return TOOL_MANIFEST.map((e) => e.name);
}

function plannerTools(): string[] {
  return NO_TOOLS.manifest.map((e) => e.name);
}

/** AST-parse `interface Firewall` — a runtime-erased type, so source is the truth. */
function sentinelTools(): string[] {
  const file = path.join(root, "src", "sentinel", "system-tools.ts");
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let methods: string[] | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "Firewall") {
      methods = node.members
        .filter((m): m is ts.MethodSignature => ts.isMethodSignature(m))
        .map((m) => (ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf)));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (methods === undefined) fail("could not locate `interface Firewall` in src/sentinel/system-tools.ts");
  if (methods!.length === 0) fail("`interface Firewall` declares no methods");
  return methods!;
}

// ── Optional keys: the single curated editorial addition, test-policed ──

const OPTIONAL_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  search_workspace: [], glob: [], grep: ["pathGlob"],
  read_file: ["startLine", "endLine"], edit_file: [], write_file: [], list_dir: [],
  reindex_workspace: [], run_command: ["timeoutMs"],
  ui_test: ["credentialRef", "steps"], browse: ["session", "steps"],
  api_test: ["expectStatus"], load_skill: [],
  github_create_repo: ["private", "description"], github_clone: ["dir"],
  github_commit: [], github_push: [],
  sed_tool: ["flags"], schedule: [],
  site_crawler: ["maxPages", "maxDepth", "format"],
  read_outline: [], read_multiple_files: ["maxTotalChars"], read_full_file: ["allowLarge"],
  search_ast: ["pathGlob"], get_dependency_graph: [],
  git_diff: ["ref", "path", "rawDiff"], git_log: ["path", "maxCount"],
  line_patch: [], apply_unified_diff: [], update_function: [], rename_symbol: [], validate_file: ["lang"],
  excel: ["sheet", "range"], word: ["append", "overwrite"], pdf: ["pages", "metadata"],
  image: ["includeExif"], slides: ["slides"], video: [],
});

/**
 * Top-level object keys of a registry input hint, without JSON.parse (several
 * hints are intentionally not strict JSON: escaped regexes, `"<from read>"`,
 * and `{ "role": … } or { "keyword": … }`). Nested objects are ignored.
 */
function topLevelKeys(hint: string): string[] {
  const keys = new Set<string>();
  let depth = 0;
  let inString = false;
  let buf = "";
  for (let i = 0; i < hint.length; i += 1) {
    const c = hint[i];
    if (inString) {
      if (c === "\\") { i += 1; continue; }
      if (c === '"') {
        inString = false;
        let j = i + 1;
        while (j < hint.length && hint[j] === " ") j += 1;
        if (hint[j] === ":" && depth === 1) keys.add(buf);
      } else {
        buf += c;
      }
      continue;
    }
    if (c === '"') { inString = true; buf = ""; continue; }
    if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") depth -= 1;
  }
  return [...keys];
}

// ── Assertions A1-A11 ────────────────────────────────────────────────

describe("README CLI Agent Tools section", () => {
  it("A1: the section exists as an H2, has its subsections, and is linked from the contents", () => {
    expect(readmeLines().filter((l) => l.trim() === SECTION_HEADING)).toHaveLength(1);
    expect(README).toContain("[CLI Agent Tools](#cli-agent-tools)");
    for (const { prefix } of SUBSECTIONS) {
      expect(readmeLines().some((l) => l.startsWith(prefix)), `missing subsection ${prefix}`).toBe(true);
    }
  });

  it("A2: every shipped bin maps to exactly one documented agent", () => {
    for (const bin of Object.keys(PKG.bin)) {
      const agent = agentForBin(bin);
      expect(agent, `bin "${bin}" has no documented agent — add it to BIN_TO_AGENT and the README index`).toBeDefined();
      if (!agent) continue;
      expect(README_TOOLS[agent].bins, `index row for ${agent} must list the bin "${bin}"`).toContain(bin);
    }
    expect(agentForBin("worker")).toBe(agentForBin("kooder"));
  });

  it("A3: every human-readable count equals the derived set size", () => {
    const kooder = workerTools();
    // Tripwire: the registry length at the time this section was written. A
    // genuine tool addition updates this line and the README together; a silent
    // drop (e.g. losing ...documentManifestEntries()) fails here.
    expect(kooder).toHaveLength(38);
    expect(README_TOOLS.kooder.countClaim).toBe(kooder.length);
    expect(README_TOOLS.litecoder.countClaim).toBe(plannerTools().length);
    expect(README_TOOLS.sentinel.countClaim).toBe(sentinelTools().length);
    expect(README_TOOLS.kooder.countClaim).toBeGreaterThan(0);
  });

  it("A4: the kooder/worker table matches TOOL_MANIFEST both ways", () => {
    expect(diff(README_TOOLS.kooder.tools, workerTools(), "kooder/worker")).toEqual([]);
  });

  it("A5: litecoder documents no tools, and NO_TOOLS really is empty", () => {
    expect([...README_TOOLS.litecoder.tools]).toEqual([]);
    expect(NO_TOOLS.toolCount).toBe(0);
    expect(NO_TOOLS.names()).toEqual([]);
    expect(NO_TOOLS.manifest).toEqual([]);
    expect(plannerTools()).toEqual([]);
  });

  it("A6: every document tool is still a member of TOOL_MANIFEST", () => {
    const manifest = new Set(workerTools());
    for (const family of DOCUMENT_TOOLS) {
      expect(
        manifest.has(family),
        `DOCUMENT_TOOLS includes "${family}" but TOOL_MANIFEST does not — did the ...documentManifestEntries() spread get dropped?`,
      ).toBe(true);
    }
    expect(DOCUMENT_TOOLS.length).toBeGreaterThan(0);
  });

  it("A7: the sentinel table matches interface Firewall both ways", () => {
    expect(diff(README_TOOLS.sentinel.tools, sentinelTools(), "sentinel")).toEqual([]);
  });

  it("A8: no duplicate tool names in the registry or in the tables", () => {
    const names = workerTools();
    expect(new Set(names).size).toBe(names.length);
    expect(README_TOOLS.kooder.tools.size).toBe(KOODER_ROWS.length);
    expect(README_TOOLS.sentinel.tools.size).toBe(SENTINEL_ROWS.length);
  });

  it("A9: the section contains no secret-shaped strings or foreign URLs", () => {
    const section = sectionLines(README).join("\n");
    const secrets = [
      /\bsk-[A-Za-z0-9]{8,}/,
      /\bgh[pousr]_[A-Za-z0-9]{8,}/,
      /\bAKIA[0-9A-Z]{12,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\b(xox[baprs]-|AIza)[A-Za-z0-9_-]{8,}/,
    ];
    for (const re of secrets) expect(re.test(section), `secret-shaped token matching ${re}`).toBe(false);

    const allowedHosts = new Set(["github.com", "example.com", "localhost:3000", "..."]);
    for (const m of section.matchAll(/https?:\/\/([^\s"')`]+)/g)) {
      const host = m[1].split("/")[0].toLowerCase();
      expect(allowedHosts.has(host), `unexpected absolute URL host "${host}" in the docs section`).toBe(true);
    }
  });

  it("A10: optional keys are consistent with the registry hints in both directions", () => {
    const hints = new Map(TOOL_MANIFEST.map((e) => [e.name, e.inputHint] as const));

    for (const tool of Object.keys(OPTIONAL_KEYS)) {
      expect(hints.has(tool), `OPTIONAL_KEYS names "${tool}" but TOOL_MANIFEST does not`).toBe(true);
    }

    for (const record of KOODER_ROWS) {
      const hint = hints.get(record.name);
      expect(hint, `README documents "${record.name}" but TOOL_MANIFEST does not`).toBeDefined();
      const optional = OPTIONAL_KEYS[record.name] ?? [];
      // Both directions: the curated map and the printed column must agree.
      expect([...backticked(record.optional)].sort(), `optional column for "${record.name}"`).toEqual([...optional].sort());
      // And every claimed optional key must really exist in the hint.
      const keys = topLevelKeys(hint!);
      for (const key of optional) {
        expect(keys, `OPTIONAL_KEYS.${record.name} claims "${key}" is optional but the hint has no such key`).toContain(key);
      }
      expect(record.params.length, `key-parameters cell for "${record.name}" must not be empty`).toBeGreaterThan(0);
      // Every key the registry's example passes must be visible in the row, so a
      // reader never has to open tool-registry.ts to learn a required parameter.
      for (const key of keys) {
        expect(
          record.params.includes(key),
          `key-parameters cell for "${record.name}" omits the registry key "${key}"`,
        ).toBe(true);
      }
    }

    for (const record of SENTINEL_ROWS) {
      expect(["—", "-", ""], `sentinel tool "${record.name}" takes no optional keys`).toContain(record.optional);
    }
  });

  it("A11: the index documents exactly the agents the code defines", () => {
    expect(Object.keys(README_TOOLS).sort()).toEqual(["kooder", "litecoder", "sentinel"]);
    for (const agent of Object.keys(README_TOOLS) as AgentId[]) {
      expect(README_TOOLS[agent].bins.length, `agent ${agent} must list at least one bin`).toBeGreaterThan(0);
    }
    expect(README_TOOLS.litecoder.bins).toEqual(["litecoder"]);
    expect([...README_TOOLS.kooder.bins].sort()).toEqual(["kooder", "worker"]);
    expect(README_TOOLS.sentinel.bins).toEqual(["sentinel"]);
  });
});
