#!/usr/bin/env node
// xcoder:version 6 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:27:15.744Z | xcoder:subtask code-st-f1c53a
// `worker` bin — generic (non-SDLC) task delegation.
//
// Deliberately minimal: parse, build one LLM client, run the orchestrator,
// print the report. No stage flags, no healing flags, no steering, and no
// spinner that could corrupt `--json` output.
// Loads .env files through the filtered loader in loadConfig (never `dotenv/config`: it would apply an untrusted project .env unfiltered).
import "./config/loadConfig.js";
import { Command } from "commander";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createLlmClient } from "./llm/factory.js";
import { getOrBuildIndex } from "./tools/workspace-index.js";
import { log } from "./util/logger.js";
import { enableProtocolErrorLogging } from "./util/protocol-error-logger.js";
import { enableToolErrorLogging } from "./util/tool-error-logger.js";
import {
  WorkerOrchestrator,
  type WorkerRunReport,
  type WorkerSubtask,
} from "./worker-agent/worker-orchestrator.js";
import type { Role } from "./types.js";
import { KOODER_VERSION } from "./version.js";
import { extractConfigArg } from "./config/user-config.js";
import { runConfigCommand } from "./config/config-command.js";

/** Usage errors exit 2 and never print a report. */
class UsageError extends Error {}

interface RawSubtask {
  id?: unknown;
  goal?: unknown;
  role?: unknown;
  upstreamContext?: unknown;
  deliverableSpec?: unknown;
}

/** Normalises one input entry; ids default to `st-<n>` in order. */
function normaliseSubtask(raw: RawSubtask | string, index: number): WorkerSubtask {
  const fallbackId = `st-${index + 1}`;
  if (typeof raw === "string") {
    const goal = raw.trim();
    if (!goal) throw new UsageError(`subtask ${fallbackId} has an empty goal`);
    return { id: fallbackId, goal };
  }
  // JSON arrays may contain null/number/boolean entries; anything that is not
  // an object is a usage error, exactly like an entry with an empty goal.
  if (raw === null || typeof raw !== "object") {
    throw new UsageError(
      `subtask ${fallbackId} must be a string or an object with a goal (got ${raw === null ? "null" : typeof raw})`,
    );
  }
  const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";
  if (!goal) throw new UsageError(`subtask ${fallbackId} has an empty goal`);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const sub: WorkerSubtask = { id, goal };
  if (typeof raw.role === "string" && raw.role.trim()) sub.role = raw.role.trim() as Role;
  if (typeof raw.deliverableSpec === "string" && raw.deliverableSpec.trim()) {
    sub.deliverableSpec = raw.deliverableSpec;
  }
  if (raw.upstreamContext && typeof raw.upstreamContext === "object") {
    sub.upstreamContext = raw.upstreamContext as Record<string, unknown>;
  }
  return sub;
}

/** Reads `--subtasks <file>` (JSON: string[] or {id,goal,role?}[]); "-" means stdin. */
async function readSubtasksFile(spec: string): Promise<RawSubtask[]> {
  let raw: string;
  try {
    raw = spec === "-" ? await readStdin() : await fs.readFile(path.resolve(spec), "utf8");
  } catch (e) {
    throw new UsageError(`could not read subtasks file '${spec}': ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`subtasks file '${spec}' is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new UsageError("subtasks file must contain a JSON array");
  return parsed as RawSubtask[];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buf += chunk));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function printHuman(report: WorkerRunReport): void {
  log.raw("");
  log.orchestrator(`task ${report.taskId} — ${report.status}`);
  for (const s of report.subtasks) {
    const label = `${s.id} (${s.attempts} attempt${s.attempts === 1 ? "" : "s"})`;
    if (s.status === "done") {
      log.ok(`${label}: ${s.summary || "done"}`);
    } else {
      log.fail(`${label}: ${s.error ?? "failed"}`);
    }
    for (const f of s.filesTouched) log.dim(`    touched ${f}`);
    for (const h of s.history) {
      if (h.error) log.dim(`    attempt ${h.attempt} failed: ${h.error}`);
    }
  }
  log.dim(
    `${report.totals.done} done, ${report.totals.failed} failed, ` +
      `${report.totals.totalAttempts} attempt(s), ` +
      `${report.totals.inputTokens}/${report.totals.outputTokens} tokens, ` +
      `${report.totals.durationMs}ms`,
  );
  for (const e of report.errors) log.fail(`run error: ${e}`);
}

interface WorkerRunOptions {
  task: string;
  subtasks?: string;
  subtask: string[];
  concurrency: number;
  maxAttempts: number;
  workspace: string;
  model?: string;
  taskId?: string;
  json?: boolean;
  quiet?: boolean;
  color: boolean;
}

const program = new Command();

program
  .name("kooder")
  .description(
    "Kooder — a ReAct-driven worker-agent CLI: accepts a task description and a list of " +
      "subtasks, spawns one worker agent per subtask, retries failures, and prints an aggregated report.",
  )
  .version(KOODER_VERSION);

program
  .command("run")
  .description("Run a task by delegating its subtasks to worker agents")
  .option("--task <text>", "Task description")
  .option("--subtasks <file>", 'JSON file: string[] or {id,goal,role?}[]; "-" reads stdin')
  .option("--subtask <goal>", "Repeatable single subtask (collector)", (v: string, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .option("--concurrency <n>", "Max in-flight workers", (v) => parseInt(v, 10), 3)
  .option("--max-attempts <n>", "Total attempts per subtask", (v) => parseInt(v, 10), 2)
  .option("--workspace <dir>", "Workspace root", process.cwd())
  .option("--model <name>", "Overrides the configured LLM model")
  .option("--task-id <id>", "Explicit run id")
  .option("--json", "Machine output: the report only, no prose on stdout", false)
  .option("--quiet", "Suppress progress notes", false)
  .option("--no-color", "Disable colour output")
  .option(
    "--config <settings>",
    'Persist settings first, e.g. "provider=deepseek,key=…"; "show" prints them, "-" reads stdin',
  )
  .action(async (opts: WorkerRunOptions) => {
    if (!opts.color) process.env.NO_COLOR = "1";

    try {
      // `--task` is validated here rather than with `requiredOption` so a
      // missing value is a UsageError (exit 2), like every other usage error,
      // instead of commander's own exit code 1.
      if (typeof opts.task !== "string" || !opts.task.trim()) {
        throw new UsageError("required option '--task <text>' not specified");
      }

      // ---- collect inputs -------------------------------------------------
      const rawFromFile = opts.subtasks ? await readSubtasksFile(opts.subtasks) : [];
      const rawAll: Array<RawSubtask | string> = [
        ...rawFromFile,
        ...(opts.subtask ?? []).map((g) => g as RawSubtask | string),
      ];
      if (rawAll.length === 0) {
        throw new UsageError("no subtasks given; pass --subtasks <file> or at least one --subtask <goal>");
      }
      const subtasks = rawAll.map((raw, i) => normaliseSubtask(raw, i));

      const workspaceRoot = path.resolve(opts.workspace);

      // ---- build the client and warm the index (best-effort) ----------------
      const llm = createLlmClient("sub_agent", opts.model ? { model: opts.model } : {});
      try {
        await getOrBuildIndex(workspaceRoot);
      } catch (e) {
        if (!opts.json) log.dim(`workspace index unavailable: ${(e as Error).message}`);
      }

      enableProtocolErrorLogging();
      enableToolErrorLogging();

      // ---- run -------------------------------------------------------------
      const report = await new WorkerOrchestrator({
        workspaceRoot,
        llm,
        quiet: opts.quiet ?? false,
      }).run({
        taskDescription: opts.task,
        subtasks,
        concurrency: opts.concurrency,
        maxAttempts: opts.maxAttempts,
        taskId: opts.taskId,
        signal: makeSignal(),
      });

      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        printHuman(report);
      }

      process.exitCode = report.status === "failed" ? 1 : 0;
    } catch (e) {
      if (opts.json) {
        // Machine mode: stdout carries ONLY the JSON document so consumers can
        // pipe straight into JSON.parse/jq. Diagnostics go to stderr.
        process.stdout.write(
          JSON.stringify({ error: (e as Error).message, usage: e instanceof UsageError }, null, 2) + "\n",
        );
        process.stderr.write(`worker: ${(e as Error).message}\n`);
      } else {
        log.fail((e as Error).message);
      }
      process.exitCode = e instanceof UsageError ? 2 : 1;
    }
  });

/** Ctrl+C aborts *new* waves; in-flight agents finish naturally. */
function makeSignal(): AbortSignal {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  return controller.signal;
}

/**
 * Runs before `program.parseAsync()`.
 *
 * Returns an exit code when the invocation was a config command, or undefined
 * to let commander handle the argv (unchanged for every other invocation).
 *
 *   a. `kooder --config <v>` / `kooder --config=<v>` (root)  -> config command, exit.
 *   b. `kooder run --config <v> ...`                          -> persist first; on
 *      a non-zero code the run never starts, on 0 the argv continues with the
 *      token removed (so the attached run sees the settings it just wrote).
 *   c. anything else                                          -> undefined.
 *
 * Root-level rule: a `--config` token plus no known command (`run`) is a config
 * command. `--help`/`--version`/plain `run` are untouched.
 */
export async function maybeRunConfigCommand(
  argv: string[],
  runConfig: typeof runConfigCommand = runConfigCommand,
): Promise<number | undefined> {
  const extracted = extractConfigArg(argv);
  if (extracted.value === undefined && !extracted.error) return undefined;

  const rest = extracted.value === undefined ? argv.slice(2) : extracted.argv.slice(2);
  const firstPositional = rest.find((a) => !a.startsWith("-"));
  const isRun = firstPositional === "run";

  if (extracted.error) {
    process.stderr.write(`config: ${extracted.error}\n`);
    return 2;
  }
  const value = extracted.value!;

  if (isRun) {
    // `run --config show` is a usage error: show writes nothing and there is no
    // run to attach it to.
    if (value.trim().toLowerCase() === "show") {
      process.stderr.write("config: `--config show` is read-only and cannot be combined with `run`\n");
      return 2;
    }
    // The summary goes to stderr so it never mixes with a `--json` report.
    const code = await runConfig({
      arg: value,
      json: false,
      quiet: argv.includes("--quiet"),
      out: process.stderr,
    });
    if (code !== 0) return code;
    process.argv = extracted.argv;
    return undefined;
  }

  return runConfig({
    arg: value,
    json: argv.includes("--json"),
    quiet: argv.includes("--quiet"),
  });
}

maybeRunConfigCommand(process.argv).then(
  (code) => {
    if (code === undefined) {
      return program.parseAsync().catch((e: unknown) => {
        log.fail((e as Error)?.message ?? String(e));
        process.exitCode = 2;
      });
    }
    process.exitCode = code;
    return undefined;
  },
  (e: unknown) => {
    log.fail((e as Error)?.message ?? String(e));
    process.exitCode = 1;
  },
);
