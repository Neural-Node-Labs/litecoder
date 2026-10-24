// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:24:48.492Z | xcoder:subtask code-st-39dbde
import { excelAdapter } from "./excel.js";
import { wordAdapter } from "./word.js";
import { pdfAdapter } from "./pdf.js";
import { imageAdapter } from "./image.js";
import { slidesAdapter } from "./slides.js";
import { videoAdapter } from "./video.js";
import { FAMILY_LIMITS } from "./limits.js";
import type { DocOp, FormatAdapter, FormatFamily } from "./types.js";

export interface ToolManifestEntry {
  name: string;
  description: string;
  inputHint: string;
}

/**
 * Single source of truth for the document/media surface (design C1).
 *
 * Nothing else in the codebase may hard-code "which extensions does excel
 * take": the manifest entry, the schema union, the sniffer expectation, the
 * limits and the adapter are all reached through this table. Adding a format
 * means adding one row here, not editing six files.
 */

const ADAPTERS: Record<FormatFamily, FormatAdapter> = {
  excel: excelAdapter,
  word: wordAdapter,
  pdf: pdfAdapter,
  image: imageAdapter,
  slides: slidesAdapter,
  video: videoAdapter,
};

export const DOCUMENT_TOOLS: readonly FormatFamily[] = ["excel", "word", "pdf", "image", "slides", "video"];

export const FORMAT_DESCRIPTIONS: Record<FormatFamily, string> = {
  excel:
    "Read, create or update an Excel workbook (.xlsx) — sheet names, cell values and ranges. " +
    "Text-only cell updates; styles, charts and formulas are preserved but never evaluated. " +
    "Paths are workspace-relative, the format is verified from the bytes, and nothing is written unless overwrite: true on an existing file.",
  word:
    "Read, create or update a Word document (.docx) — paragraphs, heading styles and outline. " +
    "Update appends, replaces matched text, or inserts after a paragraph index; other package parts are preserved. " +
    "Paths are workspace-relative and the format is verified from the bytes.",
  pdf:
    "Read, create or update a PDF (.pdf) — page count, extracted text layer and document metadata. " +
    "Encrypted PDFs and cross-reference-stream PDFs are refused rather than guessed at; there is no mergeFrom in this version. " +
    "Paths are workspace-relative and the format is verified from the bytes.",
  image:
    "Read, create or update a PNG or JPEG image — dimensions, alpha channel, optional EXIF (opt-in, off by default because EXIF carries GPS). " +
    "Create produces PNG only; JPEG encoding and format conversion are refused with unsupported_feature rather than done silently. " +
    "Paths are workspace-relative and the format is verified from the bytes.",
  slides:
    "Read, create or update a PowerPoint deck (.pptx) — slide count, titles, bullet text and per-shape text replacement. " +
    "Only the edited slide parts are rewritten; masters and themes are preserved. " +
    "Paths are workspace-relative and the format is verified from the bytes.",
  video:
    "Read container metadata for a video file (MP4, MOV, WebM, MKV, AVI) — duration, dimensions, codecs, bitrate — or replace it wholesale via update. " +
    "There is no create and no transcoding: a video is never re-encoded by this tool. " +
    "Paths are workspace-relative and the format is verified from the bytes.",
};

export const FORMAT_HINTS: Record<FormatFamily, string> = {
  excel: '{ "op": "read", "path": "reports/q3.xlsx", "sheet": "Summary", "range": "A1:D20" }',
  word: '{ "op": "update", "path": "docs/spec.docx", "append": [{ "text": "Appendix", "style": "Heading1" }], "overwrite": true }',
  pdf: '{ "op": "create", "path": "out/notes.pdf", "pages": [{ "text": "Hello" }], "metadata": { "title": "Notes" } }',
  image: '{ "op": "read", "path": "assets/logo.png", "includeExif": true }',
  slides: '{ "op": "create", "path": "deck/kickoff.pptx", "slides": [{ "title": "Kickoff", "bullets": ["Scope", "Timeline"] }] }',
  video:
    '{ "op": "read", "path": "media/demo.mp4" }',
};

/** Parsed path extension, lower-cased, including the dot. */
export function extensionOf(relPath: string): string {
  const base = relPath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/** Resolve a tool name to its adapter, or null when it is not a document tool. */
export function adapterFor(tool: string): FormatAdapter | null {
  if (!(DOCUMENT_TOOLS as readonly string[]).includes(tool)) return null;
  return ADAPTERS[tool as FormatFamily];
}

/** Which family owns an extension (the inverse lookup). */
export function familyForExtension(ext: string): FormatFamily | null {
  const needle = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  for (const family of DOCUMENT_TOOLS) {
    if (ADAPTERS[family].extensions.includes(needle)) return family;
  }
  return null;
}

/** Does this family's adapter declare support for `op`? */
export function supportsOp(family: FormatFamily, op: string): op is DocOp {
  return (ADAPTERS[family].ops as readonly string[]).includes(op);
}

export function limitsFor(family: FormatFamily) {
  return FAMILY_LIMITS[family] ?? ADAPTERS[family].limits;
}

/** The six manifest entries, in a stable order, for TOOL_MANIFEST. */
export function documentManifestEntries(): ToolManifestEntry[] {
  return DOCUMENT_TOOLS.map((family) => ({
    name: family,
    description: FORMAT_DESCRIPTIONS[family],
    inputHint: FORMAT_HINTS[family],
  }));
}

/** Machine-readable matrix — also what the porting handoff is generated from. */
export function formatMatrix() {
  return DOCUMENT_TOOLS.map((family) => ({
    tool: family,
    extensions: ADAPTERS[family].extensions,
    ops: ADAPTERS[family].ops,
    limits: ADAPTERS[family].limits,
  }));
}
