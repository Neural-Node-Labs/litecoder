// xcoder:version 1 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:40:45.589Z | xcoder:subtask test-st-8ac478
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveTaskRunSync, loadTaskRun, saveTaskRun } from "./task-store.js";
import type { TaskRun } from "../types.js";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";

const TEST_ROOT = path.join(process.cwd(), ".kooder-test-task-store");

function makeRun(overrides?: Partial<TaskRun>): TaskRun {
  const baseSpec = {
    taskId: "test-task-001",
    goal: "test goal",
    inputs: { freeText: "test prompt" },
    constraints: { maxHealingAttempts: 3, concurrency: 1 },
    createdAt: new Date().toISOString(),
  };

  const merged = {
    spec: { ...baseSpec, ...overrides?.spec },
    dag: overrides?.dag ?? [],
    status: overrides?.status ?? ("running" as const),
    escalations: overrides?.escalations ?? [],
    orchestratorTrace: overrides?.orchestratorTrace ?? [],
    finalDeliverable: overrides?.finalDeliverable ?? undefined,
    totalTokenUsage: overrides?.totalTokenUsage ?? { inputTokens: 100, outputTokens: 50 },
  };

  return merged as TaskRun;
}

describe("saveTaskRunSync", () => {
  beforeEach(() => {
    // Ensure clean state
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  afterEach(() => {
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  it("creates the .kooder/tasks directory and writes JSON", () => {
    const run = makeRun();
    saveTaskRunSync(TEST_ROOT, run);

    const filePath = path.join(TEST_ROOT, ".kooder", "tasks", "test-task-001.json");
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.status).toBe("running");
    expect(parsed.spec.taskId).toBe("test-task-001");
  });

  it("writes valid JSON that can be loaded by loadTaskRun", async () => {
    const base = makeRun();
    const run: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-sync-001",
        goal: "sync goal",
        inputs: { freeText: "sync test" },
      },
      status: "halted",
    };
    saveTaskRunSync(TEST_ROOT, run);

    const loaded = await loadTaskRun(TEST_ROOT, "task-sync-001");
    expect(loaded).toBeTruthy();
    expect(loaded!.status).toBe("halted");
    expect(loaded!.spec.goal).toBe("sync goal");
  });

  it("overwrites an existing task file", () => {
    const base = makeRun();
    const run1: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-overwrite",
        goal: "first write",
        inputs: { freeText: "test" },
      },
      status: "running",
    };
    saveTaskRunSync(TEST_ROOT, run1);

    const run2: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-overwrite",
        goal: "second write",
        inputs: { freeText: "test" },
      },
      status: "halted",
    };
    saveTaskRunSync(TEST_ROOT, run2);

    const filePath = path.join(TEST_ROOT, ".kooder", "tasks", "task-overwrite.json");
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.status).toBe("halted");
    expect(parsed.spec.goal).toBe("second write");
  });

  it("preserves full TaskRun structure including dag and trace", () => {
    const base = makeRun();
    const fullRun: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-full",
        goal: "full load test",
        inputs: { freeText: "full test" },
      },
      status: "running",
      dag: [{ id: "st-1", stage: "code", role: "programmer", engine: "react-v1", dependsOn: [], goal: "do it", upstreamContext: {}, deliverableSpec: "result", acceptanceCriteria: [], status: "done", healing: { attempts: 0, maxAttempts: 3, log: [] } }],
      orchestratorTrace: [{ thought: "started", action: null, observation: "running" }],
      totalTokenUsage: { inputTokens: 1000, outputTokens: 500 },
    };
    saveTaskRunSync(TEST_ROOT, fullRun);

    const filePath = path.join(TEST_ROOT, ".kooder", "tasks", "task-full.json");
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.dag).toHaveLength(1);
    expect(parsed.dag[0].id).toBe("st-1");
    expect(parsed.orchestratorTrace).toHaveLength(1);
    expect(parsed.totalTokenUsage.inputTokens).toBe(1000);
  });

  it("writes pretty-printed JSON with 2-space indent", () => {
    const run = makeRun();
    saveTaskRunSync(TEST_ROOT, run);

    const filePath = path.join(TEST_ROOT, ".kooder", "tasks", "test-task-001.json");
    const raw = readFileSync(filePath, "utf8");
    // Check that it's actually pretty-printed by looking for newlines and indentation
    expect(raw).toContain("\n");
    expect(raw).toContain('  "'); // 2-space indentation
  });

  it("does not use temp-file-and-rename (non-atomic, direct write)", () => {
    const base = makeRun();
    const run: TaskRun = {
      ...base,
      spec: { ...base.spec, taskId: "task-no-tmp", goal: "test", inputs: { freeText: "test" } },
    };
    saveTaskRunSync(TEST_ROOT, run);

    const tasksDir = path.join(TEST_ROOT, ".kooder", "tasks");
    const files = require("node:fs").readdirSync(tasksDir);
    const tmpFiles = files.filter((f: string) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("handles deep directory creation for nested test roots", () => {
    const deepRoot = path.join(TEST_ROOT, "deep", "nested", "workspace");
    const base = makeRun();
    const run: TaskRun = {
      ...base,
      spec: { ...base.spec, taskId: "deep-task", goal: "test", inputs: { freeText: "test" } },
    };
    saveTaskRunSync(deepRoot, run);

    const filePath = path.join(deepRoot, ".kooder", "tasks", "deep-task.json");
    expect(existsSync(filePath)).toBe(true);
  });
});

// Also test async saveTaskRun for completeness of the save/load cycle
describe("saveTaskRun (async)", () => {
  beforeEach(() => {
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {}
  });

  it("can load what async save saves", async () => {
    const base = makeRun();
    const run: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-async-001",
        goal: "async save",
        inputs: { freeText: "test" },
      },
      status: "done",
    };
    await saveTaskRun(TEST_ROOT, run);

    const loaded = await loadTaskRun(TEST_ROOT, "task-async-001");
    expect(loaded).toBeTruthy();
    expect(loaded!.status).toBe("done");
  });

  it("async save does not leave .tmp files after atomic rename", async () => {
    const base = makeRun();
    const run: TaskRun = {
      ...base,
      spec: { ...base.spec, taskId: "task-no-tmp-async", goal: "test", inputs: { freeText: "test" } },
    };
    await saveTaskRun(TEST_ROOT, run);

    const tasksDir = path.join(TEST_ROOT, ".kooder", "tasks");
    const files = require("node:fs").readdirSync(tasksDir);
    const tmpFiles = files.filter((f: string) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("sync save can be a fallback after async save completes (same data)", async () => {
    const base = makeRun();
    const run1: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-fallback",
        goal: "async first",
        inputs: { freeText: "test" },
      },
      status: "running",
    };
    await saveTaskRun(TEST_ROOT, run1);

    // Now sync-save an updated version — emulating the fallback path
    const run2: TaskRun = {
      ...base,
      spec: {
        ...base.spec,
        taskId: "task-fallback",
        goal: "sync fallback",
        inputs: { freeText: "test" },
      },
      status: "halted",
    };
    saveTaskRunSync(TEST_ROOT, run2);

    const loaded = await loadTaskRun(TEST_ROOT, "task-fallback");
    expect(loaded!.status).toBe("halted");
    expect(loaded!.spec.goal).toBe("sync fallback");
  });
});
