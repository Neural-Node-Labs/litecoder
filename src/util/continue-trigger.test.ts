// xcoder:version 1 | xcoder:task task-4f2baf | xcoder:updated 2026-08-05T06:32:50.325Z | xcoder:subtask test-st-99757c
// Tests for continue-trigger.ts — isContinueTrigger
import { describe, it, expect } from "vitest";
import { isContinueTrigger } from "./continue-trigger.js";

describe("isContinueTrigger", () => {
  describe("matches 'continue'", () => {
    it("matches bare 'continue'", () => {
      expect(isContinueTrigger("continue")).toBe(true);
    });

    it("matches 'continue' with extra text after", () => {
      expect(isContinueTrigger("continue on the ui")).toBe(true);
    });

    it("matches 'Continue' (case insensitive)", () => {
      expect(isContinueTrigger("Continue")).toBe(true);
    });

    it("matches 'CONTINUE' (all caps)", () => {
      expect(isContinueTrigger("CONTINUE")).toBe(true);
    });

    it("matches 'continue' with leading/trailing whitespace", () => {
      expect(isContinueTrigger("  continue  ")).toBe(true);
    });
  });

  describe("matches 'resume'", () => {
    it("matches bare 'resume'", () => {
      expect(isContinueTrigger("resume")).toBe(true);
    });

    it("matches 'resume' with extra text", () => {
      expect(isContinueTrigger("resume the task")).toBe(true);
    });

    it("matches 'Resume' (case insensitive)", () => {
      expect(isContinueTrigger("Resume")).toBe(true);
    });
  });

  describe("matches 'keep going'", () => {
    it("matches bare 'keep going'", () => {
      expect(isContinueTrigger("keep going")).toBe(true);
    });

    it("matches 'keep going' with extra text", () => {
      expect(isContinueTrigger("keep going on the ui")).toBe(true);
    });

    it("matches 'Keep Going' (case insensitive)", () => {
      expect(isContinueTrigger("Keep Going")).toBe(true);
    });
  });

  describe("matches 'carry on'", () => {
    it("matches bare 'carry on'", () => {
      expect(isContinueTrigger("carry on")).toBe(true);
    });

    it("matches 'carry on' with extra text", () => {
      expect(isContinueTrigger("carry on with the work")).toBe(true);
    });

    it("matches 'Carry On' (case insensitive)", () => {
      expect(isContinueTrigger("Carry On")).toBe(true);
    });
  });

  describe("does not match non-trigger text", () => {
    it("does not match empty string", () => {
      expect(isContinueTrigger("")).toBe(false);
    });

    it("does not match unrelated text", () => {
      expect(isContinueTrigger("write a new feature")).toBe(false);
    });

    it("does not match 'continuing' (different word)", () => {
      expect(isContinueTrigger("continuing")).toBe(false);
    });

    it("does not match when trigger is mid-sentence", () => {
      expect(isContinueTrigger("please continue writing code")).toBe(false);
    });

    it("does not match 'resuming' (different word)", () => {
      expect(isContinueTrigger("resuming")).toBe(false);
    });

    it("does not match numbers or special chars only", () => {
      expect(isContinueTrigger("123")).toBe(false);
    });

    it("does not match 'continue' inside a larger word", () => {
      expect(isContinueTrigger("discontinue the task")).toBe(false);
    });
  });
});
