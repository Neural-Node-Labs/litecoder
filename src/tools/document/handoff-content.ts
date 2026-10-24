// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:27:35.971Z | xcoder:subtask code-st-39dbde
import type { FormatFamily } from "./types.js";

/**
 * Declarative content for the porting handoff (design C14, handoff contract).
 *
 * Everything here is language-neutral DATA: a matrix of formats, a list of
 * round-trip cases and the dependency allowlist. The generator turns it into
 * markdown/JSON; a non-TypeScript program can read the JSON directly and skip
 * the prose entirely.
 *
 * Nothing in this module reads the filesystem, the environment or the clock —
 * that is what makes the generated handoff byte-identical across runs, so CI can
 * assert `git diff --exit-code new_tools_handoff/` after regeneration.
 */

/** Pinned source revision the handoff describes. Bumping this is a deliberate act. */
export const SOURCE_REPO = "Neural-Node-Labs/litecoder";
export const SOURCE_COMMIT = "5769b4e";
export const SOURCE_VERSION = "3.0.2";
export const HANDOFF_VERSION = "1.0.0";
export const PROTOCOL_VERSION = "1";

/**
 * Fixed, not `new Date()`: a timestamp would make every regeneration a diff and
 * defeat the drift check. Update it when the contract itself changes.
 */
export const GENERATED_AT = "2026-10-17T00:00:00.000Z";

export interface ToolSpec {
  tool: FormatFamily;
  summary: string;
  extensions: string[];
  ops: string[];
  createSupported: boolean;
  requestExamples: Record<string, unknown>;
  responseShape: string;
  notes: string[];
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    tool: "excel",
    summary: "Read, create and update an Excel workbook (.xlsx / .xlsm).",
    extensions: [".xlsx", ".xlsm"],
    ops: ["read", "create", "update"],
    createSupported: true,
    requestExamples: {
      read: { op: "read", path: "reports/q3.xlsx", sheet: "Summary", range: "A1:D20" },
      create: { op: "create", path: "out/new.xlsx", sheets: [{ name: "Sheet1", rows: [["name", "score"], ["ada", 42]] }] },
      update: { op: "update", path: "out/new.xlsx", edits: [{ sheet: "Sheet1", cell: "B2", value: 43 }], overwrite: true },
    },
    responseShape:
      "read -> { ok, relPath, format, sheets: [{ name, rowCount, colCount, rows, truncated }], truncated }",
    notes: [
      "Cell values are string | number | boolean | null. Formulas are preserved but never evaluated — a cell holding a formula reads back as its cached value.",
      "create writes inline strings (c t=inlineStr), not a shared-string table; a reader must accept both.",
      "update is a bounded read-modify-write of the touched worksheet parts only; charts, styles and pivot tables survive untouched.",
      "Macro-enabled workbooks (xl/vbaProject.bin) are readable but refused on update with unsupported_feature.",
    ],
  },
  {
    tool: "word",
    summary: "Read, create and update a Word document (.docx / .docm).",
    extensions: [".docx", ".docm"],
    ops: ["read", "create", "update"],
    createSupported: true,
    requestExamples: {
      read: { op: "read", path: "docs/spec.docx", includeOutline: true },
      create: { op: "create", path: "docs/new.docx", paragraphs: [{ text: "Title", style: "Heading1" }, { text: "Body" }] },
      update: { op: "update", path: "docs/spec.docx", append: [{ text: "Appendix", style: "Heading1" }], overwrite: true },
    },
    responseShape: "read -> { ok, relPath, format, paragraphs: [{ index, style, text }], outline?, truncated }",
    notes: [
      "Paragraph text is the concatenation of the w:t runs inside each w:p block; a paragraph's style id comes from the w:pStyle element.",
      "update supports append, replace (find/replace text) and insertAfter (paragraph index, applied back-to-front so indices stay valid).",
      "Only word/document.xml is rewritten; headers, footers, styles.xml and media keep their original bytes.",
    ],
  },
  {
    tool: "pdf",
    summary: "Read, create and update a PDF (.pdf).",
    extensions: [".pdf"],
    ops: ["read", "create", "update"],
    createSupported: true,
    requestExamples: {
      read: { op: "read", path: "out/notes.pdf", maxPages: 20 },
      create: { op: "create", path: "out/notes.pdf", pages: [{ text: "Hello" }], metadata: { title: "Notes" } },
      update: { op: "update", path: "out/notes.pdf", appendPages: [{ text: "More" }], overwrite: true },
    },
    responseShape:
      "read -> { ok, relPath, pageCount, pages: [{ index, text, textTruncated }], metadata, hasTextLayer, truncated }",
    notes: [
      "Encrypted PDFs return password_protected; PDFs using cross-reference or object streams return unsupported_feature. Neither is ever brute-forced or guessed.",
      "Extracted text comes from Tj/TJ operators in the page content stream; a scanned PDF has hasTextLayer: false and empty page text.",
      "create emits a fresh PDF with a classic xref table. Text is WinAnsi (non-ASCII becomes a question mark), wrapped at 88 columns.",
      "mergeFrom returns unsupported_feature in protocol version 1 — merging object graphs needs full reference renumbering.",
    ],
  },
  {
    tool: "image",
    summary: "Read, create and update a PNG or JPEG image.",
    extensions: [".png", ".jpg", ".jpeg"],
    ops: ["read", "create", "update"],
    createSupported: true,
    requestExamples: {
      read: { op: "read", path: "assets/logo.png", includeExif: true },
      create: { op: "create", path: "assets/px.png", format: "png", width: 64, height: 64, background: "#3366cc" },
      update: { op: "update", path: "assets/logo.png", setMetadata: { format: "png" }, overwrite: true },
    },
    responseShape: "read -> { ok, relPath, format, width, height, hasAlpha, colorType, bitDepth, exif? }",
    notes: [
      "EXIF is returned only when includeExif is true (GPS and device identifiers are not surfaced by default).",
      "create supports PNG only. A request for format jpg returns unsupported_feature rather than silently writing a PNG.",
      "Dimensions are validated against an 80,000,000-pixel ceiling before any pixel buffer is allocated (decompression-bomb guard).",
      "JPEG dimensions come from the first SOFn marker; PNG dimensions from IHDR.",
    ],
  },
  {
    tool: "slides",
    summary: "Read, create and update a PowerPoint deck (.pptx / .pptm).",
    extensions: [".pptx", ".pptm"],
    ops: ["read", "create", "update"],
    createSupported: true,
    requestExamples: {
      read: { op: "read", path: "deck/kickoff.pptx" },
      create: { op: "create", path: "deck/kickoff.pptx", slides: [{ title: "Kickoff", bullets: ["Scope", "Timeline"] }] },
      update: { op: "update", path: "deck/kickoff.pptx", slide: 1, setText: [{ text: "Renamed" }], overwrite: true },
    },
    responseShape: "read -> { ok, relPath, format, slideCount, slides: [{ index, title, texts }], truncated }",
    notes: [
      "Slide order comes from the presentation part's sldIdLst, resolved through its relationships file — not from filename ordering.",
      "A slide's title is the text of the shape whose placeholder carries type title or ctrTitle; it falls back to the first text shape.",
      "update replaces the first paragraph's text of the Nth text-bearing shape on the named slide (1-based).",
    ],
  },
  {
    tool: "video",
    summary: "Read container metadata for a video file, or replace it wholesale.",
    extensions: [".mp4", ".mov", ".webm", ".mkv", ".avi"],
    ops: ["read", "update"],
    createSupported: false,
    requestExamples: {
      read: { op: "read", path: "media/demo.mp4" },
      update: { op: "update", path: "media/demo.mp4", copyFrom: "media/replacement.mp4", overwrite: true },
    },
    responseShape:
      "read -> { ok, relPath, container, durationMs?, width?, height?, videoCodec?, audioCodec?, bitrateKbps?, bytes, parseWarnings }",
    notes: [
      "There is no create op and no transcoding: encoding video requires a codec library this surface deliberately does not ship.",
      "update with copyFrom is a whole-file replacement. The source is containment-checked and magic-byte sniffed exactly like the destination.",
      "Only container structure is walked (ISO-BMFF boxes, EBML elements, RIFF chunks). No frame is ever decoded, so no decoder is exposed to hostile input.",
      "An unrecognised container returns unsupported_format. Partial metadata is not an error: unreadable fields are omitted and noted in parseWarnings.",
    ],
  },
];

export interface RoundtripCase {
  id: string;
  tool: FormatFamily;
  intent: string;
  steps: Record<string, unknown>[];
  expect: Record<string, unknown>;
}

/** Executable, language-neutral conformance cases. Each is one tool conversation. */
export const ROUNDTRIP_CASES: RoundtripCase[] = [
  {
    id: "excel-create-read-update",
    tool: "excel",
    intent: "Create a workbook, read it back, then change one cell.",
    steps: [
      { op: "create", path: "book.xlsx", sheets: [{ name: "Sheet1", rows: [["name", "score"], ["ada", 42]] }] },
      { op: "read", path: "book.xlsx" },
      { op: "update", path: "book.xlsx", edits: [{ sheet: "Sheet1", cell: "B2", value: 43 }], overwrite: true },
      { op: "read", path: "book.xlsx" },
    ],
    expect: { finalSheetName: "Sheet1", finalCellB2: 43, finalCellA2: "ada" },
  },
  {
    id: "excel-overwrite-guard",
    tool: "excel",
    intent: "A second create without overwrite must be refused, not silently applied.",
    steps: [
      { op: "create", path: "dup.xlsx", sheets: [{ name: "S", rows: [[1]] }] },
      { op: "create", path: "dup.xlsx", sheets: [{ name: "S", rows: [[2]] }] },
    ],
    expect: { lastError: "overwrite_refused" },
  },
  {
    id: "word-create-append",
    tool: "word",
    intent: "Create a document with a heading, then append a paragraph.",
    steps: [
      { op: "create", path: "doc.docx", paragraphs: [{ text: "Title", style: "Heading1" }, { text: "Body" }] },
      { op: "read", path: "doc.docx", includeOutline: true },
      { op: "update", path: "doc.docx", append: [{ text: "Tail" }], overwrite: true },
      { op: "read", path: "doc.docx" },
    ],
    expect: { initialParagraphs: ["Title", "Body"], outlineFirst: "Title", finalParagraphsInclude: "Tail" },
  },
  {
    id: "word-replace-text",
    tool: "word",
    intent: "Find/replace inside a paragraph.",
    steps: [
      { op: "create", path: "r.docx", paragraphs: [{ text: "hello world" }] },
      { op: "update", path: "r.docx", replace: [{ find: "world", replace: "there" }], overwrite: true },
      { op: "read", path: "r.docx" },
    ],
    expect: { finalParagraphs: ["hello there"] },
  },
  {
    id: "pdf-create-read-append",
    tool: "pdf",
    intent: "Create a one-page PDF, read its text layer, append a page.",
    steps: [
      { op: "create", path: "n.pdf", pages: [{ text: "first page" }], metadata: { title: "Notes" } },
      { op: "read", path: "n.pdf" },
      { op: "update", path: "n.pdf", appendPages: [{ text: "second page" }], overwrite: true },
      { op: "read", path: "n.pdf" },
    ],
    expect: { initialPageCount: 1, hasTextLayer: true, initialTextContains: "first page", finalPageCount: 2 },
  },
  {
    id: "pdf-encrypted-refused",
    tool: "pdf",
    intent: "An /Encrypt entry must be reported as password_protected.",
    steps: [{ op: "read", path: "locked.pdf" }],
    expect: { lastError: "password_protected" },
  },
  {
    id: "image-create-read",
    tool: "image",
    intent: "Create a solid PNG and read its dimensions.",
    steps: [
      { op: "create", path: "px.png", format: "png", width: 8, height: 5, background: "#3366cc" },
      { op: "read", path: "px.png" },
    ],
    expect: { format: "png", width: 8, height: 5, exifAbsent: true },
  },
  {
    id: "image-jpeg-create-refused",
    tool: "image",
    intent: "JPEG creation must fail loudly rather than emit a mislabelled PNG.",
    steps: [{ op: "create", path: "photo.jpg", format: "jpg", width: 4, height: 4 }],
    expect: { lastError: "unsupported_feature" },
  },
  {
    id: "slides-create-read-update",
    tool: "slides",
    intent: "Create a two-slide deck, read titles, rename the first slide.",
    steps: [
      {
        op: "create",
        path: "deck.pptx",
        slides: [{ title: "Intro", bullets: ["one", "two"] }, { title: "Second", bullets: ["three"] }],
      },
      { op: "read", path: "deck.pptx" },
      { op: "update", path: "deck.pptx", slide: 1, setText: [{ text: "Renamed" }], overwrite: true },
      { op: "read", path: "deck.pptx" },
    ],
    expect: { slideCount: 2, firstTitleInitial: "Intro", firstTitleFinal: "Renamed" },
  },
  {
    id: "video-create-refused",
    tool: "video",
    intent: "There is no create op — encoding is out of scope.",
    steps: [{ op: "create", path: "a.mp4" }],
    expect: { lastError: "invalid_input" },
  },
  {
    id: "video-read-mp4",
    tool: "video",
    intent: "Read container metadata from a minimal ISO-BMFF file without throwing.",
    steps: [{ op: "read", path: "clip.mp4" }],
    expect: { container: "mp4", parseWarningsIsArray: true },
  },
  {
    id: "security-format-mismatch",
    tool: "pdf",
    intent: "A PNG renamed to .pdf must be rejected on magic bytes, not parsed as a PDF.",
    steps: [{ op: "read", path: "notreally.pdf" }],
    expect: { lastError: "format_mismatch" },
  },
  {
    id: "security-workspace-escape",
    tool: "excel",
    intent: "A path escaping the workspace must be refused before any I/O.",
    steps: [{ op: "read", path: "../outside.xlsx" }],
    expect: { lastError: "workspace_escape" },
  },
  {
    id: "security-overwrite-refused",
    tool: "word",
    intent: "update without overwrite true must not replace an existing file.",
    steps: [
      { op: "create", path: "keep.docx", paragraphs: [{ text: "original" }] },
      { op: "update", path: "keep.docx", append: [{ text: "nope" }] },
    ],
    expect: { lastError: "overwrite_refused" },
  },
];

export interface DependencyEntry {
  name: string;
  version: string;
  role: string;
  license: string;
  required: boolean;
}

/**
 * The pinned allowlist (tradeoff T1). A porting program must be able to
 * implement the same behaviour with these classes of dependency, or with none at
 * all — nothing here is a document-format library.
 */
export const DEPENDENCIES: DependencyEntry[] = [
  {
    name: "zod",
    version: "^4.4.3",
    role: "request schema validation (discriminated union on op)",
    license: "MIT",
    required: true,
  },
  {
    name: "zlib",
    version: "language builtin",
    role: "DEFLATE for OOXML parts and PNG IDAT",
    license: "builtin",
    required: true,
  },
  {
    name: "sha256",
    version: "language builtin",
    role: "digest of written bytes (integrity reporting, not authentication)",
    license: "builtin",
    required: true,
  },
  {
    name: "filesystem",
    version: "language builtin",
    role: "contained reads and temp-then-rename writes",
    license: "builtin",
    required: true,
  },
];

export const DELIBERATE_OMISSIONS: string[] = [
  "No document library (no exceljs, docx, pdf-lib, pdf-parse, sharp, jimp, pptxgenjs, ffmpeg). Every format is read and written through the small, auditable code paths described here.",
  "No subprocesses: never shell out to libreoffice, ImageMagick, ffmpeg or similar. A porting program must not require those binaries either.",
  "No codec work: video is read as container metadata only, never decoded or re-encoded.",
  "No format conversion: a mismatch is an error (format_mismatch), never a silent conversion.",
  "No password handling: encrypted documents are reported as password_protected and left alone.",
];
