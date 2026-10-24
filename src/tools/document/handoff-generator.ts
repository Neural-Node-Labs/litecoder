// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:28:25.995Z | xcoder:subtask code-st-39dbde
import { z } from "zod";
import { INPUT_SCHEMAS } from "./schemas.js";
import {
  DELIBERATE_OMISSIONS,
  DEPENDENCIES,
  GENERATED_AT,
  HANDOFF_VERSION,
  PROTOCOL_VERSION,
  ROUNDTRIP_CASES,
  SOURCE_COMMIT,
  SOURCE_REPO,
  SOURCE_VERSION,
  TOOL_SPECS,
} from "./handoff-content.js";
import { DOC_ERROR_CODES } from "./types.js";

/**
 * Deterministic generator for the porting handoff (design C14).
 *
 * Returns every file's content keyed by its path inside `new_tools_handoff/`.
 * It never touches the filesystem itself, never reads the clock and never reads
 * the environment, so two runs produce byte-identical output and CI can assert
 * `git diff --exit-code new_tools_handoff/` after regeneration.
 */

export const HANDOFF_ROOT = "new_tools_handoff";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Convert one zod request schema to JSON Schema, degrading safely. */
function toolJsonSchema(tool: string): Record<string, unknown> {
  const schema = INPUT_SCHEMAS[tool as keyof typeof INPUT_SCHEMAS];
  let converted: unknown;
  try {
    converted = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  } catch {
    converted = { $comment: "schema could not be mechanically converted; see TOOL-CONTRACT.md" };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:xcoder:document-tools:${tool}:1`,
    title: `${tool} tool request`,
    description: TOOL_SPECS.find((s) => s.tool === tool)?.summary ?? "",
    ...(converted as Record<string, unknown>),
  };
}

function versionJson(): string {
  return json({
    handoffVersion: HANDOFF_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    sourceRepo: SOURCE_REPO,
    sourceVersion: SOURCE_VERSION,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: GENERATED_AT,
    generator: "src/tools/document/handoff-generator.ts",
    language: "language-neutral (JSON Schema + declarative cases)",
  });
}

function commonResultJson(): string {
  return json({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:xcoder:document-tools:common-result:1",
    title: "document tool result",
    description: "The output payload returned under the standard { tool, ok, output } envelope.",
    oneOf: [
      { type: "object", required: ["ok"], properties: { ok: { const: true } }, additionalProperties: true },
      {
        type: "object",
        required: ["ok", "code", "error"],
        properties: {
          ok: { const: false },
          code: { enum: [...DOC_ERROR_CODES] },
          error: { type: "string", minLength: 1 },
        },
        additionalProperties: true,
      },
    ],
  });
}

function formatMatrix(): string {
  return json({
    handoffVersion: HANDOFF_VERSION,
    sourceCommit: SOURCE_COMMIT,
    note: "Extensions are hints; the format is always decided by magic bytes.",
    tools: TOOL_SPECS.map((s) => ({
      tool: s.tool,
      extensions: s.extensions,
      ops: s.ops,
      createSupported: s.createSupported,
      responseShape: s.responseShape,
    })),
  });
}

function formatMatrixMd(): string {
  const rows = TOOL_SPECS.map(
    (s) => `| \`${s.tool}\` | ${s.extensions.map((e) => `\`${e}\``).join(" ")} | ${s.ops.join(", ")} |`
  );
  return [
    "# Format matrix",
    "",
    "Extensions are **hints**. Every read and update sniffs the leading bytes and refuses",
    "on mismatch (`format_mismatch`) rather than trusting the declared extension.",
    "",
    "| tool | extensions | ops |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Deliberate omissions",
    "",
    ...DELIBERATE_OMISSIONS.map((o) => `- ${o}`),
    "",
  ].join("\n");
}

function dependenciesJson(): string {
  return json({
    note: "Pinned allowlist. No document-format library and no subprocess is permitted.",
    dependencies: DEPENDENCIES,
  });
}

function toolContractMd(): string {
  const out: string[] = [
    "# Tool contract",
    "",
    "Six tools, one protocol. Dispatch envelope (identical to every other tool in the host program):",
    "",
    "```json",
    '{ "tool": "<tool name>", "ok": true, "output": <result> }',
    "```",
    "",
    "`ok` is false whenever `output.ok` is false. Dispatch never throws.",
    "",
    "## Error codes",
    "",
    ...DOC_ERROR_CODES.map((c) => `- \`${c}\``),
    "",
    "## Shared pipeline",
    "",
    "1. Schema-validate the request before anything else; reject with `invalid_input`.",
    "2. Resolve the path inside the workspace only; reject with `workspace_escape`.",
    "3. Read the bytes, enforce the size ceiling, sniff magic bytes, require the declared extension to match.",
    "4. Run the operation under a unit budget and a wall-clock deadline.",
    "5. Write temp-in-same-directory then rename; refuse unless `overwrite: true` on an existing file.",
    "6. Log a redacted record (tool, op, path, outcome, byte counts) — never contents.",
    "",
  ];
  for (const spec of TOOL_SPECS) {
    out.push(
      `## \`${spec.tool}\``,
      "",
      spec.summary,
      "",
      `Extensions: ${spec.extensions.join(", ")}. Ops: ${spec.ops.join(", ")}.`,
      "",
      "```text",
      spec.responseShape,
      "```",
      "",
      "Requests:",
      ""
    );
    for (const [op, example] of Object.entries(spec.requestExamples)) {
      out.push(`- \`${op}\`: \`${JSON.stringify(example)}\``);
    }
    out.push("", "Notes:", "", ...spec.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n");
}

function portingChecklistMd(): string {
  return [
    "# Porting checklist",
    "",
    "Work top to bottom. Each item is independently verifiable against `tests/roundtrip-cases.json`.",
    "",
    "## 1. Contract plumbing",
    "",
    "- [ ] Dispatch accepts the six tool names and returns `{ tool, ok, output }` without throwing.",
    "- [ ] A request missing `path` or `op` yields an actionable error naming both fields.",
    "- [ ] Request validation rejects unknown `op` values with `invalid_input`.",
    "- [ ] Every documented value of the error-code enum is reachable and distinct.",
    "",
    "## 2. Containment and limits",
    "",
    "- [ ] `..` and absolute/UNC paths are refused with `workspace_escape`.",
    "- [ ] Symlinks inside the workspace that resolve outside it are refused.",
    "- [ ] Input, output, entry-count, inflated-size, pixel-count and cell-count ceilings all fail closed.",
    "- [ ] A wall-clock deadline aborts a long operation instead of letting it run.",
    "",
    "## 3. Format verification",
    "",
    "- [ ] Every read/update sniffs magic bytes (ZIP + OOXML part check, `%PDF-`, PNG signature, `FF D8 FF`, CFB, `ftyp`, EBML, RIFF/AVI).",
    "- [ ] A file whose bytes contradict its extension is refused with `format_mismatch`.",
    "- [ ] An OLE/CFB container behind an OOXML extension is reported as `password_protected`; a legacy `.xls`/`.doc`/`.ppt` as `unsupported_format`.",
    "",
    "## 4. Per-tool behaviour",
    "",
    ...TOOL_SPECS.flatMap((s) => [`### ${s.tool}`, "", ...s.notes.map((n) => `- [ ] ${n}`), ""]),
    "## 5. Writes",
    "",
    "- [ ] Writes go to a temp file in the destination directory and are renamed into place.",
    "- [ ] A failure mid-write leaves the original file byte-identical.",
    "- [ ] An existing file is only replaced with an explicit `overwrite: true`; otherwise `overwrite_refused`.",
    "- [ ] The result reports `bytesWritten` and a sha256 of the written bytes.",
    "",
    "## 6. Conformance",
    "",
    `- [ ] All ${ROUNDTRIP_CASES.length} cases in \`tests/roundtrip-cases.json\` pass against the new implementation.`,
    "- [ ] Regenerating the handoff produces no diff.",
    "",
  ].join("\n");
}

function readmeMd(): string {
  const table = TOOL_SPECS.map((s) => `| \`${s.tool}\` | ${s.extensions.join(", ")} | ${s.ops.join(", ")} |`);
  return [
    "# Document & media tools — porting handoff",
    "",
    `Handoff **v${HANDOFF_VERSION}**, protocol **v${PROTOCOL_VERSION}**, from \`${SOURCE_REPO}\` @ \`${SOURCE_COMMIT}\` (${SOURCE_VERSION}).`,
    "",
    "This directory is a **drop-in specification** for adding Excel, Word, PDF, PNG/JPEG, PowerPoint",
    "and video tools to another program. It is deliberately language-neutral: the contract is JSON",
    "Schema plus declarative test cases, and the TypeScript in the source repository is only one",
    "reference implementation of it.",
    "",
    "## Read in this order",
    "",
    "1. `TOOL-CONTRACT.md` — the six tools, their request/response shapes, the shared pipeline and the error enum.",
    "2. `FORMAT-MATRIX.md` / `FORMAT-MATRIX.json` — extensions, ops and capabilities per tool.",
    "3. `schemas/*.tool.json` — machine-readable request schemas; validate against these, not against prose.",
    "4. `schemas/common.result.json` — the result envelope every tool returns.",
    "5. `tests/roundtrip-cases.json` — executable conformance cases; the port is done when these pass.",
    "6. `PORTING-CHECKLIST.md` — the full acceptance list, in dependency order.",
    "7. `DEPENDENCIES.json` — the pinned allowlist, and why it is small.",
    "",
    "## The six tools",
    "",
    "| tool | extensions | ops |",
    "| --- | --- | --- |",
    ...table,
    "",
    "## The five non-negotiables",
    "",
    "1. **Validate before parse.** Request → schema → adapter. Nothing unvalidated reaches a parser.",
    "2. **Magic bytes beat extensions.** Every read/update sniffs and refuses on mismatch.",
    "3. **Contain every path.** Resolve inside the workspace; refuse `..`, absolute paths and escaping symlinks.",
    "4. **Fail closed on size.** Entry counts, inflate totals, pixels, cells and wall-clock all have ceilings.",
    "5. **Never write without consent.** Temp-then-rename, and `overwrite: true` is required to replace a file.",
    "",
    "## What this handoff deliberately does not include",
    "",
    ...DELIBERATE_OMISSIONS.map((o) => `- ${o}`),
    "",
    "## Provenance",
    "",
    "`VERSION.json` pins the source commit. `reference-impl/NOTES.md` maps each module in the",
    "reference implementation to the part of the contract it satisfies, so a port can be reviewed",
    "side by side rather than inferred.",
    "",
  ].join("\n");
}

function referenceImplNotesMd(): string {
  const rows: [string, string][] = [
    ["`types.ts`", "AdapterResult / DocErrorCode / OpBudget vocabulary"],
    ["`schemas.ts`", "the six public zod request schemas (source of `schemas/*.tool.json`)"],
    ["`limits.ts`", "named ceilings and fail-closed guards"],
    ["`format-sniff.ts`", "magic-byte detection and extension/format agreement"],
    ["`atomic-write.ts`", "temp-then-rename writer and contained reader"],
    ["`ooxml-zip.ts`", "bounded ZIP read/write for the three OOXML formats"],
    ["`xml-text.ts`", "text-node helpers; no entity or DTD resolution"],
    ["`excel.ts` / `word.ts` / `slides.ts`", "OOXML adapters (read / create / update)"],
    ["`pdf.ts`", "PDF object-graph reader and writer"],
    ["`image.ts`", "PNG encode/decode, PNG+JPEG header parsing"],
    ["`video.ts`", "container metadata walkers (ISO-BMFF, EBML, RIFF)"],
    ["`format-registry.ts`", "family → extensions, adapter, limits, manifest entry"],
    ["`tool-handler.ts`", "the single dispatch target every tool routes through"],
    ["`doc-log.ts`", "redacted operation log"],
  ];
  return [
    "# Reference implementation notes",
    "",
    "The TypeScript under `src/tools/document/` is **one** implementation. Treat it as a worked",
    "example, not as the specification — the contract is the JSON Schema and the round-trip cases.",
    "",
    "## Module map",
    "",
    "| module | contract section it satisfies |",
    "| --- | --- |",
    ...rows.map(([m, c]) => `| ${m} | ${c} |`),
    "",
    "## Sequencing that worked",
    "",
    "1. `limits` + `format-sniff` + `atomic-write` first — dependency-free and fully testable.",
    "2. Registry + schemas + handler next, with adapters stubbed to `unsupported_feature`.",
    "   The security contract is then green before any format code exists.",
    "3. Adapters in ascending risk: image → pdf → excel → word → slides → video.",
    "4. Handoff generator and its verifier last.",
    "",
    "## Pitfalls found while building this",
    "",
    "- Spreadsheet inline strings are the unprefixed `<t>` element, not `<w:t>`. Reusing the Word",
    "  text helper silently returns empty cells — the round-trip test catches this.",
    "- A PDF's xref offsets are byte offsets into the file, not object indices. Numbering objects",
    "  deterministically (catalog=1, pages=2, then page/content pairs) is what keeps them correct.",
    "- ZIP entries may be either stored or deflated; a writer must choose per entry or accept ~3x bloat.",
    "- `update` must read the original first. Writing from the request alone loses every untouched part.",
    "",
  ].join("\n");
}

function fixturesManifest(): string {
  return json({
    note: "Fixtures are generated by the conformance run itself, not shipped as binaries.",
    generatedBy: "tests/roundtrip-cases.json",
    rule: "Each case starts from an empty workspace directory; create steps produce the files later steps read.",
    cases: ROUNDTRIP_CASES.map((c) => ({ id: c.id, tool: c.tool, steps: c.steps.length })),
  });
}

/** path (relative to HANDOFF_ROOT) → file content. Deterministic by construction. */
export function generateHandoffFiles(): Map<string, string> {
  const files = new Map<string, string>();
  files.set("README.md", readmeMd());
  files.set("VERSION.json", versionJson());
  files.set("TOOL-CONTRACT.md", toolContractMd());
  files.set("FORMAT-MATRIX.md", formatMatrixMd());
  files.set("FORMAT-MATRIX.json", formatMatrix());
  files.set("DEPENDENCIES.json", dependenciesJson());
  files.set("PORTING-CHECKLIST.md", portingChecklistMd());
  files.set("schemas/common.result.json", commonResultJson());
  for (const spec of TOOL_SPECS) {
    files.set(`schemas/${spec.tool}.tool.json`, json(toolJsonSchema(spec.tool)));
  }
  files.set(
    "tests/roundtrip-cases.json",
    json({ handoffVersion: HANDOFF_VERSION, protocolVersion: PROTOCOL_VERSION, cases: ROUNDTRIP_CASES })
  );
  files.set("tests/fixtures/MANIFEST.json", fixturesManifest());
  files.set("reference-impl/NOTES.md", referenceImplNotesMd());
  return files;
}
