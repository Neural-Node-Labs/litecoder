// xcoder:version 6 | xcoder:task task-5f5358 | xcoder:updated 2026-10-30T18:21:09.738Z | xcoder:subtask test-st-a10394
// xcoder:task task-5f5358 | xcoder:subtask test-st-a10394
/**
 * Intended-behaviour contract for the README "CLI Agent Tools" section.
 *
 * `readme-tool-docs.test.ts` proves the tool *sets* match the registries. This
 * file covers what a set comparison cannot see: every claim the section makes
 * to a reader must be a claim the code keeps. Expectations are derived from
 * source, never restated by hand:
 *
 *   approval verb syntax  <- `.option(...)` registrations in src/sentinel/cli.ts
 *   dry-run default       <- loadSentinelConfig() in src/sentinel/config.ts
 *   kill switch           <- call sites in src/sentinel/daemon.ts
 *   audit before action   <- statement order in src/sentinel/daemon.ts
 *   single-use verdicts   <- consumeVerdict() in src/sentinel/approval-inbox.ts
 *   code-owned policy     <- policy-engine.ts + RULES in policy/rules.ts
 *   document tool count   <- DOCUMENT_TOOLS in document/format-registry.ts
 *   worker/kooder alias   <- package.json#bin (same target file)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_MANIFEST } from "./tool-registry.js";
import { DOCUMENT_TOOLS } from "./document/format-registry.js";
import { NO_TOOLS, OrchestratorHasNoToolsError } from "../litecoder/no-tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const README = fs.readFileSync(path.join(root, "README.md"), "utf8");
const PKG = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

const src = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const SECTION_HEADING = "## CLI Agent Tools";

const readmeLines = (): string[] => README.split(/\r?\n/);

/** The `## CLI Agent Tools` section body, up to the next `## ` heading. */
function sectionLines(): string[] {
  const lines = readmeLines();
  const start = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  expect(start, `README is missing the exact heading "${SECTION_HEADING}"`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## \S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

const SECTION = sectionLines().join("\n");
/** Prose is hard-wrapped in the README; match sentences, not line breaks. */
const SECTION_FLAT = SECTION.replace(/\s+/g, " ");

/** Cells of a markdown table row, outer pipes removed. */
function cellsOf(line: string): string[] {
  const parts = line.trim().split("|");
  if (parts.length < 2) return [];
  return parts.slice(1, -1).map((c) => c.trim());
}

function tableRows(lines: readonly string[]): string[][] {
  return lines.filter((l) => l.trim().startsWith("|")).map(cellsOf);
}

function subsectionLines(prefix: string): string[] {
  const lines = sectionLines();
  const start = lines.findIndex((l) => l.startsWith(prefix));
  expect(start, `README is missing the "${prefix}" subsection`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("### ") || /^## \S/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** GitHub-style heading slug, for checking in-document links. */
function slug(heading: string): string {
  return heading
    .replace(/^#{1,6} /, "")
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ /g, "-");
}

// ── B1-B3: placement, navigation, cited sources ──────────────────────

describe("README CLI Agent Tools — placement", () => {
  it("B1: sits between Sentinel's 'Operating safely' and 'Programmatic use'", () => {
    const lines = readmeLines();
    const at = (pred: (l: string) => boolean): number => lines.findIndex(pred);
    const safely = at((l) => l === "### Operating safely");
    const section = at((l) => l.trim() === SECTION_HEADING);
    const programmatic = at((l) => l === "## Programmatic use");

    expect(safely, "README lost the '### Operating safely' heading").toBeGreaterThan(-1);
    expect(programmatic, "README lost the '## Programmatic use' heading").toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(safely);
    expect(section).toBeLessThan(programmatic);
  });

  it("B2: every relative anchor it links to resolves to a real heading", () => {
    const slugs = new Set(
      readmeLines()
        .filter((l) => /^#{1,6} \S/.test(l))
        .map(slug),
    );
    const anchors = [...SECTION.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(anchors.length, "the section should link to the related docs").toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(slugs.has(anchor), `section links to #${anchor} but no heading has that slug`).toBe(true);
    }
  });

  it("B3: every source-of-truth path it cites exists", () => {
    const cited = new Set([...SECTION.matchAll(/`(src\/[^`]+?\.(?:ts|js|json))`/g)].map((m) => m[1]));
    expect(cited.size, "the section must cite at least one source file").toBeGreaterThan(0);
    for (const rel of cited) {
      expect(fs.existsSync(path.join(root, rel)), `README cites ${rel}, which does not exist`).toBe(true);
    }
  });
});

// ── B4-B9: sentinel prose must be the sentinel that ships ────────────

function registeredOptions(cliSource: string): string[] {
  return [...cliSource.matchAll(/\.option\(\s*'([^']+)'/g)].map((m) => m[1]);
}

describe("README CLI Agent Tools — sentinel claims match the code", () => {
  const cli = src("src/sentinel/cli.ts");
  const options = registeredOptions(cli);

  it("B4: the approval verbs it documents are the ones the CLI registers", () => {
    expect(options.length, "could not parse any .option() from src/sentinel/cli.ts").toBeGreaterThan(0);
    expect(SECTION).toMatch(/sentinel --approve <id>/);
    expect(SECTION).toMatch(/sentinel --deny <id>/);
    expect(options, "cli.ts must register --approve <id>").toContain("--approve <id>");
    expect(options, "cli.ts must register --deny <id>").toContain("--deny <id>");

    // Regression guard for defect0001: the CLI declares no positional verbs, so
    // a documented `sentinel approve <id>` would be silently ignored.
    expect(
      SECTION,
      "the CLI accepts no positional verbs — do not document `sentinel approve <id>`",
    ).not.toMatch(/sentinel (approve|deny)\s/);
  });

  it("B5: it documents the real dry-run default and the flag that disables it", () => {
    const config = src("src/sentinel/config.ts");
    const run = src("src/sentinel/run.ts");

    expect(options).toContain("--no-dry-run");
    expect(SECTION).toContain("--no-dry-run");
    expect(SECTION, "the section must say the default is dry-run").toMatch(/Dry-run by default/);
    expect(config, "loadSentinelConfig must default dryRun to true").toMatch(
      /dryRun:\s*file\.dryRun\s*\?\?\s*bool\([^)]*,\s*true\)/,
    );
    expect(run, "runSentinel must branch on config.dryRun when choosing the firewall").toMatch(/config\.dryRun/);
    expect(cli, "--no-dry-run must set SENTINEL_DRYRUN=0").toMatch(/SENTINEL_DRYRUN\s*=\s*'0'/);
  });

  it("B6: code-owned policy really is code, in policy-engine.ts", () => {
    expect(SECTION).toContain("policy-engine.ts");
    expect(fs.existsSync(path.join(root, "src/sentinel/policy-engine.ts"))).toBe(true);
    expect(src("src/sentinel/policy-engine.ts"), "policyEngine is the exported decision point").toMatch(
      /export const policyEngine\s*=/,
    );
    expect(src("src/sentinel/policy/rules.ts")).toMatch(/export const RULES\s*:\s*readonly PolicyRule\[\]/);
  });

  it("B7: the kill switch is checked twice, the second time before acting", () => {
    const daemon = src("src/sentinel/daemon.ts");
    const checks = [...daemon.matchAll(/killSwitch\.isEngaged\(\)/g)].map((m) => m.index ?? -1);
    expect(SECTION).toContain("Kill switch");
    expect(SECTION_FLAT, "the section must state when it is checked").toMatch(
      /every cycle and again immediately before any firewall call/i,
    );
    expect(checks.length, "daemon.ts must check the kill switch more than once").toBeGreaterThanOrEqual(2);
    const firewallCall = daemon.indexOf("this.deps.firewall.");
    expect(firewallCall, "daemon.ts no longer calls this.deps.firewall").toBeGreaterThan(-1);
    expect(Math.max(...checks), "a kill-switch check must precede the firewall call").toBeLessThan(firewallCall);
  });

  it("B8: audit is written before the firewall acts, as the section promises", () => {
    const daemon = src("src/sentinel/daemon.ts");
    expect(SECTION, "the section must state audit-before-action").toMatch(/Audit before action/i);

    const preAuditGuard = daemon.indexOf("if (!preAudited)");
    const firewallCall = daemon.indexOf("this.deps.firewall.");
    expect(preAuditGuard, "daemon.ts lost the pre-audit guard").toBeGreaterThan(-1);
    expect(firewallCall).toBeGreaterThan(-1);
    expect(preAuditGuard, "the audit write must be checked before the firewall is called").toBeLessThan(firewallCall);
    expect(daemon).toContain("audit write failed; refusing to act");
  });

  it("B9: verdicts really are single-use, as the section promises", () => {
    const inbox = src("src/sentinel/approval-inbox.ts");
    expect(SECTION, "the section must state an approval is never reusable").toMatch(/never reusable/i);
    expect(inbox, "consumeVerdict must delete the entry it returns").toMatch(/delete all\[decisionId\]/);
    expect(inbox).toMatch(/Read-and-delete/);
  });
});

// ── B10-B12: registry-backed prose claims ────────────────────────────

describe("README CLI Agent Tools — registry-backed prose", () => {
  it("B10: the spoken document-tool count matches DOCUMENT_TOOLS", () => {
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    const expected = words[DOCUMENT_TOOLS.length];
    expect(expected, `DOCUMENT_TOOLS grew past the words this test knows (${DOCUMENT_TOOLS.length})`).toBeDefined();
    expect(
      SECTION,
      `README says a different number than DOCUMENT_TOOLS.length (${DOCUMENT_TOOLS.length})`,
    ).toContain(`The ${expected} document tools are described in`);
  });

  it("B11: kooder and worker really are one binary, as the section says", () => {
    expect(PKG.bin.kooder, "package.json must ship a kooder bin").toBeDefined();
    expect(PKG.bin.worker, "package.json must ship a worker bin").toBeDefined();
    expect(PKG.bin.worker, "the section claims worker and kooder are the same binary").toBe(PKG.bin.kooder);
    const target = PKG.bin.kooder.replace(/^\.\//, "");
    expect(SECTION, `the section must name the shared binary as ${target}`).toContain(`\`${target}\``);
  });

  it("B12: no tool example passes a raw secret, and the credential tool list is exact", () => {
    // PRM-03: the docs must teach credentialRef, never a literal secret param.
    const rows = tableRows(subsectionLines("### kooder")).filter(
      (c) => c.length >= 4 && /^`[A-Za-z0-9_]+`$/.test(c[0]),
    );
    expect(rows.length, "could not find any kooder tool rows").toBeGreaterThan(0);

    const secretish = /("|')(password|passwd|token|secret|api[_-]?key)("|')\s*:/i;
    for (const cells of rows) {
      const name = cells[0].replace(/`/g, "");
      expect(secretish.test(cells[2]), `row for ${name} passes a raw secret — use credentialRef`).toBe(false);
    }

    // The sentence's tool list must be derived from the registry, not a wildcard
    // (defect0002: `github_*` swept in github_commit, which takes no credential).
    const takesCredential = TOOL_MANIFEST.filter((e) =>
      /credentialRef/.test(e.description + e.inputHint),
    ).map((e) => e.name);
    expect(takesCredential.length, "expected tools that take a credentialRef").toBeGreaterThan(0);

    const sentence = /Tools that touch the network[^]*?document tools are described in/.exec(SECTION_FLAT);
    expect(sentence, "the credential-safety sentence is missing from the section").not.toBeNull();
    const text = sentence![0];

    for (const name of takesCredential) {
      expect(text, `the credential sentence omits \`${name}\`, which takes a credentialRef`).toContain(name);
    }

    // No wildcard may stand in for the derived list.
    expect(text, "do not use a `github_*`-style wildcard — list the tools the registry supports").not.toMatch(
      /`[a-z0-9]+_\*`/,
    );

    // And any tool the mandatory clause groups in must really take one. The
    // clause ends where the exceptions are introduced, so a tool described as
    // optional/no-credential is not swept into the claim.
    const exceptionAt = text.indexOf("`github_clone`");
    const mandatory = exceptionAt === -1 ? text : text.slice(0, exceptionAt);
    const exceptions = exceptionAt === -1 ? "" : text.slice(exceptionAt);
    const registered = new Set(TOOL_MANIFEST.map((e) => e.name));
    for (const [, name] of mandatory.matchAll(/`([a-z0-9_]+)`/g)) {
      if (name === "credentialRef" || name === "GITHUB_TOKEN" || !registered.has(name)) continue;
      expect(
        takesCredential,
        `the credential sentence groups \`${name}\` with the credential-taking tools, but its registry entry never mentions credentialRef`,
      ).toContain(name);
    }

    // Every github_* tool that is NOT in the mandatory list must be accounted
    // for in the exceptions, so none can be silently misdescribed.
    const githubTools = TOOL_MANIFEST.filter((e) => e.name.startsWith("github_")).map((e) => e.name);
    for (const name of githubTools.filter((n) => !takesCredential.includes(n))) {
      expect(exceptions, `\`${name}\` takes no required credential but the sentence never says so`).toContain(name);
    }
  });
});

// ── B13-B14: the litecoder paragraph is backed by the frozen registry ─

describe("README CLI Agent Tools — litecoder boundary", () => {
  it("B13: NO_TOOLS behaves exactly as the litecoder subsection describes", () => {
    expect(SECTION).toContain("NO_TOOLS");
    expect(SECTION).toContain("OrchestratorHasNoToolsError");

    expect(NO_TOOLS.toolCount).toBe(0);
    expect(NO_TOOLS.manifest).toEqual([]);
    expect(Object.keys(NO_TOOLS.tools)).toEqual([]);

    expect(() => NO_TOOLS.get("glob")).toThrow(OrchestratorHasNoToolsError);
    expect(() => NO_TOOLS.call("glob", {})).toThrow(OrchestratorHasNoToolsError);
    expect(NO_TOOLS.has("glob")).toBe(false);

    // "a structural boundary, not a prompt instruction" — frozen, not advisory.
    expect(Object.isFrozen(NO_TOOLS)).toBe(true);
    expect(Object.isFrozen(NO_TOOLS.tools)).toBe(true);
    expect(Object.isFrozen(NO_TOOLS.manifest)).toBe(true);
  });

  it("B14: the litecoder table is header-only, and that is deliberate", () => {
    const rows = tableRows(subsectionLines("### litecoder"));
    expect(rows.length, "the litecoder table must exist").toBeGreaterThan(0);
    expect(rows[0]).toEqual(["Tool", "Purpose", "Key parameters", "Optional keys"]);
    const dataRows = rows.filter((c) => /^`[A-Za-z0-9_]+`$/.test(c[0] ?? ""));
    expect(dataRows, "any litecoder tool row would contradict NO_TOOLS").toEqual([]);
    expect(SECTION, "say out loud that an empty table is intentional").toMatch(
      /no rows in that table on purpose|Any tool listed here would be a bug/i,
    );
  });
});
