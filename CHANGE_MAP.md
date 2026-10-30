<!-- xcoder:version 4 | xcoder:task litecoder-1793381927596 | xcoder:updated 2026-10-30T17:41:52.411Z | xcoder:subtask inspect-cli-structure -->
# Change map — standalone `sentinel` command + version bump to 3.1.1

Status: design/inspection only. **No source file was modified by this task.**
Every claim below was read from the workspace, with file and line references.

---

## 1. Stack and package facts (verified)

| fact | value | source |
|---|---|---|
| package name | `litecoder` | `package.json:2` |
| package version | `3.1.0` in the working tree; **`3.0.2` in HEAD** — the bump is uncommitted (`git diff` shows `package.json:3` changed `3.0.2` → `3.1.0`, plus `docs/SENTINEL.md:4` and 10 lines appended to `.gitignore`) | `package.json:3`, `git diff HEAD` |
| module type | ESM (`"type": "module"`) | `package.json:15` |
| node engine | `>=20` | `package.json` engines |
| package manager | npm (`package-lock.json` present, npm-style scripts) | `package-lock.json` |
| test runner | vitest 4.x, `include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']` | `vitest.config.ts:5` |
| build | `npm run clean && tsc -p tsconfig.build.json` → `dist/**` | `package.json` scripts |
| typecheck | `tsc --noEmit -p tsconfig.json` | `package.json` scripts |
| tests | `npm test` → `vitest run` (`regression` is an alias) | `package.json` scripts |

`tsconfig.build.json` has `"include": ["src/**/*.ts"]` and excludes only `*.test.ts`, so **any new `src/**/bin.ts` is compiled to `dist/` with no config change**.

### Current `bin` map (`package.json:28-32`)

```json
"bin": {
  "litecoder": "./dist/litecoder/cli.js",
  "kooder":    "./dist/cli-worker.js",
  "worker":    "./dist/cli-worker.js"
}
```

## 2. CLI entry points and argument dispatch

| entry file | bin(s) | dispatch |
|---|---|---|
| `src/cli-worker.ts` (317 lines, `#!/usr/bin/env node`) | `kooder`, `worker` | `commander` `program.name("kooder")` + one `run` subcommand (`:136-175`); `.version(KOODER_VERSION)` at `:142` |
| `src/litecoder/cli.ts` (229 lines, `#!/usr/bin/env node`) | `litecoder` | root program named `litecoder` with a **positional goal** (`program.argument("[goal]")`, `:70`), options `:71-100`, one `.action()`. `.version(KOODER_VERSION)` at `:69`. The `sentinel` subcommand is mounted at the bottom: import `:31`, `registerSentinelCommand(program)` `:223` |

Both entries begin with `import "./config/loadConfig.js"` (`src/litecoder/cli.ts:10`, `src/cli-worker.ts:9`) — the *filtered* `.env` loader. A new bin must do the same or `SENTINEL_*`/provider env from a project `.env` will silently not load.

## 3. Where Sentinel lives today

Source: `src/sentinel/` — 16 non-test modules + 16 colocated `*.test.ts`.

| piece | file | note |
|---|---|---|
| CLI registration | `src/sentinel/cli.ts` (61 lines) | exports `registerSentinelCommand(program: Command): void`; calls `program.command('sentinel')` and attaches `--no-dry-run`, `--once`, `--approve <id>`, `--deny <id>`, `--config <path>` + the `.action()` handler |
| wiring/deps | `src/sentinel/run.ts` (142 lines) | `buildDeps(config, clock)` `:42`, `runSentinel(opts): Promise<number>` `:106` |
| config | `src/sentinel/config.ts:99` | `loadSentinelConfig(env, fileText?)`; `SentinelConfig` at `:16` |
| daemon loop | `src/sentinel/daemon.ts` | `SentinelDaemon.start(signal)` |
| role wiring | `src/types.ts` (`ROLES`), `src/skills/directives.ts:261` (`ROLE_DIRECTIVES.sentinel`) | `Record<Role, RoleDirective>` makes typecheck enforce it |

**Sentinel is exposed only as `litecoder sentinel`.** No standalone bin, no `src/sentinel/bin.ts`, and no test spawns a `sentinel` binary (grep for `registerSentinelCommand` returns exactly two hits: the definition and the mount).

### Two pre-existing gaps found while reading (do not fix silently)

1. `src/sentinel/cli.ts:31` calls `loadSentinelConfig(process.env, undefined)` — the documented `--config <path>` flag is registered but **never read**. `SentinelCliOptions.config` is dead.
2. `src/sentinel/cli.ts:52,56` hardcode the error prefix `'litecoder sentinel: '`. A standalone `sentinel` bin should not print `litecoder sentinel:`.

## 4. Proposed standalone command

- **Command name:** `sentinel` (matches the subcommand verb, the docs title, and `src/sentinel/`)
- **New entry file:** `src/sentinel/bin.ts` → **bin target** `./dist/sentinel/bin.js`
- **Why a new file and not `dist/sentinel/cli.js`:** `src/sentinel/cli.ts` is a *registration module* — it exports a function, has no shebang, no `parseAsync`, no `main`. Pointing a bin at it launches a process that parses nothing and exits 0 silently. Keeping them separate also means importing the definition never triggers a parse as a side effect.

### Shared-code approach (no duplication)

Refactor `src/sentinel/cli.ts` from "attach to someone else's program" to "own a Command, then attach":

```ts
// src/sentinel/cli.ts  (refactor)
export interface SentinelCliOptions { dryRun?: boolean; once?: boolean; approve?: string; deny?: string; config?: string; }

/** Single source of truth for the `sentinel` command surface. */
export function createSentinelCommand(opts: { standalone?: boolean } = {}): Command {
  const cmd = new Command('sentinel')
    .description('Run the always-on security daemon that monitors logs, or answer its approval requests.')
    .option('--no-dry-run', 'Actually apply firewall blocks (default is dry-run: log-only)')
    .option('--once', 'Run a single monitoring cycle and exit (smoke test)', false)
    .option('--approve <id>', 'Grant the pending approval for a decision id')
    .option('--deny <id>', 'Deny the pending approval for a decision id')
    .option('--config <path>', 'Path to a JSON config file (env still applies)')
    .action(async (o: SentinelCliOptions) => { /* body moved verbatim from today's .action */ });

  if (opts.standalone) cmd.version(KOODER_VERSION);   // only standalone owns --version
  return cmd;
}

/** Back-compat: `litecoder sentinel` keeps working unchanged. */
export function registerSentinelCommand(program: Command): void {
  program.addCommand(createSentinelCommand());
}
```

```ts
#!/usr/bin/env node
// src/sentinel/bin.ts — standalone `sentinel` entry point.
import '../config/loadConfig.js';            // filtered .env, same as the other bins
import { createSentinelCommand } from './cli.js';

createSentinelCommand({ standalone: true })
  .parseAsync(process.argv)
  .catch((e: unknown) => {
    process.stderr.write(`sentinel: ${(e as Error)?.message ?? String(e)}\n`);
    process.exitCode = 2;
  });
```

`src/litecoder/cli.ts` is untouched at the call site (`:223` still calls `registerSentinelCommand(program)`), so `litecoder sentinel --once` / `--approve <id>` keep working.

**Why `addCommand` instead of a second option block:** commander can attach an already-built `Command` as a subcommand, keeping one option list, one `.action()`, one help string. The alternative duplicates five option strings and the approve/deny branch — exactly the drift this repo already fought once (`CHANGELOG.md:146-147`: `KOODER_VERSION` drifting from `package.json`).

**Error-prefix handling:** add `{ programLabel?: string }` to `createSentinelCommand`, default `'litecoder sentinel'`, and pass `'sentinel'` from the bin. *Tradeoff:* a parameter is uglier than deriving it from `cmd.parent`, but it keeps the existing `litecoder sentinel:` string stable for anyone scraping logs, and the difference is one visible line.

## 5. Every file that must change for 3.1.1 (and the new bin)

### A. Version bump — 5 hand-edited locations + 1 generated

| # | file | line | now | must be | why |
|---|---|---|---|---|---|
| 1 | `package.json` | 3 | `"version": "3.1.0"` (uncommitted edit; HEAD = `3.0.2`) | `"3.1.1"` | package truth |
| 2 | `package-lock.json` | 3 | `"version": "3.0.0"` | `"3.1.1"` | already drifted; `npm install --package-lock-only` fixes both lock spots |
| 3 | `package-lock.json` | 9 (`packages[""].version`) | `"3.0.0"` | `"3.1.1"` | same |
| 4 | `src/version.ts` | 3 | `KOODER_VERSION = "3.0.2"` | `"3.1.1"` | what `--version` prints on every bin |
| 5 | `src/tools/document/handoff-content.ts` | 20 | `SOURCE_VERSION = "3.0.2"` | `"3.1.1"` | handoff must describe the shipped version |
| 6 | `new_tools_handoff/VERSION.json` | `sourceVersion` | `"3.0.2"` | regenerate | **generated artifact — do not hand-edit**; run `npm run handoff:gen` after #5 |

Do **not** touch: `handoff-content.ts:19` `SOURCE_COMMIT = "5769b4e"` (deliberately pinned), nor `HANDOFF_VERSION`/`PROTOCOL_VERSION` (independent of the package version).

`src/version.ts:2` claims `AUTO-GENERATED by scripts/inject-version.mjs — DO NOT EDIT`, but **no `scripts/` directory exists in this workspace** (glob `scripts/**` returns nothing; `handoff:gen` is the only real codegen script). Treat `src/version.ts` as hand-edited here and correct the stale comment.

### B. Docs

| file | line(s) | change |
|---|---|---|
| `README.md` | 31-33 | "Three bins are installed…" → four; add `sentinel` (log-monitoring daemon, see `docs/SENTINEL.md`) |
| `README.md` | 176-190 | add a short `## Sentinel` section (or a pointer) showing `sentinel --once` / `sentinel --approve <id>` |
| `docs/SENTINEL.md` | 4 | `shipped in \`litecoder\` 3.1.0 … CLI \`litecoder sentinel\`` → `3.1.1`, `CLI \`sentinel\` (also \`litecoder sentinel\`)` |
| `docs/SENTINEL.md` | 24 | integration row: `src/sentinel/cli.ts` → `registerSentinelCommand(program)` becomes `createSentinelCommand()` + `src/sentinel/bin.ts` |
| `docs/SENTINEL.md` | 172-176 | `litecoder sentinel --approve <id>` examples → `sentinel --approve <id>` (keep the subcommand as an alias) |
| `CHANGELOG.md` | after line 1 | new `## [3.1.1] — standalone \`sentinel\` command`; fold in or date the existing `## [Unreleased] — Sentinel…` block |

### C. package.json `bin` + scripts

| `package.json` line | change |
|---|---|
| 28-32 (`bin`) | add `"sentinel": "./dist/sentinel/bin.js"` |
| ~47 (scripts) | optional dev parity: `"dev:sentinel": "tsx src/sentinel/bin.ts"` |

### D. Tests that WILL break and must be updated

Both assert the bin set **exactly**, so a fourth bin is a red build until amended. The assertions' real intent ("no pre-rebrand `koober` alias survives") is preserved.

| file | line(s) | current assertion | change |
|---|---|---|---|
| `src/agents/kooder-rebrand.test.ts` | 132 | `expect(Object.keys(pkg.bin).sort()).toEqual(['kooder','litecoder','worker'])` | add `'sentinel'`, plus `expect(pkg.bin.sentinel).toBe('./dist/sentinel/bin.js')` |
| `src/agents/worker-only-architecture.test.ts` | 86-94 | same exact-list assertion (`:93`) | same edit; extend the `:88-92` comment to cover `sentinel` |
| `src/cli-worker.test.ts` | 191 | `expect(pkg.bin.worker).toBe(...)` | **no change** — asserts one key, not the set |

### E. Files that need NO change (verified)

- `src/litecoder/cli.ts` — import `:31` / call `:223` keep working through the back-compat wrapper.
- `tsconfig.json` / `tsconfig.build.json` — `src/**/*.ts` already covers `src/sentinel/bin.ts`.
- `vitest.config.ts` — `src/**/*.test.ts` already covers any new colocated test.
- `.github/workflows/npm-publish.yml` — runs `npm test` only, no version literal.

### F. New test worth adding (recommended)

`src/sentinel/bin.test.ts` — spawn `node --import tsx src/sentinel/bin.ts --help` (mirroring `kooder-rebrand.test.ts:37-43`); assert `Usage: sentinel [options]`, status 0, and `--version` equals `KOODER_VERSION`. No network, no LLM.

## 6. Verification commands

```bash
# 1. Baseline evidence (already run by this task; 2 failures)
npx vitest run src/agents/kooder-rebrand.test.ts src/tools/document/handoff.conformance.test.ts

# 2. After the version bump + bin additions
npx vitest run src/agents/kooder-rebrand.test.ts src/agents/worker-only-architecture.test.ts src/tools/document/handoff.conformance.test.ts src/tools/document/handoff.contract.test.ts src/cli-worker.test.ts src/cli-worker.config.test.ts

# 3. Sentinel suite untouched by the refactor
npx vitest run src/sentinel/ src/skills/sentinel-directive.test.ts

# 4. Regenerate the handoff, then prove it is reproducible
npm run handoff:gen
git diff --exit-code new_tools_handoff/

# 5. Smoke the new entry point from source, then from the real build
node --import tsx src/sentinel/bin.ts --help
npm run build && node dist/sentinel/bin.js --help && node dist/sentinel/bin.js --version

# 6. Gate
npm run typecheck && npm test
```

**Expected `--version` output:** `3.1.1` on `litecoder`, `kooder`, `worker` and `sentinel` — all four read the same `KOODER_VERSION`.

## 7. Tradeoffs made (read before implementing)

1. **One command object, two mounts** (`createSentinelCommand()` + `addCommand`) over two option blocks. *Cost:* one indirection and a `standalone` flag. *Benefit:* the five flags and the approve/deny branch exist once; a future flag cannot be added to one surface and forgotten on the other.
2. **New `src/sentinel/bin.ts` rather than reusing `src/sentinel/cli.ts` as the bin target.** *Cost:* a ~12-line file. *Benefit:* `dist/sentinel/cli.js` stays a pure library module, so importing it in a test cannot accidentally parse `process.argv`.
3. **`.version()` only on the standalone command.** *Cost:* `litecoder sentinel --version` stays an unknown option. *Benefit:* no duplicate root-vs-subcommand version semantics; `litecoder --version` remains the single answer for the planner. One-line move if that is wanted.
4. **Keeping the `litecoder sentinel` mount instead of deleting it.** *Cost:* two documented ways to do one thing. *Benefit:* zero breakage for existing users, and the rollback note at `CHANGELOG.md:67-68` stays accurate.
5. **Amending two brand/architecture tests to include `sentinel` in the expected bin set.** *Cost:* touching tests that read as guards. *Benefit:* leaving them red is worse, and deleting them would drop the `koober`-alias guard. The alternative (no bin, only `litecoder sentinel`) is cheaper but does not satisfy the standalone-command goal.
6. **`--config <path>` is still not wired** (`src/sentinel/cli.ts:31` passes `undefined`). Out of scope; flagged so the implementer does not change daemon behaviour silently inside a version-bump task.

## 8. Baseline failures observed before any change

`npx vitest run src/agents/kooder-rebrand.test.ts src/tools/document/handoff.conformance.test.ts` → **2 failed**, both version-drift assertions:

- `kooder-rebrand.test.ts › keeps package.json version in lockstep with KOODER_VERSION` — `package.json` is `3.1.0`, `KOODER_VERSION` is `3.0.2`.
- `handoff.conformance.test.ts › describes the version this package actually is` — `SOURCE_VERSION` is `3.0.2`, `package.json` is `3.1.0`.

The repo is therefore **already red on the version contract**. 3.1.1 must land in all hand-edited locations in one commit or these two stay red. The stale `package-lock.json` `3.0.0` is not asserted by any test but will re-drift on the next `npm install`.

## 9. Working-tree state to be aware of (not created by this task)

`git status --porcelain` shows three pre-existing uncommitted changes, none made by this task:

```
 M .gitignore        (+10 lines: .reports/ .tmp/ .kooder/ .koober/ .xcoder/ ... /new_tools_handoff/)
 M docs/SENTINEL.md  (line 4: "shipped in 3.0.2" -> "3.1.0")
 M package.json      (line 3: "3.0.2" -> "3.1.0")
?? tools.log          (untracked stray log, unrelated)
```

Two consequences for the 3.1.1 task:

1. **The 3.1.0 bump exists only in the working tree.** `HEAD` still says `3.0.2`, so `git checkout -- package.json` or a stash would silently undo it and flip the two failing lockstep tests in the other direction. Apply 3.1.1 on top of the current working tree and commit every version location together.
2. **The new `/new_tools_handoff/` ignore rule conflicts with the handoff gate.** `git ls-files new_tools_handoff` shows all 17 files are **tracked**, so `git diff --exit-code new_tools_handoff/` still catches edits to them, but any *newly generated* file in that directory would be invisible. Either the tracked copies should be removed in the same commit, or the ignore line dropped. Flagged, not fixed - this task is read-only.
