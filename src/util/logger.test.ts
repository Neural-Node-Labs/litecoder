// xcoder:version 2 | xcoder:task task-a616bd | xcoder:updated 2026-08-05T07:30:47.591Z | xcoder:subtask test-st-a0969d
import { describe, it, expect, vi, afterEach } from "vitest";
import { log } from "./logger.js";

describe("logger", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    consoleLogSpy?.mockRestore();
  });

  function setupSpy() {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  }

  it("exports an object with expected methods", () => {
    expect(log).toHaveProperty("orchestrator");
    expect(typeof log.orchestrator).toBe("function");
    expect(log).toHaveProperty("agent");
    expect(typeof log.agent).toBe("function");
    expect(log).toHaveProperty("ok");
    expect(typeof log.ok).toBe("function");
    expect(log).toHaveProperty("fail");
    expect(typeof log.fail).toBe("function");
    expect(log).toHaveProperty("dim");
    expect(typeof log.dim).toBe("function");
    expect(log).toHaveProperty("raw");
    expect(typeof log.raw).toBe("function");
    expect(log).toHaveProperty("sumurai");
    expect(typeof log.sumurai).toBe("function");
    expect(log).toHaveProperty("ninj");
    expect(typeof log.ninj).toBe("function");
  });

  describe("log.orchestrator", () => {
    it("calls console.log with orchestrator prefix", () => {
      setupSpy();
      log.orchestrator("test message");
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0];
      // At minimum, should contain the message
      expect(call.join(" ")).toContain("test message");
    });

    it("does not throw", () => {
      expect(() => log.orchestrator("hello")).not.toThrow();
    });
  });

  describe("log.agent", () => {
    it("calls console.log with agent id", () => {
      setupSpy();
      log.agent("agent-1", "thinking...");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("does not throw with empty strings", () => {
      expect(() => log.agent("", "")).not.toThrow();
    });
  });

  describe("log.ok", () => {
    it("calls console.log", () => {
      setupSpy();
      log.ok("all good");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("does not throw", () => {
      expect(() => log.ok("success")).not.toThrow();
    });
  });

  describe("log.fail", () => {
    it("calls console.log", () => {
      setupSpy();
      log.fail("something broke");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("does not throw", () => {
      expect(() => log.fail("error")).not.toThrow();
    });
  });

  describe("log.dim", () => {
    it("calls console.log", () => {
      setupSpy();
      log.dim("dim text");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("does not throw", () => {
      expect(() => log.dim("faint")).not.toThrow();
    });
  });

  describe("log.raw", () => {
    it("calls console.log with the exact message", () => {
      setupSpy();
      log.raw("raw output");
      expect(consoleLogSpy).toHaveBeenCalledWith("raw output");
    });

    it("does not throw with empty string", () => {
      expect(() => log.raw("")).not.toThrow();
    });

    it("does not throw with long string", () => {
      setupSpy();
      const long = "x".repeat(10000);
      expect(() => log.raw(long)).not.toThrow();
    });
  });

  describe("log.sumurai", () => {
    it("calls console.log", () => {
      setupSpy();
      log.sumurai("samurai message");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("does not throw", () => {
      expect(() => log.sumurai("test")).not.toThrow();
    });
  });

  describe("log.ninj", () => {
    it("calls console.log", () => {
      setupSpy();
      log.ninj("ninj message");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("does not throw", () => {
      expect(() => log.ninj("test")).not.toThrow();
    });
  });

  describe("output format (without colors on non-TTY)", () => {
    it("raw outputs the exact message without escape codes", () => {
      setupSpy();
      log.raw("hello world");
      const call = consoleLogSpy.mock.calls[0];
      expect(call[0]).toBe("hello world");
    });

    it("all methods call console.log without throwing", () => {
      setupSpy();
      expect(() => log.orchestrator("o")).not.toThrow();
      expect(() => log.agent("a", "m")).not.toThrow();
      expect(() => log.ok("ok")).not.toThrow();
      expect(() => log.fail("f")).not.toThrow();
      expect(() => log.dim("d")).not.toThrow();
      expect(() => log.raw("r")).not.toThrow();
      expect(() => log.sumurai("s")).not.toThrow();
      expect(() => log.ninj("n")).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalledTimes(8);
    });
  });
});
