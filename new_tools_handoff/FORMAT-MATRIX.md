# Format matrix

Extensions are **hints**. Every read and update sniffs the leading bytes and refuses
on mismatch (`format_mismatch`) rather than trusting the declared extension.

| tool | extensions | ops |
| --- | --- | --- |
| `excel` | `.xlsx` `.xlsm` | read, create, update |
| `word` | `.docx` `.docm` | read, create, update |
| `pdf` | `.pdf` | read, create, update |
| `image` | `.png` `.jpg` `.jpeg` | read, create, update |
| `slides` | `.pptx` `.pptm` | read, create, update |
| `video` | `.mp4` `.mov` `.webm` `.mkv` `.avi` | read, update |

## Deliberate omissions

- No document library (no exceljs, docx, pdf-lib, pdf-parse, sharp, jimp, pptxgenjs, ffmpeg). Every format is read and written through the small, auditable code paths described here.
- No subprocesses: never shell out to libreoffice, ImageMagick, ffmpeg or similar. A porting program must not require those binaries either.
- No codec work: video is read as container metadata only, never decoded or re-encoded.
- No format conversion: a mismatch is an error (format_mismatch), never a silent conversion.
- No password handling: encrypted documents are reported as password_protected and left alone.
