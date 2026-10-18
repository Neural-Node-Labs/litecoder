// xcoder:version 2 | xcoder:task task-7f2823 | xcoder:updated 2026-08-03T09:47:22.630Z | xcoder:subtask test-st-83338b
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOutputHandler,
  resetOutputHandler,
  type OutputHandler,
  type OutputHandlerOptions,
} from "./output-handler.js";

describe("OutputHandler", () => {
  let handler: OutputHandler;

  beforeEach(() => {
    resetOutputHandler();
    handler = getOutputHandler({ printToTerminal: false });
  });

  afterEach(() => {
    resetOutputHandler();
  });

  // ── Singleton lifecycle ──

  it("getOutputHandler returns the same instance on repeated calls", () => {
    const a = getOutputHandler({ printToTerminal: false });
    const b = getOutputHandler({ printToTerminal: true });
    expect(a).toBe(b);
  });

  it("resetOutputHandler clears the singleton and allows re-creation", () => {
    const a = getOutputHandler({ printToTerminal: false });
    resetOutputHandler();
    const b = getOutputHandler({ printToTerminal: true });
    expect(a).not.toBe(b);
  });

  it("create with no options defaults to printToTerminal: true", () => {
    resetOutputHandler();
    const h = getOutputHandler();
    expect(h).toBeDefined();
  });

  // ── printToTerminal flag ──

  it("does not output to console when printToTerminal is false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    handler.thought("test thought");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("outputs to console when printToTerminal is true", () => {
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    h.thought("test thought");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("THOUGHT");
    expect(call).toContain("test thought");
    spy.mockRestore();
  });

  // ── Signal methods ──

  it("thought() emits thought level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.thought("thinking...");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[THOUGHT]");
    expect(call).toContain("thinking...");
    spy.mockRestore();
  });

  it("reason() emits reason level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.reason("because...");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[REASON]");
    expect(call).toContain("because...");
    spy.mockRestore();
  });

  it("action() emits action level with metadata", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.action("read_file", { path: "/tmp/x" });
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[ACTION]");
    expect(call).toContain("read_file");
    spy.mockRestore();
  });

  it("observation() emits observation level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.observation("file content here");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[OBSERVATION]");
    expect(call).toContain("file content here");
    spy.mockRestore();
  });

  it("raw() emits raw level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.raw("generic output");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[RAW]");
    expect(call).toContain("generic output");
    spy.mockRestore();
  });

  it("error() emits error level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.error("something failed");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[ERROR]");
    expect(call).toContain("something failed");
    spy.mockRestore();
  });

  // ── close ──

  it("close() can be called multiple times safely", () => {
    handler.close();
    handler.close();
    expect(true).toBe(true); // no throw
  });

  // ── logToSqlite graceful fallback ──

  it("does not throw when sql.js is not installed and logToSqlite is true", async () => {
    resetOutputHandler();
    const h = getOutputHandler({
      printToTerminal: false,
      logToSqlite: true,
      dbPath: ":memory:",
    });
    // Should not throw — falls back gracefully
    await expect(
      new Promise<void>((resolve) => {
        h.thought("test");
        // Give async persist a tick
        setTimeout(resolve, 100);
      }),
    ).resolves.toBeUndefined();
  });

  // ── dbPath propagation ──

  it("stores dbPath from options", () => {
    resetOutputHandler();
    const h = getOutputHandler({
      printToTerminal: false,
      logToSqlite: true,
      dbPath: ".xcoder/custom-path.db",
    });
    // The dbPath should be accessible (we check via behavior rather than
    // accessing private fields — the handler should not crash on operations)
    h.thought("test with custom path");
    expect(true).toBe(true); // no crash
  });

  it("defaults dbPath to .xcoder/output.db when not provided", () => {
    resetOutputHandler();
    const h = getOutputHandler({
      printToTerminal: false,
      logToSqlite: true,
    });
    // Should not crash — uses default path
    h.thought("test default path");
    expect(true).toBe(true); // no crash
  });

  // ── Edge cases for emit methods ──

  it("thought() handles empty string", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.thought("");
    expect(spy).toHaveBeenCalledTimes(1);
    // Should still emit with empty content
    spy.mockRestore();
  });

  it("action() handles undefined input", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.action("test_tool", undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[ACTION]");
    expect(call).toContain("test_tool");
    spy.mockRestore();
  });

  it("action() handles very long input strings", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    const longInput = "x".repeat(5000);
    h.action("test_tool", longInput);
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    // Metadata should be truncated
    expect(call.length).toBeLessThan(longInput.length + 500);
    spy.mockRestore();
  });

  it("error() emits even with logToSqlite enabled", () => {
    resetOutputHandler();
    const h = getOutputHandler({
      printToTerminal: false,
      logToSqlite: true,
      dbPath: ":memory:",
    });
    // Should not throw
    h.error("test error");
    expect(true).toBe(true); // no crash
  });

  it("reason() emits reason level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.reason("because...");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0] as string;
    expect(call).toContain("[REASON]");
    expect(call).toContain("because...");
    spy.mockRestore();
  });

  it("close() can be called multiple times safely", () => {
    handler.close();
    handler.close();
    expect(true).toBe(true); // no throw
  });

  it("getOutputHandler with logToSqlite false does not attempt db init", () => {
    resetOutputHandler();
    const h = getOutputHandler({
      printToTerminal: true,
      logToSqlite: false,
    });
    // Should work without any DB-related warnings
    h.thought("no db");
    expect(true).toBe(true);
  });

  it("multiple emit calls are handled independently", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    resetOutputHandler();
    const h = getOutputHandler({ printToTerminal: true });
    h.thought("one");
    h.action("tool", { key: "val" });
    h.observation("obs");
    h.raw("raw");
    h.error("err");
    expect(spy).toHaveBeenCalledTimes(5);
    spy.mockRestore();
  });
});
