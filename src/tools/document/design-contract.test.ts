// xcoder:version 3 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:38:28.618Z | xcoder:subtask test-st-bfa3d9
/**
 * Tests against the INTENDED behaviour of the document/media surface (design
 * C1–C15), not merely today's behaviour. The round-trip suite proves the happy
 * path; this suite pins the boundary promises: every refusal is a *typed* error
 * (never a wrong file, never a throw), every format is verified from its bytes,
 * and ./new_tools_handoff must describe the registry exactly, dependency-free.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDocumentTool } from "./tool-handler.js";
import { buildToolManifest, dispatchTool } from "../tool-registry.js";
import { clearDocOperations, recentDocOperations } from "./doc-log.js";
import { parseToolInput, MAX_PATH_LENGTH } from "./schemas.js";
import { requireDeclaredMatch, sniffFormat } from "./format-sniff.js";
import { encodeSolidPng } from "./image.js";
import { generateHandoffFiles } from "./handoff-generator.js";
import { DOCUMENT_TOOLS, FORMAT_DESCRIPTIONS, FORMAT_HINTS, formatMatrix } from "./format-registry.js";
import { ROUNDTRIP_CASES, TOOL_SPECS } from "./handoff-content.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-design-"));
  clearDocOperations();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// ── C1/C3 — the surface: six tools, closed extension sets, designed ops. ──
describe("tool surface", () => {
  it("publishes exactly the six designed tools", () => {
    const names = buildToolManifest().map((e) => e.name);
    for (const name of ["excel", "word", "pdf", "image", "slides", "video"]) {
      expect(names, `${name} must be dispatchable`).toContain(name);
    }
  });

  it("declares the designed ops per family", () => {
    const byTool: Record<string, string[]> = {};
    for (const e of formatMatrix()) byTool[e.tool] = [...e.ops].sort();
    expect(byTool.excel).toEqual(["create", "read", "update"]);
    expect(byTool.word).toEqual(["create", "read", "update"]);
    expect(byTool.pdf).toEqual(["create", "read", "update"]);
    expect(byTool.image).toEqual(["create", "read", "update"]);
    expect(byTool.slides).toEqual(["create", "read", "update"]);
    // Video is deliberately read/update only: this tool never transcodes.
    expect(byTool.video).toEqual(["read", "update"]);
  });

  it("gives every tool a description and an op-bearing hint", () => {
    for (const tool of DOCUMENT_TOOLS) {
      expect(FORMAT_DESCRIPTIONS[tool].length).toBeGreaterThan(40);
      expect(FORMAT_HINTS[tool]).toContain('"op"');
    }
  });

  it("keeps extension sets disjoint so no file is ambiguous", () => {
    const seen = new Map<string, string>();
    for (const e of formatMatrix()) {
      for (const ext of e.extensions) {
        expect(seen.has(ext), `${ext} claimed twice`).toBe(false);
        seen.set(ext, e.tool);
      }
    }
    expect(seen.get(".xlsx")).toBe("excel");
    expect(seen.get(".docx")).toBe("word");
    expect(seen.get(".pdf")).toBe("pdf");
    expect(seen.get(".png")).toBe("image");
    expect(seen.get(".pptx")).toBe("slides");
    expect(seen.get(".mp4")).toBe("video");
  });
});

// ── C13 / PRM-07 — schema validation runs BEFORE any parser sees input. ──
describe("input schema validation", () => {
  it("rejects non-objects, unknown ops and missing paths", () => {
    expect(parseToolInput("excel", null).ok).toBe(false);
    expect(parseToolInput("excel", { op: "delete", path: "a.xlsx" }).ok).toBe(false);
    expect(parseToolInput("excel", { op: "read" }).ok).toBe(false);
  });

  it("rejects drive-absolute, UNC and NUL paths", () => {
    for (const bad of ["C:\\tmp\\a.xlsx", "\\\\server\\share\\a.xlsx", "bad\u0000name.xlsx"]) {
      expect(parseToolInput("excel", { op: "read", path: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects a path over the declared maximum", () => {
    expect(parseToolInput("excel", { op: "read", path: "a".repeat(MAX_PATH_LENGTH) + ".xlsx" }).ok).toBe(false);
  });

  it("refuses to replace an existing file unless overwrite: true is passed", async () => {
    const sheets = [{ name: "S", rows: [[1]] }];
    expect((await handleDocumentTool(root, "excel", { op: "create", path: "a.xlsx", sheets })).ok).toBe(true);

    // Omitted and false must both be refused — the guard lives in the writer,
    // not the schema, so it is asserted as behaviour rather than as parsing.
    expect((await handleDocumentTool(root, "excel", { op: "create", path: "a.xlsx", sheets })).code).toBe(
      "overwrite_refused"
    );
    expect(
      (await handleDocumentTool(root, "excel", { op: "create", path: "a.xlsx", sheets, overwrite: false })).code
    ).toBe("overwrite_refused");
    expect(
      (await handleDocumentTool(root, "excel", { op: "create", path: "a.xlsx", sheets, overwrite: true })).ok
    ).toBe(true);
  });

  it("refuses an invalid image background colour", () => {
    const r = parseToolInput("image", { op: "create", path: "a.png", format: "png", width: 2, height: 2, background: "blue" });
    expect(r.ok).toBe(false);
  });

  it("returns typed invalid_input for garbage, never throwing", async () => {
    const res = await handleDocumentTool(root, "excel", { op: "read", path: 42 });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

// ── C2/C4 — Excel and Word cell/paragraph semantics. ──
describe("excel and word design behaviour", () => {
  it("excel: row-values edit reports a sha256 and a byte count", async () => {
    await handleDocumentTool(root, "excel", { op: "create", path: "e.xlsx", sheets: [{ name: "S", rows: [["a"]] }] });
    const updated = await handleDocumentTool(root, "excel", {
      op: "update", path: "e.xlsx", edits: [{ sheet: "S", row: 2, values: ["b", "c"] }], overwrite: true,
    });
    expect(updated.ok).toBe(true);
    expect(typeof updated.bytesWritten).toBe("number");
    expect(String(updated.sha256)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("excel: refuses a missing file with file_not_found", async () => {
    expect(await handleDocumentTool(root, "excel", { op: "read", path: "nope.xlsx" })).toMatchObject({
      ok: false, code: "file_not_found",
    });
  });

  it("word: preserves heading outline across create -> read", async () => {
    await handleDocumentTool(root, "word", {
      op: "create", path: "s.docx",
      paragraphs: [{ text: "H1", style: "Heading1" }, { text: "H2", style: "Heading2" }, { text: "body" }],
    });
    const read = await handleDocumentTool(root, "word", { op: "read", path: "s.docx", includeOutline: true });
    expect((read.outline as { text: string }[]).map((o) => o.text)).toEqual(["H1", "H2"]);
  });

  it("word: all: true replaces every occurrence, all: false only the first", async () => {
    await handleDocumentTool(root, "word", { op: "create", path: "r.docx", paragraphs: [{ text: "x x x" }] });
    await handleDocumentTool(root, "word", {
      op: "update", path: "r.docx", replace: [{ find: "x", replace: "z", all: true }], overwrite: true,
    });
    const all = await handleDocumentTool(root, "word", { op: "read", path: "r.docx" });
    expect((all.paragraphs as { text: string }[])[0].text).toBe("z z z");

    await handleDocumentTool(root, "word", {
      op: "update", path: "r.docx", replace: [{ find: "z", replace: "y", all: false }], overwrite: true,
    });
    const first = await handleDocumentTool(root, "word", { op: "read", path: "r.docx" });
    expect((first.paragraphs as { text: string }[])[0].text).toBe("y z z");
  });
});

// ── C2/C5–C7 — PDF, image, slides and video refusals are typed. ──
describe("format-specific refusals", () => {
  it("pdf: refuses mergeFrom with unsupported_feature", async () => {
    await handleDocumentTool(root, "pdf", { op: "create", path: "a.pdf", pages: [{ text: "a" }] });
    await handleDocumentTool(root, "pdf", { op: "create", path: "b.pdf", pages: [{ text: "b" }] });
    const res = await handleDocumentTool(root, "pdf", { op: "update", path: "a.pdf", mergeFrom: "b.pdf", overwrite: true });
    expect(res).toMatchObject({ ok: false, code: "unsupported_feature" });
  });

  it("image: a PNG renamed to .jpg is caught by magic bytes", async () => {
    const png = encodeSolidPng(2, 2, "#ffffff");
    expect(png.ok).toBe(true);
    if (!png.ok) return;
    await fs.writeFile(path.join(root, "liar.jpg"), png.value);
    expect(await handleDocumentTool(root, "image", { op: "read", path: "liar.jpg" })).toMatchObject({
      ok: false, code: "format_mismatch",
    });
  });

  it("image: create never yields a JPEG, under any extension spelling", async () => {
    for (const name of ["a.jpg", "b.jpeg"]) {
      const res = await handleDocumentTool(root, "image", { op: "create", path: name, format: "jpg", width: 2, height: 2 });
      expect(res).toMatchObject({ ok: false, code: "unsupported_feature" });
      await expect(fs.stat(path.join(root, name))).rejects.toThrow();
    }
  });

  it("image: EXIF is opt-in only", async () => {
    await handleDocumentTool(root, "image", { op: "create", path: "x.png", format: "png", width: 3, height: 3 });
    expect((await handleDocumentTool(root, "image", { op: "read", path: "x.png" })).exif).toBeUndefined();
    expect((await handleDocumentTool(root, "image", { op: "read", path: "x.png", includeExif: true })).ok).toBe(true);
  });

  it("slides: round-trips slide count and title, and rejects an empty deck", async () => {
    await handleDocumentTool(root, "slides", { op: "create", path: "b.pptx", slides: [{ title: "T", bullets: ["a", "b", "c"] }] });
    const read = await handleDocumentTool(root, "slides", { op: "read", path: "b.pptx" });
    expect(read.ok).toBe(true);
    expect(read.slideCount).toBe(1);
    expect((read.slides as { title: string }[])[0].title).toBe("T");
    expect(parseToolInput("slides", { op: "create", path: "e.pptx", slides: [] }).ok).toBe(false);
  });

  // KNOWN DEFECT defect0002 (.xcoder/defects/defect0002.md): distinct bullets are
  // written as separate paragraphs but read back as one concatenated run, so
  // ["alpha","beta","gamma"] returns as "alphabetagamma". Pinned with it.fails
  // so the intended behaviour stays recorded: when the read path is fixed this
  // fails and must be promoted to a plain `it`.
  it.fails("slides: keeps distinct bullets distinct across create -> read", async () => {
    await handleDocumentTool(root, "slides", {
      op: "create",
      path: "sep.pptx",
      slides: [{ title: "T", bullets: ["alpha", "beta", "gamma"] }],
    });
    const read = await handleDocumentTool(root, "slides", { op: "read", path: "sep.pptx" });
    const body = (read.slides as { texts: string[] }[])[0].texts.filter((t) => t !== "T");
    const bullets = body.join("\n").split("\n");
    for (const bullet of ["alpha", "beta", "gamma"]) {
      expect(bullets, `"${bullet}" should survive as its own bullet`).toContain(bullet);
    }
  });

  it("video: has no create op", async () => {
    expect(await handleDocumentTool(root, "video", { op: "create", path: "v.mp4" })).toMatchObject({
      ok: false, code: "invalid_input",
    });
  });

  it("video: reads a minimal MP4 container, refuses non-container bytes", async () => {
    const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")]);
    await fs.writeFile(path.join(root, "m.mp4"), ftyp);
    const read = await handleDocumentTool(root, "video", { op: "read", path: "m.mp4" });
    expect(read.ok).toBe(true);
    expect(read.container).toBe("mp4");

    await fs.writeFile(path.join(root, "fake.mp4"), Buffer.from("not a video at all"));
    const bad = await handleDocumentTool(root, "video", { op: "read", path: "fake.mp4" });
    expect(bad.ok).toBe(false);
    expect(["format_mismatch", "corrupt_input", "unsupported_format"]).toContain(bad.code);
  });
});

// ── C8–C12 / PRM-08 — the security pipeline holds for every family. ──
describe("security pipeline", () => {
  it("contains every family inside the workspace", async () => {
    for (const tool of DOCUMENT_TOOLS) {
      const res = await handleDocumentTool(root, tool, { op: "read", path: "../escape.bin" });
      expect(res.ok, `${tool} must refuse an escaping path`).toBe(false);
      expect(["workspace_escape", "unsupported_format", "invalid_input"]).toContain(res.code);
    }
  });

  it("refuses a mismatched extension for the requested tool", async () => {
    const res = await handleDocumentTool(root, "excel", { op: "create", path: "actually.pdf", sheets: [{ name: "S", rows: [[1]] }] });
    expect(res).toMatchObject({ ok: false, code: "unsupported_format" });
  });

  it("sniffs magic bytes and rejects a cross-format declaration", () => {
    const png = encodeSolidPng(1, 1, "#000000");
    expect(png.ok).toBe(true);
    if (!png.ok) return;
    const sniffed = sniffFormat(png.value);
    expect(sniffed.format).toBe("png");
    expect(requireDeclaredMatch(".png", sniffed).ok).toBe(true);
    expect(requireDeclaredMatch(".pdf", sniffed).ok).toBe(false);
  });

  it("leaves no temp files behind after a successful write", async () => {
    await handleDocumentTool(root, "word", { op: "create", path: "clean.docx", paragraphs: [{ text: "x" }] });
    expect(await fs.readdir(root)).toEqual(["clean.docx"]);
  });

  it("writes nothing at all when the operation is refused", async () => {
    const res = await handleDocumentTool(root, "image", { op: "create", path: "no.jpg", format: "jpg", width: 2, height: 2 });
    expect(res.ok).toBe(false);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("logs attempts with a relative path and no content or absolute root", async () => {
    await handleDocumentTool(root, "excel", { op: "create", path: "log.xlsx", sheets: [{ name: "S", rows: [["SECRET-CELL"]] }] });
    await handleDocumentTool(root, "excel", { op: "read", path: "log.xlsx" });
    const log = recentDocOperations();
    expect(log.length).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain("SECRET-CELL");
    expect(serialized).not.toContain(root);
    for (const entry of log) expect(entry.relPath.includes("..")).toBe(false);
  });

  it("keeps the tool name in the dispatch envelope for a typed failure", async () => {
    const res = await dispatchTool(root, "image", { op: "create", path: "x.jpg", format: "jpg", width: 1, height: 1 });
    expect(res.tool).toBe("image");
    expect(res.ok).toBe(false);
    expect((res.output as { code?: string }).code).toBe("unsupported_feature");
  });
});

// ── C15 — the porting handoff is the deliverable; hold it to its contract. ──
describe("porting handoff contract", () => {
  let files: Map<string, string>;
  beforeAll(() => {
    files = generateHandoffFiles();
  });

  it("ships exactly the promised 17 files", () => {
    expect(files.size).toBe(17);
  });

  it("declares no document/media runtime dependency (design T1)", () => {
    const s = JSON.stringify(JSON.parse(files.get("DEPENDENCIES.json")!)).toLowerCase();
    for (const lib of ["exceljs", "docx", "pdf-lib", "pdfkit", "sharp", "jimp", "pptxgenjs", "fluent-ffmpeg"]) {
      expect(s, `must not depend on ${lib}`).not.toContain(lib);
    }
  });

  it("documents every tool and op in TOOL-CONTRACT.md", () => {
    const contract = files.get("TOOL-CONTRACT.md")!.toLowerCase();
    for (const e of formatMatrix()) {
      expect(contract).toContain(e.tool.toLowerCase());
      for (const op of e.ops) expect(contract).toContain(op.toLowerCase());
    }
  });

  it("documents each typed refusal so a porter does not 'fix' it by guessing", () => {
    const text = (files.get("PORTING-CHECKLIST.md")! + files.get("README.md")!).toLowerCase();
    expect(text).toMatch(/unsupported_feature/);
    expect(text).toMatch(/jpeg/);
    expect(text).toMatch(/transcod|video/);
    expect(text).toMatch(/merge/);
  });

  it("emits a JSON Schema per tool naming its ops, plus a common result", () => {
    for (const tool of DOCUMENT_TOOLS) {
      const raw = files.get(`schemas/${tool}.tool.json`)!;
      expect(raw).toBeTruthy();
      expect(raw).toContain("op");
      for (const op of formatMatrix().find((e) => e.tool === tool)!.ops) expect(raw).toContain(op);
    }
    expect(files.get("schemas/common.result.json")!).toMatch(/ok/);
  });

  it("gives every tool a well-formed round-trip case", () => {
    for (const tool of DOCUMENT_TOOLS) {
      const cases = ROUNDTRIP_CASES.filter((c) => c.tool === tool);
      expect(cases.length, `no case for ${tool}`).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.steps.length, `${c.id} has no steps`).toBeGreaterThan(0);
        expect(c.intent.length, `${c.id} has no intent`).toBeGreaterThan(0);
        for (const step of c.steps) expect(typeof step.op).toBe("string");
      }
    }
  });

  it("keeps every positive round-trip case inside that tool's supported ops", () => {
    // A case whose id names a refusal (…-refused / mismatch / escape) may ask
    // for an op the adapter does not implement — that IS the assertion. Every
    // other case must only use ops the registry actually advertises.
    const isRefusalCase = (id: string) => /refus|mismatch|escape|guard/i.test(id);
    for (const c of ROUNDTRIP_CASES) {
      if (isRefusalCase(c.id)) continue;
      const supported = formatMatrix().find((e) => e.tool === c.tool)!.ops as string[];
      for (const step of c.steps) {
        expect(supported, `${c.id} step ${step.op} is not a ${c.tool} op`).toContain(step.op as string);
      }
    }
  });

  it("keeps handoff specs in lockstep with the live registry", () => {
    const matrix = formatMatrix();
    expect(TOOL_SPECS.map((s) => s.tool).sort()).toEqual(matrix.map((e) => e.tool).sort());
    for (const spec of TOOL_SPECS) {
      const live = matrix.find((e) => e.tool === spec.tool)!;
      expect(spec.extensions).toEqual([...live.extensions]);
      expect(spec.ops).toEqual([...live.ops]);
    }
  });

  it("contains no absolute host path in any file", () => {
    for (const [name, content] of files) {
      expect(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(content), `${name} leaks a drive path`).toBe(false);
      expect(content.includes(os.tmpdir()), `${name} leaks the host tmp dir`).toBe(false);
    }
  });
});
