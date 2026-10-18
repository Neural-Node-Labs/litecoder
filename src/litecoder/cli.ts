#!/usr/bin/env node
// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:37:04.083Z | xcoder:subtask code-st-9de79a
// `litecoder` bin — plan one goal with a tool-less planner, then delegate the
// plan's subtasks to the existing worker engine.
//
// Deliberately minimal, like `cli-worker.ts`: parse, build clients, plan,
// dispatch, print. No `run` subcommand, no `--task`, no `--subtask` — the goal
// is the single positional argument (AC1, AC2).
// Filtered .env loading lives in loadConfig (never `dotenv/config`).
import "../config/loadConfig.js";
import { Command } from "commander";
import path from "node:path";
import { createLlmClient } from "../llm/factory.js";
import { log } from "../util/logger.js";
import { enableProtocolErrorLogging } from "../util/protocol-error-logger.js";
import { enableToolErrorLogging } from "../util/tool-error-logger.js";
import { KOODER_VERSION } from "../version.js";
import { NO_TOOLS } from "./no-tools.js";
import { MasterOrchestrator, type PlannerTraceEntry } from "./master-orchestrator.js";
import { createSecureGate, type SecureMode } from "./secure-gate.js";
import { dispatchPlan } from "./dispatcher.js";
import {
  deriveStatus,
  emptyTotals,
  exitCodeFor,
  formatHumanReport,
  summariseBylawVerdicts,
  type LitecoderRunReport,
} from "./report.js";
import type { Plan } from "./plan-schema.js";

/** Usage errors exit 2 and never print a report. */
class UsageError extends Error {}

interface LitecoderOptions {
  secure?: boolean;
  concurrency?: number;
  maxAttempts?: number;
  maxPlanSteps?: number;
  maxSubtasks?: number;
  workspace: string;
  model?: string;
  taskId?: string;
  json?: boolean;
  quiet?: boolean;
  color: boolean;
}

/** Positive integer flag, or a UsageError — never NaN flowing into a loop bound. */
function positiveInt(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new UsageError(`option '${flag}' must be a positive integer, got '${raw}'`);
  }
  return n;
}

/** Ctrl-C aborts *new* waves; in-flight agents finish (existing engine semantics). */
function makeSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") return undefined;
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  return controller.signal;
}

const program = new Command();

program
  .name("litecoder")
  .description(
    "litecoder — plan one goal with a tool-less Master Orchestrator, then delegate the " +
      "plan's subtasks to worker agents on the existing Kooder engine.",
  )
  .version(KOODER_VERSION)
  .argument("[goal]", "One sentence describing what to build (untrusted input)")
  .option(
    "--secure",
    "Enforce secure-architect bylaws: inject them into gated prompts and block success " +
      "on an unreviewed/violating finding. Off by default.",
    false,
  )
  .option("--concurrency <n>", "Max in-flight sub agents (default 3)", (v: string) =>
    positiveInt(v, "--concurrency"),
  )
  .option("--max-attempts <n>", "Total attempts per subtask (default 2)", (v: string) =>
    positiveInt(v, "--max-attempts"),
  )
  .option("--max-plan-steps <n>", "Planner iterations before giving up (default 3)", (v: string) =>
    positiveInt(v, "--max-plan-steps"),
  )
  .option("--max-subtasks <n>", "Plan size cap (default 8, hard cap 16)", (v: string) =>
    positiveInt(v, "--max-subtasks"),
  )
  .option("--workspace <dir>", "Workspace root (default cwd)", process.cwd())
  .option("--model <name>", "Overrides the configured LLM model")
  .option("--task-id <id>", "Explicit run id")
  .option("--json", "Machine output: the report only, no prose on stdout", false)
  .option("--quiet", "Suppress progress notes", false)
  .option("--no-color", "Disable colour output")
  .action(async (goalArg: string | undefined, opts: LitecoderOptions) => {
    if (!opts.color) process.env.NO_COLOR = "1";

    try {
      // Validated here (not with a required argument) so a missing goal is a
      // usage error with exit 2, matching every other usage error.
      const goal = typeof goalArg === "string" ? goalArg.trim() : "";
      if (!goal) {
        throw new UsageError('a goal is required, e.g. `litecoder "add a health endpoint"`');
      }

      const workspaceRoot = path.resolve(opts.workspace);
      const secureMode: SecureMode = opts.secure ? "enforce" : "off";
      const secure = createSecureGate(secureMode);
      const taskId = opts.taskId?.trim() || `litecoder-${Date.now()}`;
      const signal = makeSignal();

      const plannerLlm = createLlmClient("orchestrator", opts.model ? { model: opts.model } : {});
      const workerLlm = createLlmClient("sub_agent", opts.model ? { model: opts.model } : {});

      enableProtocolErrorLogging();
      enableToolErrorLogging();

      const verbose = !opts.quiet && !opts.json;
      const emit = verbose
        ? (entry: PlannerTraceEntry) => {
            log.dim(
              `[plan ${entry.step}] ${entry.ok ? "accepted" : "rejected"}: ` +
                entry.thought.slice(0, 100),
            );
          }
        : undefined;

      const planner = new MasterOrchestrator({
        llm: plannerLlm,
        tools: NO_TOOLS,
        secure,
        maxPlanSteps: opts.maxPlanSteps,
        maxSubtasks: opts.maxSubtasks,
        emit,
      });

      if (verbose) log.orchestrator(`planning: ${goal}`);

      const outcome = await planner.plan({ goal, signal });

      let report: LitecoderRunReport;

      if (outcome.ok) {
        const plan: Plan = outcome.plan;
        if (verbose) log.orchestrator(`plan accepted: ${plan.subtasks.length} subtask(s)`);

        const dispatched = await dispatchPlan(plan, {
          workspaceRoot,
          llm: workerLlm,
          concurrency: opts.concurrency ?? 3,
          maxAttempts: opts.maxAttempts ?? 2,
          secure,
          taskId,
          signal,
          quiet: opts.quiet ?? false,
        });

        const bylaw =
          secureMode === "enforce" ? summariseBylawVerdicts(dispatched.subtasks) : null;

        report = {
          taskId,
          goal,
          status: deriveStatus({ plan, subtasks: dispatched.subtasks, bylaw }),
          secure: { mode: secureMode },
          plan,
          planning: {
            steps: outcome.steps,
            duplicateDetections: outcome.duplicateDetections,
            failure: null,
            errors: [],
            trace: outcome.trace,
          },
          subtasks: dispatched.subtasks,
          totals: dispatched.totals,
          bylaw,
        };
      } else {
        // Fail closed: zero subtasks dispatched (AC4).
        report = {
          taskId,
          goal,
          status: deriveStatus({ plan: null, subtasks: [], bylaw: null }),
          secure: { mode: secureMode },
          plan: null,
          planning: {
            steps: outcome.steps,
            duplicateDetections: outcome.duplicateDetections,
            failure: outcome.reason,
            errors: outcome.errors,
            trace: outcome.trace,
          },
          subtasks: [],
          totals: emptyTotals(),
          bylaw: null,
        };
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        process.stdout.write(formatHumanReport(report));
      }

      process.exitCode = exitCodeFor(report.status);
    } catch (e) {
      if (e instanceof UsageError) {
        process.stderr.write(`litecoder: ${e.message}\n`);
        process.exitCode = 2;
        return;
      }
      process.stderr.write(`litecoder: ${(e as Error)?.message ?? String(e)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  process.stderr.write(`litecoder: ${(e as Error)?.message ?? String(e)}\n`);
  process.exitCode = 2;
});
