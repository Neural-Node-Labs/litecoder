<!-- xcoder:version 2 | xcoder:task task-ae8e62 | xcoder:updated 2026-10-30T18:04:25.388Z | xcoder:subtask code-st-f128c5 -->
# Changelog

## [3.1.1]

### Changed

- **`sentinel` is now its own CLI.** `npm install -g litecoder` installs a `sentinel`
  bin (`dist/sentinel/bin.js`) that presents as `sentinel [options]` and owns `--version`.
  `litecoder sentinel …` still works, mounting the identical command definition from
  `src/sentinel/cli.ts`, so the two surfaces cannot drift.
- **`sentinel --config <path>` now reads the file.** The option was registered and
  documented but the action called `loadSentinelConfig(process.env, undefined)`,
  silently ignoring the path. It is now read and passed through; `SENTINEL_ADMIN_IP`
  still comes from the environment.
- **README: usage and Sentinel documented.** Added the `litecoder [options] <goal>`
  synopsis with a full option table and exit codes, plus a `## Sentinel` section with
  quick-start examples (`sentinel --once`, `--no-dry-run`, `--approve <id>`) and a
  pointer to `docs/SENTINEL.md`.
- **README: corrected the `litecoder --config` rows.** That flag is registered only on
  `kooder`/`worker`, never on the root `litecoder` program; the quick-start and usage
  table now attribute it to `kooder --config`.
- Version bumped to **3.1.1** across `package.json`, `src/version.ts`,
  `src/tools/document/handoff-content.ts` and the CLI headers.

## [Unreleased] — Sentinel: the always-on security daemon

### What was added

A new agent on the existing litecoder base: `litecoder sentinel` tails server log
files, asks a model whether each event is suspicious, decides with code-owned policy,
and applies an `iptables`/`netsh` block only after a human approves. Source is
`src/sentinel/` (16 modules + 16 colocated test files). Full write-up in
`docs/SENTINEL.md`; condensed architecture in `.xcoder/blueprint.md` §8–9.

| integration point | file |
| --- | --- |
| `sentinel` subcommand | `src/sentinel/cli.ts` → mounted at `src/litecoder/cli.ts:31,223` |
| SDLC role | `ROLES` (`src/types.ts`) + `ROLE_DIRECTIVES.sentinel` (`src/skills/directives.ts:261`) |
| LLM transport | `createLlmClient('sub_agent')` — reused, not re-implemented |

Ported from the Python reference in `temp/sentinel-ai/` and re-implemented in
TypeScript: iptables/netsh tools → `system-tools.ts`, `SecureFormatter` redaction →
`redaction.ts`, default-DENY + admin-IP safety → `policy-engine.ts`/`policy/rules.ts`
(14 rules, stable audited ids), LangGraph state machine → the explicit cycle in
`daemon.ts`. The ChromaDB RAG policy layer was deliberately **not** ported: nothing
that can write a file next to the daemon should change what the daemon does.

### Why these design choices

- **The model classifies; it never acts.** `ModelAnalysis` has no `targetIp`, `action`,
  `durationMinutes` or `requiresApproval`. `src/sentinel/schema.test.ts` (16 tests)
  proves zod *strips* those keys if a model supplies them. The action surface is a
  closed four-value enum, so an arbitrary shell command is not expressible.
- **Fail closed.** `DEFAULT_DENY_ANALYSIS` is suspicious (`threatDetected: true`,
  `severity: high`) but `confidence: 0`, so a failed analysis can reach a temporary,
  approval-gated action and never a permanent one.
- **DENY precedence by severity, not array position.** Reordering `RULES` cannot weaken
  an outcome; a throwing rule predicate counts as not-matched.
- **Audit before action.** If the audit write fails the firewall is never called.

### Fixed during the test cycle

- **Gate script.** `package.json` had no `regression` script, so the gate command failed
  with `Missing script: "regression"` regardless of test health. Added
  `"regression": "vitest run"`.
- **A correct filter that selected nothing.** vitest positional args are regex filters,
  not globs, so `"src/litecoder/**/*.test.ts"` matched 1 file. Directory filters
  select the intended 28.
- **defect0003 (suite flake, ~1 run in 3).** `loadConfig.ts` calls `applyUserConfig()` at
  import time, leaking the developer’s real `~/.kooder/config.json` key into
  `process.env`; `config-command.test.ts` then skipped the write under test. Fixed with a
  narrow `forgetShellEnvShadow()` seam (production precedence unchanged), `afterEach`
  cleanup, and `delete` instead of restore.
- Verified **defect0001** (`prune()` did not decrement `this.total`) and **defect0002**
  (`isBlocked()` never consulted the firewall) are actually fixed in source; their tests
  are real assertions, not `it.fails`.

### Verification

- `npx vitest run --config vitest.config.ts src/sentinel/ src/skills/sentinel-directive.test.ts`
  → 17 files, 129 tests, 0 failures.
- Full suite: 106 files; 1697 passed | 1 expected fail | 35 skipped (1733).
- `npm run typecheck` enforces the role wiring: `Record<Role, RoleDirective>` will not
  compile until `ROLE_DIRECTIVES.sentinel` exists.

### How to roll back

Delete `src/sentinel/`; remove the `registerSentinelCommand` import/call at
`src/litecoder/cli.ts:31,223`; remove `sentinel` from `ROLES` (`src/types.ts`), its entry
in `ROLE_DIRECTIVES` (`src/skills/directives.ts:261`) and
`src/skills/sentinel-directive.test.ts`. No firewall rule is created at build time, so a
daemon that never runs changes nothing.

---
## [3.0.2] — document & media tools, and the porting handoff

### What was added

**Six new agent tools**, all routed through one handler. `dispatchTool` gained six
thin `case` labels in `src/tools/tool-registry.ts` (`// ── document / media surface ──`)
that all call `handleDocumentTool(root, toolName, input, ctx)`:

| tool | extensions | ops |
| --- | --- | --- |
| `excel` | `.xlsx` `.xlsm` | read, create, update |
| `word` | `.docx` `.docm` | read, create, update |
| `pdf` | `.pdf` | read, create, update |
| `image` | `.png` `.jpg` `.jpeg` | read, create, update |
| `slides` | `.pptx` `.pptm` | read, create, update |
| `video` | `.mp4` `.mov` `.webm` `.mkv` `.avi` | read, update (no create) |

Source lives in `src/tools/document/` (25 modules + 6 test files). The single source of
truth for extensions, ops, limits, descriptions and adapters is
`src/tools/document/format-registry.ts` — adding a format is one row there, not six edits.

**`./new_tools_handoff/`** — a language-neutral porting package so another program can
implement the same surface. 17 generated files: `README.md`, `TOOL-CONTRACT.md`,
`FORMAT-MATRIX.md`/`.json`, `DEPENDENCIES.json`, `PORTING-CHECKLIST.md`, `VERSION.json`,
`schemas/{excel,word,pdf,image,slides,video}.tool.json`, `schemas/common.result.json`,
`tests/roundtrip-cases.json` (14 cases), `tests/fixtures/MANIFEST.json`,
`reference-impl/NOTES.md`. Handoff v1.0.0, protocol v1, source commit `5769b4e`.

Regenerate with `npm run handoff:gen`. Generation is deterministic: 17 files, byte-identical
across consecutive runs (verified by hashing before/after), so CI can enforce
`git diff --exit-code new_tools_handoff/`.

### Why these design choices

- **One handler, six case labels.** Schema validation, path containment, magic-byte
  checking and atomic writes are identical per format. Six copies would be six places for
  the security contract to drift.
- **No document library, no subprocess.** Nothing pulls in exceljs, docx, pdf-lib,
  pdf-parse, sharp, jimp, pptxgenjs or ffmpeg, and nothing shells out to libreoffice or
  ImageMagick. The whole point of the porting package is that the target program does not
  need those binaries either. `DEPENDENCIES.json` pins the allowlist to zod + zlib +
  sha256 + filesystem.
- **Magic bytes beat extensions.** Every read/update sniffs (ZIP+OOXML part check, `%PDF-`,
  PNG signature, `FF D8 FF`, OLE/CFB, `ftyp`, EBML, RIFF/AVI). A contradiction is
  `format_mismatch`, never a silent conversion.
- **Video is metadata only.** Container structure is walked (ISO-BMFF boxes, EBML elements,
  RIFF chunks); no frame is ever decoded, so no codec is exposed to hostile input.
- **Limits fail closed.** 64 MiB in/out, 192 MiB inflated, 4096 ZIP entries, 80,000,000
  pixels (checked before any buffer is allocated), 200,000 cells, 20 s wall clock — plus
  tighter per-family caps in `FAMILY_LIMITS`.

### Fixed during the test cycle

- **defect0001 (medium) — overwrite contract.** `schemas.ts` declared `overwrite:
  z.literal(true)` on the update branches, so an unconfirmed update failed zod validation
  as `invalid_input` and `writeAtomic()` never got the chance to return the documented
  `overwrite_refused`. Update branches now use the same optional boolean as `create`.
  Policy belongs in the code that can see the filesystem, not in a schema declaration.
  Rollback: revert `src/tools/document/schemas.ts` to the literal — but note the published
  handoff case `security-overwrite-refused` will then fail.
- **defect0003 (medium) — untestable security test.** `src/config/project-config-trust.test.ts`
  called `process.chdir()`, which Node forbids under the configured `vmThreads` pool, so
  that test could never pass. Replaced with a `process.cwd()` spy and a full environment
  snapshot/restore (including `USERPROFILE`, which is what `os.homedir()` reads on Windows).
- **Stale updater assertion.** `src/updater/index.test.ts` expected the pre-rebrand
  `xcoder-updater/` User-Agent; the source says `kooder-updater/`. Expectation corrected.
  Release *asset* names remain `xcoder-*` and those assertions were left alone deliberately.

### Known open issue

**defect0002 (medium, partial).** `src/version.ts` says it is auto-generated by
`scripts/inject-version.mjs` — that script exists in neither the working tree nor git
history. `KOODER_VERSION` had drifted to `3.0.0` while `package.json` said `3.0.2`; it is
corrected to `3.0.2` and `handoff.conformance.test.ts` now asserts the two agree.
**The drift will recur on the next version bump** until the generator exists or the version
is read from `package.json`. That is a release-process fix, owned outside this change.

### Verification

- `src/tools/document/`: 29 files, 573 passed | 1 expected fail | 4 skipped (578).
- Full suite: 87 passed | 1 skipped test files (88); 1564 passed | 1 expected fail | 35 skipped (1600).
- `npm run typecheck && npm run build` → exit 0.

### How to roll back

Delete `src/tools/document/` and `new_tools_handoff/`, and remove the six `case` labels and
the `handleDocumentTool` import from `src/tools/tool-registry.ts`. Nothing else imports the
surface, and no other tool's behaviour depends on it — the package builds without it. Revert
`schemas.ts` separately only if you also revert the handoff (see defect0001 above).

See `.xcoder/blueprint.md` for the current architecture, the contract-change procedure and
the full bylaw mapping.
