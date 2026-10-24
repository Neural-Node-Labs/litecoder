# Tool contract

Six tools, one protocol. Dispatch envelope (identical to every other tool in the host program):

```json
{ "tool": "<tool name>", "ok": true, "output": <result> }
```

`ok` is false whenever `output.ok` is false. Dispatch never throws.

## Error codes

- `workspace_escape`
- `file_not_found`
- `read_error`
- `write_error`
- `format_mismatch`
- `unsupported_format`
- `corrupt_input`
- `invalid_input`
- `invalid_op`
- `limit_exceeded`
- `overwrite_refused`
- `password_protected`
- `unsupported_feature`

## Shared pipeline

1. Schema-validate the request before anything else; reject with `invalid_input`.
2. Resolve the path inside the workspace only; reject with `workspace_escape`.
3. Read the bytes, enforce the size ceiling, sniff magic bytes, require the declared extension to match.
4. Run the operation under a unit budget and a wall-clock deadline.
5. Write temp-in-same-directory then rename; refuse unless `overwrite: true` on an existing file.
6. Log a redacted record (tool, op, path, outcome, byte counts) — never contents.

## `excel`

Read, create and update an Excel workbook (.xlsx / .xlsm).

Extensions: .xlsx, .xlsm. Ops: read, create, update.

```text
read -> { ok, relPath, format, sheets: [{ name, rowCount, colCount, rows, truncated }], truncated }
```

Requests:

- `read`: `{"op":"read","path":"reports/q3.xlsx","sheet":"Summary","range":"A1:D20"}`
- `create`: `{"op":"create","path":"out/new.xlsx","sheets":[{"name":"Sheet1","rows":[["name","score"],["ada",42]]}]}`
- `update`: `{"op":"update","path":"out/new.xlsx","edits":[{"sheet":"Sheet1","cell":"B2","value":43}],"overwrite":true}`

Notes:

- Cell values are string | number | boolean | null. Formulas are preserved but never evaluated — a cell holding a formula reads back as its cached value.
- create writes inline strings (c t=inlineStr), not a shared-string table; a reader must accept both.
- update is a bounded read-modify-write of the touched worksheet parts only; charts, styles and pivot tables survive untouched.
- Macro-enabled workbooks (xl/vbaProject.bin) are readable but refused on update with unsupported_feature.

## `word`

Read, create and update a Word document (.docx / .docm).

Extensions: .docx, .docm. Ops: read, create, update.

```text
read -> { ok, relPath, format, paragraphs: [{ index, style, text }], outline?, truncated }
```

Requests:

- `read`: `{"op":"read","path":"docs/spec.docx","includeOutline":true}`
- `create`: `{"op":"create","path":"docs/new.docx","paragraphs":[{"text":"Title","style":"Heading1"},{"text":"Body"}]}`
- `update`: `{"op":"update","path":"docs/spec.docx","append":[{"text":"Appendix","style":"Heading1"}],"overwrite":true}`

Notes:

- Paragraph text is the concatenation of the w:t runs inside each w:p block; a paragraph's style id comes from the w:pStyle element.
- update supports append, replace (find/replace text) and insertAfter (paragraph index, applied back-to-front so indices stay valid).
- Only word/document.xml is rewritten; headers, footers, styles.xml and media keep their original bytes.

## `pdf`

Read, create and update a PDF (.pdf).

Extensions: .pdf. Ops: read, create, update.

```text
read -> { ok, relPath, pageCount, pages: [{ index, text, textTruncated }], metadata, hasTextLayer, truncated }
```

Requests:

- `read`: `{"op":"read","path":"out/notes.pdf","maxPages":20}`
- `create`: `{"op":"create","path":"out/notes.pdf","pages":[{"text":"Hello"}],"metadata":{"title":"Notes"}}`
- `update`: `{"op":"update","path":"out/notes.pdf","appendPages":[{"text":"More"}],"overwrite":true}`

Notes:

- Encrypted PDFs return password_protected; PDFs using cross-reference or object streams return unsupported_feature. Neither is ever brute-forced or guessed.
- Extracted text comes from Tj/TJ operators in the page content stream; a scanned PDF has hasTextLayer: false and empty page text.
- create emits a fresh PDF with a classic xref table. Text is WinAnsi (non-ASCII becomes a question mark), wrapped at 88 columns.
- mergeFrom returns unsupported_feature in protocol version 1 — merging object graphs needs full reference renumbering.

## `image`

Read, create and update a PNG or JPEG image.

Extensions: .png, .jpg, .jpeg. Ops: read, create, update.

```text
read -> { ok, relPath, format, width, height, hasAlpha, colorType, bitDepth, exif? }
```

Requests:

- `read`: `{"op":"read","path":"assets/logo.png","includeExif":true}`
- `create`: `{"op":"create","path":"assets/px.png","format":"png","width":64,"height":64,"background":"#3366cc"}`
- `update`: `{"op":"update","path":"assets/logo.png","setMetadata":{"format":"png"},"overwrite":true}`

Notes:

- EXIF is returned only when includeExif is true (GPS and device identifiers are not surfaced by default).
- create supports PNG only. A request for format jpg returns unsupported_feature rather than silently writing a PNG.
- Dimensions are validated against an 80,000,000-pixel ceiling before any pixel buffer is allocated (decompression-bomb guard).
- JPEG dimensions come from the first SOFn marker; PNG dimensions from IHDR.

## `slides`

Read, create and update a PowerPoint deck (.pptx / .pptm).

Extensions: .pptx, .pptm. Ops: read, create, update.

```text
read -> { ok, relPath, format, slideCount, slides: [{ index, title, texts }], truncated }
```

Requests:

- `read`: `{"op":"read","path":"deck/kickoff.pptx"}`
- `create`: `{"op":"create","path":"deck/kickoff.pptx","slides":[{"title":"Kickoff","bullets":["Scope","Timeline"]}]}`
- `update`: `{"op":"update","path":"deck/kickoff.pptx","slide":1,"setText":[{"text":"Renamed"}],"overwrite":true}`

Notes:

- Slide order comes from the presentation part's sldIdLst, resolved through its relationships file — not from filename ordering.
- A slide's title is the text of the shape whose placeholder carries type title or ctrTitle; it falls back to the first text shape.
- update replaces the first paragraph's text of the Nth text-bearing shape on the named slide (1-based).

## `video`

Read container metadata for a video file, or replace it wholesale.

Extensions: .mp4, .mov, .webm, .mkv, .avi. Ops: read, update.

```text
read -> { ok, relPath, container, durationMs?, width?, height?, videoCodec?, audioCodec?, bitrateKbps?, bytes, parseWarnings }
```

Requests:

- `read`: `{"op":"read","path":"media/demo.mp4"}`
- `update`: `{"op":"update","path":"media/demo.mp4","copyFrom":"media/replacement.mp4","overwrite":true}`

Notes:

- There is no create op and no transcoding: encoding video requires a codec library this surface deliberately does not ship.
- update with copyFrom is a whole-file replacement. The source is containment-checked and magic-byte sniffed exactly like the destination.
- Only container structure is walked (ISO-BMFF boxes, EBML elements, RIFF chunks). No frame is ever decoded, so no decoder is exposed to hostile input.
- An unrecognised container returns unsupported_format. Partial metadata is not an error: unreadable fields are omitted and noted in parseWarnings.
