# Porting checklist

Work top to bottom. Each item is independently verifiable against `tests/roundtrip-cases.json`.

## 1. Contract plumbing

- [ ] Dispatch accepts the six tool names and returns `{ tool, ok, output }` without throwing.
- [ ] A request missing `path` or `op` yields an actionable error naming both fields.
- [ ] Request validation rejects unknown `op` values with `invalid_input`.
- [ ] Every documented value of the error-code enum is reachable and distinct.

## 2. Containment and limits

- [ ] `..` and absolute/UNC paths are refused with `workspace_escape`.
- [ ] Symlinks inside the workspace that resolve outside it are refused.
- [ ] Input, output, entry-count, inflated-size, pixel-count and cell-count ceilings all fail closed.
- [ ] A wall-clock deadline aborts a long operation instead of letting it run.

## 3. Format verification

- [ ] Every read/update sniffs magic bytes (ZIP + OOXML part check, `%PDF-`, PNG signature, `FF D8 FF`, CFB, `ftyp`, EBML, RIFF/AVI).
- [ ] A file whose bytes contradict its extension is refused with `format_mismatch`.
- [ ] An OLE/CFB container behind an OOXML extension is reported as `password_protected`; a legacy `.xls`/`.doc`/`.ppt` as `unsupported_format`.

## 4. Per-tool behaviour

### excel

- [ ] Cell values are string | number | boolean | null. Formulas are preserved but never evaluated — a cell holding a formula reads back as its cached value.
- [ ] create writes inline strings (c t=inlineStr), not a shared-string table; a reader must accept both.
- [ ] update is a bounded read-modify-write of the touched worksheet parts only; charts, styles and pivot tables survive untouched.
- [ ] Macro-enabled workbooks (xl/vbaProject.bin) are readable but refused on update with unsupported_feature.

### word

- [ ] Paragraph text is the concatenation of the w:t runs inside each w:p block; a paragraph's style id comes from the w:pStyle element.
- [ ] update supports append, replace (find/replace text) and insertAfter (paragraph index, applied back-to-front so indices stay valid).
- [ ] Only word/document.xml is rewritten; headers, footers, styles.xml and media keep their original bytes.

### pdf

- [ ] Encrypted PDFs return password_protected; PDFs using cross-reference or object streams return unsupported_feature. Neither is ever brute-forced or guessed.
- [ ] Extracted text comes from Tj/TJ operators in the page content stream; a scanned PDF has hasTextLayer: false and empty page text.
- [ ] create emits a fresh PDF with a classic xref table. Text is WinAnsi (non-ASCII becomes a question mark), wrapped at 88 columns.
- [ ] mergeFrom returns unsupported_feature in protocol version 1 — merging object graphs needs full reference renumbering.

### image

- [ ] EXIF is returned only when includeExif is true (GPS and device identifiers are not surfaced by default).
- [ ] create supports PNG only. A request for format jpg returns unsupported_feature rather than silently writing a PNG.
- [ ] Dimensions are validated against an 80,000,000-pixel ceiling before any pixel buffer is allocated (decompression-bomb guard).
- [ ] JPEG dimensions come from the first SOFn marker; PNG dimensions from IHDR.

### slides

- [ ] Slide order comes from the presentation part's sldIdLst, resolved through its relationships file — not from filename ordering.
- [ ] A slide's title is the text of the shape whose placeholder carries type title or ctrTitle; it falls back to the first text shape.
- [ ] update replaces the first paragraph's text of the Nth text-bearing shape on the named slide (1-based).

### video

- [ ] There is no create op and no transcoding: encoding video requires a codec library this surface deliberately does not ship.
- [ ] update with copyFrom is a whole-file replacement. The source is containment-checked and magic-byte sniffed exactly like the destination.
- [ ] Only container structure is walked (ISO-BMFF boxes, EBML elements, RIFF chunks). No frame is ever decoded, so no decoder is exposed to hostile input.
- [ ] An unrecognised container returns unsupported_format. Partial metadata is not an error: unreadable fields are omitted and noted in parseWarnings.

## 5. Writes

- [ ] Writes go to a temp file in the destination directory and are renamed into place.
- [ ] A failure mid-write leaves the original file byte-identical.
- [ ] An existing file is only replaced with an explicit `overwrite: true`; otherwise `overwrite_refused`.
- [ ] The result reports `bytesWritten` and a sha256 of the written bytes.

## 6. Conformance

- [ ] All 14 cases in `tests/roundtrip-cases.json` pass against the new implementation.
- [ ] Regenerating the handoff produces no diff.
