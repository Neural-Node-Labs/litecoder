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

Requires Node.js >= 20.

## Install

```bash
npm install -g litecoder      # global CLI
npx litecoder "your goal"     # or run without installing
```

Three bins are installed: `litecoder` (the planner CLI, this package's main entry), plus `kooder`
and `worker` (the lower-level worker engine, see [Worker CLI](#worker-cli)).

## Quick start

1. Configure a provider once (stored in `~/.kooder/config.json`, mode `0600`):

   ```bash
   litecoder --config "provider=deepseek,model=deepseek-chat"
   echo 'key=sk-...' | litecoder --config -     # keeps the key out of shell history
   ```

   Local model via Ollama:

   ```bash
   litecoder --config "mode=ollama,model=llama3"
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
| `--config <settings>` | Persist LLM settings, `show` to print them, `-` to read from stdin. | — |

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
