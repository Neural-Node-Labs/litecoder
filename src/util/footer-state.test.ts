// xcoder:version 2 | xcoder:task task-4f2baf | xcoder:updated 2026-08-05T06:15:40.533Z | xcoder:subtask test-st-99757c
// Tests for footer-state.ts — FooterState interface and createFooterState factory
import { describe, it, expect } from "vitest";
import { createFooterState, type FooterState } from "./footer-state.js";

describe("createFooterState", () => {
  it("returns default idle state with no overrides", () => {
    const state = createFooterState();
    expect(state).toEqual({
      stage: null,
      agentId: null,
      taskDesc: null,
      action: null,
      observing: false,
      spinner: false,
      tokens: null,
      docs: null,
      tty: false,
    });
  });

  it("accepts partial overrides", () => {
    const state = createFooterState({ stage: "code", spinner: true, tty: true });
    expect(state.stage).toBe("code");
    expect(state.spinner).toBe(true);
    expect(state.tty).toBe(true);
    // Un-set fields retain defaults
    expect(state.agentId).toBeNull();
    expect(state.observing).toBe(false);
  });

  it("overrides all fields when provided", () => {
    const full: FooterState = {
      stage: "test",
      agentId: "agent-01",
      taskDesc: "Write unit tests",
      action: "read_file",
      observing: true,
      spinner: true,
      tokens: "500 in / 200 out",
      docs: "3 files",
      tty: true,
    };
    const state = createFooterState(full);
    expect(state).toEqual(full);
  });

  it("creates distinct objects (no shared mutation)", () => {
    const a = createFooterState({ stage: "code" });
    const b = createFooterState({ stage: "test" });
    expect(a.stage).toBe("code");
    expect(b.stage).toBe("test");
  });

  it("treats null and undefined overrides correctly", () => {
    // JS spread preserves undefined values, so passing undefined explicitly overrides
    // the default (null) to undefined.
    const state = createFooterState({ stage: "requirements", agentId: null, taskDesc: undefined });
    expect(state.stage).toBe("requirements");
    expect(state.agentId).toBeNull();
    // undefined stays as-is in spread: it overrides the default
    expect(state.taskDesc).toBeUndefined();
  });
});
