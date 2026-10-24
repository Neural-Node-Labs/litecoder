# Document & media tools — porting handoff

Handoff **v1.0.0**, protocol **v1**, from `Neural-Node-Labs/litecoder` @ `5769b4e` (3.0.2).

This directory is a **drop-in specification** for adding Excel, Word, PDF, PNG/JPEG, PowerPoint
and video tools to another program. It is deliberately language-neutral: the contract is JSON
Schema plus declarative test cases, and the TypeScript in the source repository is only one
reference implementation of it.

## Read in this order

1. `TOOL-CONTRACT.md` — the six tools, their request/response shapes, the shared pipeline and the error enum.
2. `FORMAT-MATRIX.md` / `FORMAT-MATRIX.json` — extensions, ops and capabilities per tool.
3. `schemas/*.tool.json` — machine-readable request schemas; validate against these, not against prose.
4. `schemas/common.result.json` — the result envelope every tool returns.
5. `tests/roundtrip-cases.json` — executable conformance cases; the port is done when these pass.
6. `PORTING-CHECKLIST.md` — the full acceptance list, in dependency order.
7. `DEPENDENCIES.json` — the pinned allowlist, and why it is small.

## The six tools

| tool | extensions | ops |
| --- | --- | --- |
| `excel` | .xlsx, .xlsm | read, create, update |
| `word` | .docx, .docm | read, create, update |
| `pdf` | .pdf | read, create, update |
| `image` | .png, .jpg, .jpeg | read, create, update |
| `slides` | .pptx, .pptm | read, create, update |
| `video` | .mp4, .mov, .webm, .mkv, .avi | read, update |

## The five non-negotiables

1. **Validate before parse.** Request → schema → adapter. Nothing unvalidated reaches a parser.
2. **Magic bytes beat extensions.** Every read/update sniffs and refuses on mismatch.
3. **Contain every path.** Resolve inside the workspace; refuse `..`, absolute paths and escaping symlinks.
4. **Fail closed on size.** Entry counts, inflate totals, pixels, cells and wall-clock all have ceilings.
5. **Never write without consent.** Temp-then-rename, and `overwrite: true` is required to replace a file.

## What this handoff deliberately does not include

- No document library (no exceljs, docx, pdf-lib, pdf-parse, sharp, jimp, pptxgenjs, ffmpeg). Every format is read and written through the small, auditable code paths described here.
- No subprocesses: never shell out to libreoffice, ImageMagick, ffmpeg or similar. A porting program must not require those binaries either.
- No codec work: video is read as container metadata only, never decoded or re-encoded.
- No format conversion: a mismatch is an error (format_mismatch), never a silent conversion.
- No password handling: encrypted documents are reported as password_protected and left alone.

## Provenance

`VERSION.json` pins the source commit. `reference-impl/NOTES.md` maps each module in the
reference implementation to the part of the contract it satisfies, so a port can be reviewed
side by side rather than inferred.
