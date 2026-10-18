// xcoder:version 2 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:36:25.176Z | xcoder:subtask code-st-1a0810
import { promises as fs, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { TaskRun } from "../types.js";
import { createKooderPaths } from "../util/kooder-paths.js";

export async function saveProgressSummary(root: string, taskId: string, markdown: string): Promise<void> {
  const xcoder = createKooderPaths(root);
  const file = xcoder.taskProgressFile(taskId);
  await fs.mkdir(xcoder.tasksDir(), { recursive: true });
  await fs.writeFile(file, markdown, "utf8");
}

export async function loadProgressSummary(root: string, taskId: string): Promise<string | null> {
  try {
    return await fs.readFile(createKooderPaths(root).taskProgressFile(taskId), "utf8");
  } catch {
    return null;
  }
}

export async function saveTaskRun(root: string, run: TaskRun): Promise<void> {
  const file = createKooderPaths(root).taskFile(run.spec.taskId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(run, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/**
 * Synchronous fallback for interrupt handlers when the event loop may be
 * draining and async I/O won't complete before the process exits.
 * Writes directly to the target file (NOT atomic — no temp file + rename)
 * because `fs.renameSync` still requires a working event loop on some
 * platforms. The caller (haltInternal) only reaches this path after the
 * async save has already timed out, so this is truly a last resort.
 */
export function saveTaskRunSync(root: string, run: TaskRun): void {
  const file = createKooderPaths(root).taskFile(run.spec.taskId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(run, null, 2), "utf8");
}

export async function loadTaskRun(root: string, taskId: string): Promise<TaskRun | null> {
  try {
    const raw = await fs.readFile(createKooderPaths(root).taskFile(taskId), "utf8");
    return JSON.parse(raw) as TaskRun;
  } catch {
    return null;
  }
}

export async function listTaskRuns(root: string): Promise<string[]> {
  try {
    const dir = createKooderPaths(root).tasksDir();
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".json")).map((e) => e.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/**
 * A task snapshot's `status` only ever gets written as `"running"` while a
 * `SdlcOrchestrator.run()` call is actively executing in memory (see
 * `orchestrator/master-orchestrator.ts`). If the hosting process dies —
 * killed, crashed, restarted — mid-run, the LAST thing written to disk is
 * still `"running"`, and nothing ever revisits it. This was traced
 * directly from real evidence: two task snapshots frozen at `"running"`
 * with their first subtask still `"ready"`, silent well before the
 * 25-iteration cap or any healing/escalation path would have concluded —
 * the process itself died, not the task.
 *
 * Called once at the start of every `SdlcOrchestrator.run()` (so the
 * CLI picks up stale state from a prior run before
 * doing any new work) — cheap for a local task store, and it only ever
 * touches tasks that are actually stuck.
 */
export async function reconcileOrphanedTasks(root: string): Promise<{ taskId: string; goal: string }[]> {
  const ids = await listTaskRuns(root);
  const reconciled: { taskId: string; goal: string }[] = [];

  for (const id of ids) {
    const run = await loadTaskRun(root, id);
    if (!run || run.status !== "running") continue;

    run.status = "halted";
    run.orchestratorTrace.push({
      thought: "reconciled on startup",
      action: null,
      observation:
        'this task was still marked "running" when Kooder started up again — the process running it ended ' +
        "without finishing (crash, restart, or manual kill), not because the task itself failed. Marked halted " +
        "rather than left silently stuck. No subtask results were lost; check its logs for what had already completed.",
    });
    if (!run.finalDeliverable) {
      const doneCount = run.dag.filter((n) => n.status === "done").length;
      run.finalDeliverable = `Halted: the process running this task ended before completion (not a task failure). ${doneCount}/${run.dag.length} subtasks had finished.`;
    }
    await saveTaskRun(root, run);
    reconciled.push({ taskId: id, goal: run.spec.goal });
  }

  return reconciled;
}

export interface ResumableTaskInfo {
  taskId: string;
  goal: string;
  status: TaskRun["status"];
  updatedAt: number; // mtime, ms since epoch — used to pick the MOST RECENT one when no id is given
}

/**
 * A task is "resumable" if it stopped without finishing — `escalated` or
 * `halted`, never `done` (nothing to resume) or `running` (still actually
 * in flight, or an orphan `reconcileOrphanedTasks` hasn't caught yet).
 * File mtime stands in for "most recent" since `TaskRun` itself has no
 * `updatedAt` field — `saveTaskRun` rewrites the whole file on every
 * change, so mtime is exact.
 */
export async function findResumableTasks(root: string): Promise<ResumableTaskInfo[]> {
  const ids = await listTaskRuns(root);
  const results: ResumableTaskInfo[] = [];
  for (const id of ids) {
    const run = await loadTaskRun(root, id);
    if (!run || (run.status !== "escalated" && run.status !== "halted")) continue;
    const stat = await fs.stat(createKooderPaths(root).taskFile(id)).catch(() => null);
    results.push({ taskId: id, goal: run.spec.goal, status: run.status, updatedAt: stat?.mtimeMs ?? 0 });
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findMostRecentResumableTask(root: string): Promise<ResumableTaskInfo | null> {
  const all = await findResumableTasks(root);
  return all[0] ?? null;
}
