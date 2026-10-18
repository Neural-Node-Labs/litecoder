// xcoder:version 2 | xcoder:task task-a616bd | xcoder:updated 2026-08-05T06:55:06.443Z | xcoder:subtask code-st-ff561d
import { describe, it, expect, vi } from "vitest";
import { silentTerminal } from "./terminal-silent.js";

describe("SilentTerminal", () => {
  describe("startThinking", () => {
    it("returns an object with stop and fail methods that do not throw", () => {
      const spinner = silentTerminal.startThinking("agent-1");
      expect(spinner).toBeDefined();
      expect(typeof spinner.stop).toBe("function");
      expect(typeof spinner.fail).toBe("function");
      expect(() => spinner.stop("thought")).not.toThrow();
      expect(() => spinner.fail("msg")).not.toThrow();
    });

    it("does not write to console when called", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const spinner = silentTerminal.startThinking("agent-5");
      spinner.stop("completed thinking");
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  describe("printAction", () => {
    it("does not throw with any arguments", () => {
      expect(() => silentTerminal.printAction("agent-1", "tool", { key: "val" })).not.toThrow();
    });

    it("accepts calls with partial arguments", () => {
      // The interface requires 3 args, but the silent no-op accepts unknown params
      expect(() => silentTerminal.printAction("", "", {})).not.toThrow();
    });
  });

  describe("printObservation", () => {
    it("does not throw with boolean and string", () => {
      expect(() => silentTerminal.printObservation("agent-1", true, "all good")).not.toThrow();
      expect(() => silentTerminal.printObservation("agent-1", false, "error")).not.toThrow();
    });
  });

  describe("printTokens", () => {
    it("does not throw with token data", () => {
      expect(() =>
        silentTerminal.printTokens(
          "agent-1",
          { inputTokens: 100, outputTokens: 50 },
          { inputTokens: 500, outputTokens: 300 },
        )
      ).not.toThrow();
    });
  });

  describe("printProtocolError", () => {
    it("does not throw", () => {
      expect(() =>
        silentTerminal.printProtocolError("agent-1", "invalid contract")
      ).not.toThrow();
    });
  });

  describe("printDuplicateWarning", () => {
    it("does not throw", () => {
      expect(() =>
        silentTerminal.printDuplicateWarning("agent-1", "duplicate action")
      ).not.toThrow();
    });
  });

  describe("printCrash", () => {
    it("does not throw", () => {
      expect(() =>
        silentTerminal.printCrash("agent-1", "unexpected error")
      ).not.toThrow();
    });
  });

  describe("printFinalAnswer", () => {
    it("does not throw", () => {
      expect(() =>
        silentTerminal.printFinalAnswer("agent-1", "summary text")
      ).not.toThrow();
    });
  });

  describe("taskIntro", () => {
    it("does not throw", () => {
      expect(() => silentTerminal.taskIntro("task-1", "build feature")).not.toThrow();
    });
  });

  describe("taskOutro", () => {
    it("does not throw", () => {
      expect(() => silentTerminal.taskOutro("completed")).not.toThrow();
    });
  });

  describe("orchestratorNote", () => {
    it("does not throw", () => {
      expect(() => silentTerminal.orchestratorNote("orchestrator message")).not.toThrow();
    });
  });

  describe("printInterruptSummary", () => {
    it("does not throw", () => {
      expect(() =>
        silentTerminal.printInterruptSummary({
          taskId: "task-1",
          doneCount: 3,
          totalCount: 10,
          command: "resume",
          file: "/path/to/file",
        })
      ).not.toThrow();
    });
  });

  describe("no console output", () => {
    it("never calls console.log, console.warn, or console.error", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      silentTerminal.startThinking("a");
      silentTerminal.printAction("a", "t", {});
      silentTerminal.printObservation("a", true, "ok");
      silentTerminal.printTokens("a", { inputTokens: 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 });
      silentTerminal.printProtocolError("a", "err");
      silentTerminal.printDuplicateWarning("a", "warn");
      silentTerminal.printCrash("a", "crash");
      silentTerminal.printFinalAnswer("a", "done");
      silentTerminal.taskIntro("t", "goal");
      silentTerminal.taskOutro("ok");
      silentTerminal.orchestratorNote("note");
      silentTerminal.printInterruptSummary({
        taskId: "t1",
        doneCount: 0,
        totalCount: 1,
        command: "r",
        file: "/f",
      });

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe("implements TerminalOutput interface", () => {
    it("has all required methods", () => {
      expect(typeof silentTerminal.startThinking).toBe("function");
      expect(typeof silentTerminal.printAction).toBe("function");
      expect(typeof silentTerminal.printObservation).toBe("function");
      expect(typeof silentTerminal.printTokens).toBe("function");
      expect(typeof silentTerminal.printProtocolError).toBe("function");
      expect(typeof silentTerminal.printDuplicateWarning).toBe("function");
      expect(typeof silentTerminal.printCrash).toBe("function");
      expect(typeof silentTerminal.printFinalAnswer).toBe("function");
      expect(typeof silentTerminal.taskIntro).toBe("function");
      expect(typeof silentTerminal.taskOutro).toBe("function");
      expect(typeof silentTerminal.orchestratorNote).toBe("function");
      expect(typeof silentTerminal.printInterruptSummary).toBe("function");
    });
  });
});
