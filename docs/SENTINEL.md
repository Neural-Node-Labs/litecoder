<!-- xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T17:13:09.499Z | xcoder:subtask document-st-c10e76 -->
# Sentinel — the always-on log-monitoring security daemon

Status: shipped in `litecoder` 3.0.2 · source `src/sentinel/` · CLI `litecoder sentinel`

This document exists so that someone who was not in the build conversation can
answer three questions: **what exists, why it is shaped that way, and how to
verify or remove it.**

---

## 1. What was built

A daemon that watches server log files continuously, asks a language model
whether each event is suspicious, decides an action with code-owned policy, and
— only after a human approves — applies an `iptables` (Linux) or `netsh`
(Windows) firewall block.

It is a **new agent on the existing litecoder base**, not a separate program.
Concretely:

| integration point | file | what it does |
|---|---|---|
| CLI subcommand | `src/sentinel/cli.ts` | `registerSentinelCommand(program)` |
| registered from | `src/litecoder/cli.ts:31,223` | the planner's positional-goal contract is untouched |
| SDLC role | `src/skills/directives.ts:261` (`ROLE_DIRECTIVES.sentinel`) | adds `"sentinel"` to `ROLES` in `src/types.ts`; the `Record<Role, RoleDirective>` type makes `npm run typecheck` fail until the directive exists |
| LLM transport | `createLlmClient('sub_agent')`, `src/llm/factory.ts` | reuses the existing client; no second transport was introduced |

## 2. Provenance — what was ported from `temp/sentinel-ai`

The reference implementation lives in `temp/sentinel-ai/` (Python: `main.py`,
`core/`, `tools/`, `utils/`, `rules.md`, LangGraph + ChromaDB RAG). It was
**re-implemented in TypeScript against this repo's conventions**, not
transplanted. Four capabilities were carried over, one was replaced, one was
dropped:

| capability in `temp/sentinel-ai` | TypeScript home | note |
|---|---|---|
| Multi-LLM support | `src/llm/factory.ts` | reused; a second provider layer would have been duplicate code |
| OS-aware tools (iptables / netsh) | `src/sentinel/system-tools.ts` | platform chosen from `process.platform` |
| Safety fail-safes (default DENY, admin IP protection) | `src/sentinel/policy-engine.ts` + `policy/rules.ts` | enforced in code, never in prompt text |
| Privacy-first redaction (`SecureFormatter`) | `src/sentinel/redaction.ts` | runs **before** anything reaches the model |
| LangGraph state machine | replaced by an explicit loop | `src/sentinel/daemon.ts` |
| RAG-based policy (ChromaDB) | **not ported** | see §4.6 — the policy table is compiled TypeScript |

## 3. The one cycle

`src/sentinel/daemon.ts` runs, forever:

```
poll -> redact -> analyze -> decide -> gate -> act -> audit
```

`SentinelDaemon.start(signal)` loops until the `AbortSignal` fires; each
iteration is `runCycle()`, which emits a `CycleReport` (`linesRead`,
`analyzed`, `decisions`, `blocked`, `skipped`, `errors`, `killSwitchEngaged`)
as a `sentinel heartbeat` log line, then sleeps `pollIntervalMs`.

Isolation is explicit, not incidental:

- a cycle that throws is caught in `start()` and the loop **continues**;
- a failing log source is caught per-source in `pollSource()` (`poll failed`);
- a failing line is caught per-line (`line failed`);
- a throwing policy rule is caught in `policy-engine.ts` and counts as *not
  matched*, so a broken rule cannot become an allow;
- a failed offset save is a warning — the batch is not re-run.

Offsets are persisted (`offsetStorePath`) so a restart resumes rather than
re-reads the file.

## 4. The trust boundary — the part that matters

Both inputs are treated as untrusted: the log line (attacker-controlled) and the
model's answer (attacker-influenceable).

### 4.1 The model classifies; it never acts

`ModelAnalysis` in `src/sentinel/schema.ts` is a closed zod object with exactly
`threatDetected`, `category`, `severity`, `confidence`, `reason`,
`matchedRuleHint?`. It has **no** `targetIp`, no `action`, no
`durationMinutes`, no `permanent`, no `requiresApproval`, no `verdict`.

This is enforced by the parser, not by politeness: `src/sentinel/schema.test.ts`
(16 tests, added during the test cycle because the invariant had no test at all)
proves that a model reply which *does* supply `targetIp`, `action`,
`durationMinutes`/`permanent` or `requiresApproval`/`verdict` has those keys
**stripped** by zod — they can never reach the executor.

The action surface is closed to four values: `no_action | alert | block_ip |
unblock_ip`. There is no free-form command type anywhere in the module, so
"send an arbitrary shell command" is not expressible.

### 4.2 Fail-closed on every failure

`DEFAULT_DENY_ANALYSIS` is deliberately asymmetric: `threatDetected: true`,
`severity: 'high'`, `confidence: 0`. A failed analysis is *suspicious* but
carries no confidence, so policy can still only reach a temporary,
approval-gated action — never a permanent one.

`LlmAnalyzer.analyze()` returns that default for every one of `schema_invalid |
refused | timeout | transport_error | budget_exhausted | kill_switch |
max_tokens`. The daemon then distinguishes two cases: only `budget_exhausted`
and `kill_switch` are treated as non-suspicious and merely audited; everything
else proceeds down the suspicious path.

### 4.3 Prompt injection is a reported event, not an instruction

The system prompt (`SENTINEL_PROMPT_VERSION = 'sentinel-analyze@1'`) tells the
model that the user message contains a delimited block that is **data**, and
that instructions inside it are to be reported as an injection attempt, never
followed. The version string is stamped onto every `SecurityDecision.model`, so
an audit row says which prompt produced it.

That is defence in depth only. The real boundary is §4.1: even a model that
fully obeys the injected text cannot name an IP or choose an action.

### 4.4 Redaction before egress

`buildPromptPayload()` in `src/sentinel/redaction.ts` scrubs the line before it
is placed in the prompt, so provider retention terms are not the only thing
protecting credentials. `toSentinelEvent()` (`src/sentinel/parser.ts`) extracts
the source IP with a deterministic parser — the model is never asked for it.

### 4.5 Deterministic policy, in code

`src/sentinel/policy/rules.ts` holds **14 rules with stable ids** which appear in
the audit log: `core.admin_ip_protection`, `ip.brute_force_failed_logins`,
`ip.rapid_sequential_attempts`, `ip.invalid_user_enumeration`, `ip.port_scan`,
`ip.known_malicious`, `ssh.password_brute_force`, `ssh.root_login_attempt`,
`ssh.deprecated_protocol_v1`, `ssh.weak_cipher`, `fw.temporary_block`,
`fw.rate_limit`, `audit.logging_rule`, `ops.emergency_lockdown`.

`evaluate()` in `policy-engine.ts` is pure and ordered:

1. `!schemaValid` → deny (`analysis not trusted`);
2. empty rule table → deny;
3. **admin IP guard first and unconditional** — no rule can override it;
4. collect every matching rule; a throwing `when()` counts as false;
5. no match → deny (`default deny`);
6. otherwise DENY precedence: the most severe matching rule wins (severity-floor
   rank, then action impact `no_action < alert < block_ip < unblock_ip`).

Because the winner is chosen by severity rather than array position,
**re-ordering the rules cannot weaken an outcome** — a property the test suite
pins.

### 4.6 Why the policy is not a RAG lookup or a rules file

The Python original aligned decisions against a ChromaDB policy corpus. That was
rejected here for a concrete reason: nothing that can write a file next to the
daemon should be able to change what the daemon does, and no artifact of unknown
shape should be interpreted inside a security-critical process. Operator-tunable
values (thresholds, allowlist, block duration) are typed config instead.

## 5. Human approval and the audit trail

Firewall changes are irreversible, so they are gated:

- `src/sentinel/approval-gate.ts` provides `PromptApprovalGate`,
  `NotifyApprovalGate` and `AutoApproveGate`; HITL is configurable
  (`hitl.enabled`, `hitl.mode`, `hitl.timeoutMs`) and defaults to dry-run.
- `src/sentinel/approval-inbox.ts` persists pending verdicts in
  `<offsetStorePath>.approvals.json`; `litecoder sentinel --approve <id>` and
  `--deny <id>` answer the gate from another terminal.
- **Audit before action.** The daemon writes the audit record *first*; if that
  write fails it does not touch the firewall. An action is never silently
  unaudited.
- `src/sentinel/audit-log.ts` is append-only JSONL with `retentionDays`,
  `maxBytes` rotation, and `hashChain: true` — each record carries `prevHash`
  (SHA-256 of the previous record's canonical JSON) so middle-of-chain edits are
  detectable. In-source wording: "housekeeping-grade tamper-evidence, not a
  blockchain" — the accurate claim.
- The chain survives restarts: `ensureLoaded()` reads the tail of the existing
  file once.

## 6. Operational controls

| control | where | behaviour |
|---|---|---|
| Dry-run by default | `cli.ts` `--no-dry-run`; `run.ts` `NoopFirewall` | logs what it *would* block; no firewall call |
| Kill switch | `FileKillSwitch`, checked at the top of every cycle, again per source, and again immediately before the firewall call | daemon idles instead of exiting |
| Budget cap | `SlidingWindowBudget(maxLlmCallsPerMinute)` | exceeded → `budget_exhausted` → default-deny analysis, audited, no action |
| Preflight | `src/sentinel/preflight.ts` | refuses to start half-blind: no sources, unreadable source, unwritable audit dir, empty policy, or running privileged without opt-in; reports field *names*, never file contents |
| Config | `src/sentinel/config.ts` | validated `SentinelConfig`; secret-shaped fields dropped by name before any config logging |
| `--once` | `cli.ts` | exactly one cycle then exit — the smoke test |

Configuration comes from `SENTINEL_ADMIN_IP` and `SENTINEL_LOG_PATHS` (or a JSON
config file). Sources are typed `auth | web | generic`.

## 7. Verification (numbers from the runs below, not estimates)

- `npx vitest run --config vitest.config.ts src/sentinel/ src/skills/sentinel-directive.test.ts`
  → **17 test files, 129 tests, 0 failures** (`src/sentinel/` is 16 of those
  files; `src/skills/sentinel-directive.test.ts` is the 17th).
- Full suite `npm test` / `npm run regression` → **106 test files**,
  **1697 passed | 1 expected fail | 35 skipped (1733)**.
- The `regression` script was added to `package.json` during the test cycle
  (`"regression": "vitest run"`); before that the gate command failed with
  `Missing script: "regression"` no matter how healthy the tests were.
- Note on filters: `vitest` positional arguments are regex filters, not globs.
  The literal `"src/litecoder/**/*.test.ts"` matches almost nothing; use
  directory filters (`src/litecoder/ src/sentinel/`) to select the intended set.

## 8. Defects found and closed during this work

| id | what | state |
|---|---|---|
| defect0001 | `event-history.prune()` deleted aged buckets without decrementing `this.total`, so the counter drifted up and fresh brute-force events were evicted | verified fixed in source |
| defect0002 | `isBlocked()` never consulted the firewall, so a remembered block stayed authoritative forever | verified fixed (`refreshBlocked()` consults the OS; stale reads report not-blocked) |
| defect0003 | full suite was order-dependent — `loadConfig.ts` calls `applyUserConfig()` at import time, leaking the developer's real `~/.kooder/config.json` key into `process.env`, which made `config-command.test.ts` skip the write under test | fixed: narrow `forgetShellEnvShadow()` seam (production precedence unchanged), `afterEach` cleanup, `delete` instead of restore |

Details: `.xcoder/defects/defect0001.md`, `defect0002.md`, `defect0003.md`.

## 9. Known limits

- The hash chain detects edits; it does not prevent them. An attacker with write
  access to the audit file can rebuild the chain.
- `isPrivileged()` returns `false` on Windows, so the privileged-start guard is
  Linux-only.
- Firewall compatibility is limited to what `iptables`/`netsh` accept; no
  nftables backend yet.
- The analyzer budget is per-process, not global across replicas.

## 10. How to roll back

1. Delete `src/sentinel/` and remove the `registerSentinelCommand` import and
   call at `src/litecoder/cli.ts:31,223`.
2. Remove `sentinel` from `ROLES` (`src/types.ts`) and its entry in
   `ROLE_DIRECTIVES` (`src/skills/directives.ts:261`), deleting
   `src/skills/sentinel-directive.test.ts` at the same time.
3. Delete `docs/SENTINEL.md` and the Sentinel sections of `.xcoder/blueprint.md`.

Nothing outside those points imports the module, and no firewall rule is created
at build time — a daemon that never runs changes nothing.

See `.xcoder/blueprint.md` §4 for the condensed architecture and §8 for the
bylaw mapping.
