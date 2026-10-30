<!-- xcoder:version 24 | xcoder:task task-5f5358 | xcoder:updated 2026-10-30T18:17:19.949Z | xcoder:subtask test-st-a10394 -->
# litecoder

Give it one goal. A tool-less planner breaks it into subtasks, then concurrent ReAct worker
agents do the work and report back.

```bash
npm install -g litecoder
litecoder "add a health endpoint"
```

- **One sentence in, one report out.** No subcommands, no config files to start.
- **Fail-closed planning.** The planner has no tools (structurally: `NO_TOOLS`). A rejected or
  unparseable plan dispatches zero subtasks.
- **Concurrent workers with retries.** Each subtask gets its own agent; a crash is a result, not an
  exception.
- **Optional `--secure` mode.** Injects `secure-architect` bylaws and blocks success on an
  unreviewed or violating finding.
- **Bring your own model.** DeepSeek (default), Anthropic, OpenAI-compatible endpoints, or local
  Ollama.
- **Sentinel security daemon.** A separate `sentinel` command tails server logs, classifies events
  with a model and blocks threats with code-owned policy — dry-run by default and gated on human
  approval. See [Sentinel](#sentinel).

Current release: `litecoder` **3.1.1**. Requires Node.js >= 20.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Document & media tools](#document--media-tools)
- [Configuration](#configuration)
- [Worker CLI](#worker-cli)
- [Sentinel](#sentinel)
- [CLI Agent Tools](#cli-agent-tools)
- [Programmatic use](#programmatic-use)
- [Safety notes](#safety-notes)
- [Development](#development)
- [License](#license)

## Install

```bash
npm install -g litecoder      # global CLI
npx litecoder "your goal"     # or run without installing
```

Four bins are installed: `litecoder` (the planner CLI, this package's main entry), plus `kooder`
and `worker` (the lower-level worker engine, see [Worker CLI](#worker-cli)), and `sentinel`
(the always-on log-monitoring security daemon, see [Sentinel](#sentinel) — also reachable as
`litecoder sentinel`). These are the bins as of `litecoder` 3.1.1.

## Quick start

1. Configure a provider once (stored in `~/.kooder/config.json`, mode `0600`):

   ```bash
   kooder --config "provider=deepseek,model=deepseek-chat"
   echo 'key=sk-...' | kooder --config -        # keeps the key out of shell history
   ```

   Local model via Ollama:

   ```bash
   kooder --config "mode=ollama,model=llama3"
   ```

2. Run it in the project you want changed:

   ```bash
   cd my-project
   litecoder "write a function to calculate the factorial of a number"
   ```

3. Want machine-readable output?

   ```bash
   litecoder "add a health endpoint" --json > report.json
   ```

## Usage

```
litecoder [options] <goal>
```

| Option | Meaning | Default |
| --- | --- | --- |
| `<goal>` | One sentence describing what to build. Required. | — |
| `--secure` | Enforce `secure-architect` bylaws on gated prompts and block success on violations. | off |
| `--concurrency <n>` | Max in-flight sub agents. | `3` |
| `--max-attempts <n>` | Total attempts per subtask. | `2` |
| `--max-plan-steps <n>` | Planner iterations before giving up. | `3` |
| `--max-subtasks <n>` | Plan size cap (hard cap 16). | `8` |
| `--workspace <dir>` | Workspace root. | `process.cwd()` |
| `--model <name>` | Override the configured model. | — |
| `--task-id <id>` | Explicit run id. | `litecoder-<timestamp>` |
| `--json` | Report only on stdout, nothing else. | `false` |
| `--quiet` | Suppress progress notes. | `false` |
| `--no-color` | Disable colour. | colour on |

Provider settings are persisted with the worker CLI, not `litecoder` itself: see
[Persisted settings (`--config`)](#persisted-settings---config).

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Run finished `completed` or `partial`. |
| `1` | Run `failed`, or an unexpected runtime error. |
| `2` | Usage error (missing goal, invalid option or config). No report is printed. |

With `--json`, errors are emitted as `{"error": "...", "usage": true|false}` and diagnostics go to
stderr.

## How it works

```
litecoder "<goal>"
  └─ MasterOrchestrator (no tools)      plans → validated Plan (zod)
  └─ dispatchPlan                       fans subtasks out
       └─ WorkerOrchestrator            retries, report assembly
            └─ SubAgent (ReAct loop) ⇄ tools (fs, git, shell, edit, search, ...)
```

Reports are flat and JSON round-trip safe: overall `status` (`completed` | `partial` | `failed`),
per-subtask `status`, `attempts`, `filesTouched`, `tokenUsage`, and a `history[]` with one record
per attempt.

## Document & media tools

Workers can also read, create and update real documents — no document library and no
subprocess required:

| tool | extensions | ops |
| --- | --- | --- |
| `excel` | `.xlsx` `.xlsm` | read, create, update |
| `word` | `.docx` `.docm` | read, create, update |
| `pdf` | `.pdf` | read, create, update |
| `image` | `.png` `.jpg` `.jpeg` | read, create, update |
| `slides` | `.pptx` `.pptm` | read, create, update |
| `video` | `.mp4` `.mov` `.webm` `.mkv` `.avi` | read, update |

Paths are workspace-relative, the format is verified from the file's leading bytes (an
extension that lies is refused, never converted), and nothing is overwritten without an
explicit `overwrite: true`. Encrypted documents are reported, not cracked; video is read
as container metadata and never re-encoded.

`new_tools_handoff/` is a language-neutral porting package for this surface — JSON Schema
plus 14 executable round-trip cases — so the same tools can be replicated in another
program. Regenerate it with `npm run handoff:gen`; see `.xcoder/blueprint.md` for the
architecture and `CHANGELOG.md` for what changed.

## Configuration

### Persisted settings (`--config`)

| Token | Meaning |
| --- | --- |
| `provider=` / `mode=` | Same setting. Aliases: `deepseek`, `anthropic`/`claude`, `openai`/`openai-compatible`, `ollama`. |
| `mode=ollama` | OpenAI-compatible endpoint at `http://localhost:11434/v1`. Pass `model=` too. |
| `key=` / `api_key=` | API key. Masked in every summary. |
| `model=` | Model name. |
| `base_url=` / `url=` | Endpoint; must be `http://` or `https://`. |
| `env.NAME=` | Extra environment variable. Names that could redirect execution or traffic (`PATH`, `NODE_OPTIONS`, `LD_*`, proxies, ...) are rejected. |
| `name=` (empty) | Deletes that setting. |

All-or-nothing: if any token is invalid, nothing is written and the exit code is `2`. Prefer
`--config -` for secrets, since command-line values show up in shell history and the process table.

### Precedence

shell environment > `~/.kooder/config.json` > project `.env` > app/home `.env`.

A project `.env` can never override a variable you exported, and can never set credential-redirecting
names such as `*_BASE_URL`.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `KOODER_MODEL` | Override the model. |
| `KOODER_HOME` | Directory treated as home for config and `.env`. |
| `KOODER_CONFIG_FILE` | Explicit user config file. |
| `KOODER_DIR` | Explicit state-directory name/path. |
| `KOODER_EXTERNAL_SKILLS` | `true`/`1`/`yes` enables loading external skills. |

### State directory

Per-workspace state lives in `<workspace>/.kooder/` (`tasks/`, `logs/`, `config/llm.yaml`,
`screenshots/`). Add it to your `.gitignore`.

Per-role providers can be set in `.kooder/config/llm.yaml` with a `default` block plus optional
role blocks (`orchestrator`, `sub_agent`, ...). Resolution is role block, then `default`, then the
built-in DeepSeek default.

## Worker CLI

`kooder` and `worker` are the same binary: the engine litecoder delegates to, usable directly when
you already know your subtasks.

```bash
kooder run --task "harden auth" \
  --subtask "rate-limit /login" \
  --subtask "add regression test for the lockout path" \
  --concurrency 2 --max-attempts 3

kooder run --task "docs pass" --subtasks subtasks.json --json > report.json
```

`--subtasks` takes a JSON file of `string[]` or `{id, goal, role?}[]` (`-` reads stdin).

## Sentinel

Sentinel is the always-on log-monitoring security daemon that ships with litecoder 3.1.1. It
tails your server log files, asks a model whether each event looks suspicious, decides an
action with **code-owned policy** (not the model), and — only after a human approves — applies a
temporary `iptables` (Linux) or `netsh` (Windows) firewall block.

It is a normal agent on the existing litecoder base, not a separate program: it reuses the
same LLM client (`createLlmClient('sub_agent')`) and has its own `sentinel` SDLC role. Source
lives in `src/sentinel/`; the full design write-up is in [docs/SENTINEL.md](docs/SENTINEL.md).

Each cycle is:

```
poll -> redact -> analyze -> decide -> gate -> act -> audit
```

- **The model classifies; it never acts.** The analysis schema has no `targetIp`, `action` or
  `durationMinutes` field — zod strips them if a model supplies them. The action surface is a
  closed enum, so an arbitrary shell command is not expressible.
- **Fail closed.** A failed or budget-exhausted analysis defaults to suspicious with
  `confidence: 0`, which can only ever reach a temporary, approval-gated action.
- **Dry-run by default.** Out of the box Sentinel logs what it *would* block and never touches
  the firewall. `--no-dry-run` is required to actually apply a block.
- **Audit before action.** The audit record is written first; if that write fails the firewall
  is never called. Records are append-only JSONL with a SHA-256 `prevHash` chain.
- **Human in the loop.** `--approve <id>` / `--deny <id>` answer a pending decision from
  another terminal; the verdict is persisted under `<offsetStorePath>.approvals.json`.

### Running it

`sentinel` is installed as its own command by `npm install -g litecoder`, and the identical
command is also mounted as a subcommand (`litecoder sentinel`). Both surfaces share one
definition (`createSentinelCommand()`), so the options cannot drift; the standalone bin also
owns `--version`.

```bash
# minimal run — env config, dry-run (log-only)
SENTINEL_ADMIN_IP=203.0.113.10 \
SENTINEL_LOG_PATHS=/var/log/auth.log,/var/log/nginx/access.log \
  sentinel

# one monitoring cycle then exit (smoke test)
sentinel --once

# same thing through the planner CLI
litecoder sentinel --once

# actually apply firewall blocks instead of logging them
sentinel --no-dry-run

# answer a pending approval from another terminal
sentinel --approve dec_01HXYZ
sentinel --deny dec_01HXYZ
```

Without installing, the bin can be run from a checkout with `npm run dev:sentinel` (e.g.
`npm run dev:sentinel -- --once`).

### Options

`sentinel --help` prints:

```
Usage: sentinel [options]

Run the always-on security daemon that monitors logs, or answer its approval
requests.

Options:
  --no-dry-run     Actually apply firewall blocks (default is dry-run:
                   log-only)
  --once           Run a single monitoring cycle and exit (smoke test)
                   (default: false)
  --approve <id>   Grant the pending approval for a decision id
  --deny <id>      Deny the pending approval for a decision id
  --config <path>  Path to a JSON config file (env still applies)
  -V, --version    output the version number
  -h, --help       display help for command

Requires SENTINEL_ADMIN_IP and SENTINEL_LOG_PATHS (or a config file).
```

`litecoder sentinel --help` is the same list minus `-V, --version` (the version flag belongs to
the root program).

### Configuration

In 3.1.1 Sentinel reads its settings from the environment. It refuses to start on an unsafe or
incomplete config — no sources, an unreadable source, an unwritable audit directory, an empty
policy, or privileged mode without opt-in all abort at preflight — and it reports field *names*,
never file contents.

| Variable | Meaning | Default |
| --- | --- | --- |
| `SENTINEL_ADMIN_IP` | Administrator IP to protect. **Required.** Must be an IP literal. | — |
| `SENTINEL_LOG_PATHS` | Comma-separated log files to tail. **Required** — at least one source, otherwise startup aborts. | — |
| `SENTINEL_ALLOWLIST` | Comma-separated extra IPs that are never blocked. | admin IP only |
| `SENTINEL_DRYRUN` | `1`/`0` — log-only when on. | `1` (dry-run) |
| `SENTINEL_HITL_ENABLED` | `1`/`0` — require human approval for actions. | `1` |
| `SENTINEL_HITL_MODE` | `prompt` or `notify`. | `notify` |
| `SENTINEL_HITL_TIMEOUT_MS` | How long a pending approval waits. | `900000` |
| `SENTINEL_POLL_MS` | Poll interval. | `5000` |
| `SENTINEL_MAX_LINES` | Max lines read per batch. | `200` |
| `SENTINEL_MAX_LLM_CALLS_PER_MIN` | Sliding-window budget; exceeding it defaults to deny. | `20` |
| `SENTINEL_LLM_TIMEOUT_MS` | Per-analysis model request timeout. | `20000` |
| `SENTINEL_BLOCK_MINUTES` | Block duration (temporary, max `10080` = 7 days). | `1440` |
| `SENTINEL_MAX_FAILED_ATTEMPTS` | Failed auth attempts from one IP within 10 minutes that trigger the brute-force block rule. | `5` |
| `SENTINEL_KILL_SWITCH` | Path to a file whose presence pauses the daemon. | — |
| `SENTINEL_OFFSET_PATH` | Tail offsets, so a restart resumes rather than re-reads. | `.sentinel-offsets.json` |
| `SENTINEL_AUDIT_PATH` | Append-only JSONL audit log. | `.sentinel-audit.jsonl` |
| `SENTINEL_AUDIT_RETENTION_DAYS` | Audit records older than this are rotated out. | `30` |
| `SENTINEL_AUDIT_MAX_BYTES` | Size at which the audit log is rotated. | `67108864` (64 MiB) |

The underlying `loadSentinelConfig(env, fileText)` also accepts a JSON object — the same
settings in camelCase, plus typed `sources` — which is how the library and its tests configure a
daemon. The shape is:

```json
{
  "adminIpAllowlist": ["203.0.113.10"],
  "sources": [
    { "id": "auth", "path": "/var/log/auth.log", "kind": "auth" },
    { "id": "web", "path": "/var/log/nginx/access.log", "kind": "web" }
  ],
  "dryRun": true,
  "hitl": { "enabled": true, "mode": "prompt" }
}
```

`kind` is `auth`, `web` or `generic` (default `generic`). `SENTINEL_ADMIN_IP` is required either
way — the JSON supplies the allowlist and sources, not the admin IP.

`--config <path>` reads a JSON file of the shape above; environment variables named in this
section still apply and take precedence where both set the same value. `SENTINEL_ADMIN_IP` must
still come from the environment (or the project `.env`).

> **Known limitation in 3.1.1.** The file currently reaches the `--approve` / `--deny` inbox
> path but *not* the daemon run: `src/sentinel/cli.ts` loads the file and then calls
> `runSentinel()` without forwarding it, so `run.ts` re-loads config from the environment
> alone. Configure the daemon-run settings through the environment variables above until this
> is fixed — a file that declares only `sources` will fail preflight with
> `sources: at least one log source is required`. Tracked as
> [`.xcoder/defects/defect0001.md`](.xcoder/defects/defect0001.md) and pinned by
> `it.fails('forwards the config file to the daemon run')` in `src/sentinel/cli.test.ts`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Cycle complete (`--once`), the daemon was stopped by SIGINT/SIGTERM, or an approval was recorded. |
| `1` | Crash loop — 5 restarts within 60s, so the daemon gave up. |
| `2` | Configuration or usage error (e.g. missing `SENTINEL_ADMIN_IP`). The message is written to stderr as `sentinel: <field>: <detail>`. |

Because the config is validated before the daemon starts, a missing `SENTINEL_ADMIN_IP` exits `2`
immediately:

```console
$ sentinel --once
sentinel: adminIp: SENTINEL_ADMIN_IP is required
```

### Operating safely

Dry-run is the default deliberately: run `sentinel --once` and read the audit log
(`SENTINEL_AUDIT_PATH`) before adding `--no-dry-run`. The admin IP and allowlist are enforced in
`policy-engine.ts`, not in prompt text, and the kill switch is checked at the top of every cycle
and again immediately before any firewall call.

## CLI Agent Tools

Every agent in this package runs with a closed, code-owned tool set. This section is the
single list: what each agent can actually reach for, the parameters each tool takes, and where
the set is defined in source. Nothing here is a suggestion — if a tool is not in this table it
is not callable by that agent, and if it is in the table, the registry is authoritative for the
full description.

| Agent | Bin(s) | Tools | Source of truth |
| --- | --- | --- | --- |
| litecoder (planner) | `litecoder` | 0 | `src/litecoder/no-tools.ts` |
| kooder (worker engine) | `kooder`, `worker` | 38 | `src/tools/tool-registry.ts` |
| sentinel (security daemon) | `sentinel` | 3 | `src/sentinel/system-tools.ts` |

`kooder` and `worker` are the same binary (`dist/cli-worker.js`), so they share one tool set and
are documented once. The counts above are derived from the registries by
`src/tools/readme-tool-docs.test.ts`, which fails if this table and the tables below drift from
the code.

### litecoder — no tools by design

The planner is handed `NO_TOOLS`: a frozen registry whose `toolCount` is `0`, whose `manifest` is
empty, and whose `get` and `call` throw `OrchestratorHasNoToolsError`. This is a structural
boundary, not a prompt instruction — there is no capability to reach for, so a hostile goal text
cannot talk the planner into acting. The planner plans; workers act.

| Tool | Purpose | Key parameters | Optional keys |
| --- | --- | --- | --- |

There are no rows in that table on purpose. Any tool listed here would be a bug.

### kooder / worker — the worker tool surface

Every tool, grouped by what they touch. Parameters are shown as the registry's input example;
the full description and the accepted input live in `src/tools/tool-registry.ts`. The count in the
index table above is the derived one, and the drift check fails if these rows and that count stop
matching the registry.

| Tool | Purpose | Key parameters | Optional keys |
| --- | --- | --- | --- |
| `search_workspace` | Search the workspace index by path substring. | `{ "query": "src/auth" }` | — |
| `glob` | Pattern-match file paths in the workspace index using `*`, `**`, `?` — no shell needed. | `{ "pattern": "src/**/*.test.ts" }` | — |
| `grep` | Search file contents across the workspace for a regex or string. | `{ "pattern": "function login\\\\(", "pathGlob": "src/**/*.ts" }` | `pathGlob` |
| `read_file` | Read a file relative to the workspace root, optionally a line range. | `{ "path": "src/auth/login.ts", "startLine": 1, "endLine": 200 }` | `startLine`, `endLine` |
| `edit_file` | Replace one exact, unique occurrence of `old_str` with `new_str`. | `{ "path": "src/auth/login.ts", "old_str": "exact existing text, unique in the file", "new_str": "its replacement" }` | — |
| `write_file` | Create or fully overwrite a file relative to the workspace root. | `{ "path": "src/auth/login.ts", "content": "..." }` | — |
| `list_dir` | List indexed files under a directory prefix. | `{ "dir": "src" }` | — |
| `reindex_workspace` | Force a full workspace reindex. | `{}` | — |
| `run_command` | Run a shell command from the workspace root; denylisted destructive patterns are refused. | `{ "command": "npm test", "timeoutMs": 60000 }` | `timeoutMs` |
| `ui_test` | Run a Playwright browser test against a URL. | `{ "kind": "ui", "url": "https://...", "credentialRef": "STAGING_PASSWORD", "steps": [ { "op": "click", "selector": "#submit" } ] }` | `credentialRef`, `steps` |
| `browse` | Drive a real browser through steps and read what is on the page. | `{ "url": "http://localhost:3000", "session": "app", "steps": [ { "op": "fill", "selector": "#user", "value": "admin" }, { "op": "click", "selector": "button[type=submit]" }, { "op": "screenshot" } ] }` | `session`, `steps` |
| `api_test` | Send one HTTP request and assert on status or body. | `{ "kind": "api", "method": "GET", "url": "https://.../health", "expectStatus": 200 }` | `expectStatus` |
| `load_skill` | Load the full bodies of external skill files by role or keyword. | `{ "role": "tester" }` or `{ "keyword": "penetration testing" }` | — |
| `github_create_repo` | Create a new GitHub repository via the API. | `{ "name": "my-repo", "private": true, "description": "..." }` | `private`, `description` |
| `github_clone` | Clone a GitHub repository into a directory inside the workspace. | `{ "url": "https://github.com/org/repo.git", "dir": "repo" }` | `dir` |
| `github_commit` | Stage and commit changes in a workspace directory. | `{ "message": "fix: patch merges partial updates instead of overwriting" }` | — |
| `github_push` | Push the current branch to a remote. | `{ "remote": "origin", "branch": "main" }` | — |
| `sed_tool` | Stream-edit workspace files with regex patterns; bulk find/replace. | `{ "path": "src/config.ts", "operation": "substitute", "pattern": "oldValue", "replacement": "newValue", "flags": "g" }` | `flags` |
| `schedule` | Create, list or remove scheduled cron and one-off jobs. | `{ "operation": "create_cron", "id": "my-job", "cronExpr": "0 9 * * *", "command": "npm run daily" }` | — |
| `site_crawler` | Crawl a same-domain website into a structured sitemap. | `{ "url": "https://example.com", "maxPages": 10, "maxDepth": 3, "format": "json" }` | `maxPages`, `maxDepth`, `format` |
| `read_outline` | Structural skeleton read: imports, signatures, docstrings, bodies collapsed. | `{ "path": "src/auth/login.ts" }` | — |
| `read_multiple_files` | Batched, labeled section reads in one call. | `{ "files": [{ "path": "src/a.ts", "startLine": 1, "endLine": 40 }], "maxTotalChars": 12000 }` | `maxTotalChars` |
| `read_full_file` | Gated whole-file read; refused above 500 lines unless `allowLarge`. | `{ "path": "src/big.ts", "allowLarge": false }` | `allowLarge` |
| `search_ast` | Structural TS/JS search for functions, classes and call targets. | `{ "query": "function login", "pathGlob": "src/**/*.ts" }` | `pathGlob` |
| `get_dependency_graph` | Imports and importers for one file, over the workspace index. | `{ "path": "src/auth/login.ts" }` | — |
| `git_diff` | Low-token diff summary; `rawDiff: true` for the full unified diff. | `{ "ref": "HEAD~3", "path": "src/a.ts", "rawDiff": false }` | `ref`, `path`, `rawDiff` |
| `git_log` | Recent commit subjects for the workspace or a single file. | `{ "path": "src/a.ts", "maxCount": 10 }` | `path`, `maxCount` |
| `line_patch` | Stale-enforced line replacement; refuses if the file changed since you read it. | `{ "path": "src/a.ts", "startLine": 10, "endLine": 12, "newContent": "...", "expectedSha1": "<from read>" }` | — |
| `apply_unified_diff` | Apply a multi-hunk unified diff, checking it first inside a git repo. | `{ "path": "src/a.ts", "diff": "--- a/src/a.ts +++ b/src/a.ts @@ -1,3 +1,4 @@ ..." }` | — |
| `update_function` | AST-scoped whole-function rewrite (TS/JS only). | `{ "path": "src/a.ts", "functionName": "login", "newCode": "export function login(...) {...}" }` | — |
| `rename_symbol` | Scope-aware identifier rename (TS/JS only); strings and comments untouched. | `{ "path": "src/a.ts", "name": "oldName", "newName": "newName" }` | — |
| `validate_file` | Post-edit syntax and type check on the patched file; returns only error lines. | `{ "path": "src/a.ts", "lang": "typescript" }` | `lang` |
| `excel` | Read, create or update an Excel workbook. | `{ "op": "read", "path": "reports/q3.xlsx", "sheet": "Summary", "range": "A1:D20" }` | `sheet`, `range` |
| `word` | Read, create or update a Word document. | `{ "op": "update", "path": "docs/spec.docx", "append": [{ "text": "Appendix", "style": "Heading1" }], "overwrite": true }` | `append`, `overwrite` |
| `pdf` | Read, create or update a PDF. | `{ "op": "create", "path": "out/notes.pdf", "pages": [{ "text": "Hello" }], "metadata": { "title": "Notes" } }` | `pages`, `metadata` |
| `image` | Read, create or update a PNG or JPEG image. | `{ "op": "read", "path": "assets/logo.png", "includeExif": true }` | `includeExif` |
| `slides` | Read, create or update a PowerPoint deck. | `{ "op": "create", "path": "deck/kickoff.pptx", "slides": [{ "title": "Kickoff", "bullets": ["Scope", "Timeline"] }] }` | `slides` |
| `video` | Read container metadata for a video, or replace it wholesale via `update`. | `{ "op": "read", "path": "media/demo.mp4" }` | — |

Tools that touch the network or a third party never take a secret as a parameter: `ui_test`,
`browse`, `api_test` and the `github_*` tools take a `credentialRef` (the name of an environment
variable) or read `GITHUB_TOKEN` from the environment. The six document tools are described in
more detail — extensions, limits and ops — in [Document & media tools](#document--media-tools).

### sentinel — approval-gated firewall tools

Sentinel's acting surface is three code-owned methods on `interface Firewall`, and it is the only
agent whose tools can change a machine:

| Tool | Purpose | Key parameters | Optional keys |
| --- | --- | --- | --- |
| `blockIp` | Apply a temporary firewall block for an IP. | `{ "ip": "203.0.113.10", "durationMinutes": 30 }` | — |
| `unblockIp` | Remove a block previously applied. | `{ "ip": "203.0.113.10" }` | — |
| `isBlocked` | Report whether an IP is currently blocked. | `{ "ip": "203.0.113.10" }` | — |

Those three tools cannot be reached directly. The model classifies and never acts; the decision
is made by **code-owned policy** in `policy-engine.ts`, which also enforces the admin IP and the
allowlist, and every block is gated on human approval:

- **Dry-run by default.** Out of the box Sentinel records what it *would* block and touches no
  firewall. `--no-dry-run` is required to actually apply a block.
- **Human approval.** A pending decision is answered from another terminal with
  `sentinel --approve <id>` or `sentinel --deny <id>`. Each verdict is recorded against one decision
  id; an approval is never reusable, and a timeout or an unreachable inbox is never an approval.
- **Kill switch.** Checked at the top of every cycle and again immediately before any firewall
  call — it lives in code, not in prompt text.
- **Audit before action.** The audit record is written first; if that write fails the firewall is
  never called.

No prompt or README statement can loosen any of the above: the gate, the policy and the kill
switch are enforced outside the model. See [Sentinel](#sentinel) for operations.

## Programmatic use

The planner pieces are exported for embedding and testing:

```ts
import { MasterOrchestrator, parsePlan, dispatchPlan, NO_TOOLS } from "litecoder";
```

This package is ESM-only.

## Safety notes

- litecoder runs agents that **read, write and execute in your workspace**. Run it in a git
  repository with a clean tree so you can review and revert changes.
- The goal text is treated as untrusted input; the planner cannot call tools.
- Use `--secure` when generated code will touch auth, crypto, or user data.
- Your API key is sent to the provider you configure and nowhere else.

## Development

```bash
git clone https://github.com/neural-node-labs/litecoder && cd litecoder
npm install
npm run typecheck
npm test
npm run build
npm run dev:litecoder -- "add a health endpoint"   # run from source
```

## License

MIT. Copyright (c) 2026 Neural Node Labs.
