# Reference implementation notes

The TypeScript under `src/tools/document/` is **one** implementation. Treat it as a worked
example, not as the specification — the contract is the JSON Schema and the round-trip cases.

## Module map

| module | contract section it satisfies |
| --- | --- |
| `types.ts` | AdapterResult / DocErrorCode / OpBudget vocabulary |
| `schemas.ts` | the six public zod request schemas (source of `schemas/*.tool.json`) |
| `limits.ts` | named ceilings and fail-closed guards |
| `format-sniff.ts` | magic-byte detection and extension/format agreement |
| `atomic-write.ts` | temp-then-rename writer and contained reader |
| `ooxml-zip.ts` | bounded ZIP read/write for the three OOXML formats |
| `xml-text.ts` | text-node helpers; no entity or DTD resolution |
| `excel.ts` / `word.ts` / `slides.ts` | OOXML adapters (read / create / update) |
| `pdf.ts` | PDF object-graph reader and writer |
| `image.ts` | PNG encode/decode, PNG+JPEG header parsing |
| `video.ts` | container metadata walkers (ISO-BMFF, EBML, RIFF) |
| `format-registry.ts` | family → extensions, adapter, limits, manifest entry |
| `tool-handler.ts` | the single dispatch target every tool routes through |
| `doc-log.ts` | redacted operation log |

## Sequencing that worked

1. `limits` + `format-sniff` + `atomic-write` first — dependency-free and fully testable.
2. Registry + schemas + handler next, with adapters stubbed to `unsupported_feature`.
   The security contract is then green before any format code exists.
3. Adapters in ascending risk: image → pdf → excel → word → slides → video.
4. Handoff generator and its verifier last.

## Pitfalls found while building this

- Spreadsheet inline strings are the unprefixed `<t>` element, not `<w:t>`. Reusing the Word
  text helper silently returns empty cells — the round-trip test catches this.
- A PDF's xref offsets are byte offsets into the file, not object indices. Numbering objects
  deterministically (catalog=1, pages=2, then page/content pairs) is what keeps them correct.
- ZIP entries may be either stored or deflated; a writer must choose per entry or accept ~3x bloat.
- `update` must read the original first. Writing from the request alone loses every untouched part.
