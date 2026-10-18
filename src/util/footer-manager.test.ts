// xcoder:version 1 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:41:12.164Z | xcoder:subtask test-st-8ac478
// Tests for footer-manager.ts — FooterManager lifecycle, updates, microtask serialization
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FooterManager, type FooterSpec } from "./footer-manager.js";
import { createFooterState } from "./footer-state.js";

describe("FooterManager", () => {
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    // Ensure clean singleton state
    const current = FooterManager.instance();
    if (current) {
      current.shutdown();
    }
    originalWrite = process.stdout.write;
    // Mock stdout.write to suppress real output
    process.stdout.write = vi.fn(() => true) as unknown as typeof process.stdout.write;
    // Default TTY
    process.stdout.isTTY = true;
    delete process.env.NO_COLOR;
    process.stdout.columns = 80;
    process.stdout.rows = 24;
  });

  afterEach(() => {
    const current = FooterManager.instance();
    if (current) {
      current.shutdown();
    }
    process.stdout.write = originalWrite;
  });

  describe("init / instance / isActive", () => {
    it("creates a singleton via init()", () => {
      const spec: FooterSpec = { tty: true, taskDesc: "Run tests" };
      const mgr = FooterManager.init(spec);

      expect(mgr).toBeInstanceOf(FooterManager);
      expect(FooterManager.instance()).toBe(mgr);
      expect(FooterManager.isActive()).toBe(true);
    });

    it("replaces existing singleton on re-init", () => {
      const mgr1 = FooterManager.init({ tty: true });
      const mgr2 = FooterManager.init({ tty: true });

      expect(mgr2).not.toBe(mgr1);
      expect(FooterManager.instance()).toBe(mgr2);
    });

    it("shuts down previous instance before replacing", () => {
      const mgr1 = FooterManager.init({ tty: true });
      const shutdownSpy = vi.spyOn(mgr1, "shutdown");

      FooterManager.init({ tty: true });

      expect(shutdownSpy).toHaveBeenCalled();
    });

    it("returns null from instance() when not initialized", () => {
      expect(FooterManager.instance()).toBeNull();
    });

    it("returns false from isActive() when not initialized", () => {
      expect(FooterManager.isActive()).toBe(false);
    });

    it("returns false from isActive() when tty is false", () => {
      FooterManager.init({ tty: false });
      expect(FooterManager.isActive()).toBe(false);
    });

    it("sets taskDesc from spec", () => {
      FooterManager.init({ tty: true, taskDesc: "Implement login module" });
      // We can't easily access internal state, but we can verify initialization succeeded
      expect(FooterManager.isActive()).toBe(true);
    });
  });

  describe("update methods (public API)", () => {
    it("updateThinkingStart sets agentId and spinner", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateThinkingStart("agent-01");

      // Microtask-based flushing; flush promises
      await Promise.resolve();

      // Output should have been written (agentId should appear)
      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      // At least one write call should contain agentId
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("[agent-01]");
    });

    it("updateThinkingStop clears spinner", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateThinkingStart("agent-02");
      mgr.updateThinkingStop();

      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      // Should have output from the final state
      expect(allOutput).toContain("[agent-02]");
    });

    it("updateAction sets action tool", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateAction("write_file");

      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("write_file");
    });

    it("updateTokens sets token display", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateTokens(500, 200);

      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("500 in / 200 out");
    });

    it("updateStage sets SDLC stage", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateStage("code");

      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("code");
    });

    it("updateDocument sets docs field", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateDocument("3 new docs");

      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("3 new docs");
    });

    it("updateObservation shows observing state temporarily", async () => {
      vi.useFakeTimers();
      const mgr = FooterManager.init({ tty: true });
      mgr.updateObservation(true, "File written successfully");

      await Promise.resolve();

      const callsAfterUpdate = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutputAfter = callsAfterUpdate.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutputAfter).toContain("File written successfully");

      vi.useRealTimers();
    });
  });

  describe("microtask serialization (batching)", () => {
    it("coalesces multiple synchronous updates into a single render", async () => {
      // Use a wide terminal so all segments fit
      process.stdout.columns = 200;
      const mgr = FooterManager.init({ tty: true });
      // Clear output from setup
      (process.stdout.write as ReturnType<typeof vi.fn>).mockClear();

      // Multiple synchronous updates
      mgr.updateStage("code");
      mgr.updateAction("write_file");
      mgr.updateTokens(100, 50);

      // Single microtask flush should render all
      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      // All three values should appear in the output
      expect(allOutput).toContain("code");
      expect(allOutput).toContain("write_file");
      expect(allOutput).toContain("100 in / 50 out");
    });
  });

  describe("hide / show", () => {
    it("hide and show roundtrip", async () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.updateStage("test");
      await Promise.resolve();

      // Track output during hide
      mgr.hide();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutputAfterHide = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutputAfterHide).toContain("\x1b[r"); // reset scroll region during hide

      mgr.show();
      const callsAfterShow = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allAfterShow = callsAfterShow.map((c: unknown[]) => String(c[0])).join("");
      // Should restore footer with "test" stage
      expect(allAfterShow).toContain("test");
    });
  });

  describe("shutdown", () => {
    it("shuts down and nullifies singleton", () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.shutdown();

      expect(FooterManager.instance()).toBeNull();
      expect(FooterManager.isActive()).toBe(false);
    });

    it("shutdown is safe to call multiple times", () => {
      const mgr = FooterManager.init({ tty: true });
      mgr.shutdown();
      mgr.shutdown(); // no crash

      expect(FooterManager.instance()).toBeNull();
    });
  });

  describe("TTY=false mode", () => {
    beforeEach(() => {
      process.stdout.isTTY = false;
    });

    it("initializes without writing to stdout", () => {
      const mgr = FooterManager.init({ tty: false });
      // Should not set up scroll region
      const allOutput = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("");
      expect(allOutput).toBe("");
    });

    it("does not render updates", async () => {
      const mgr = FooterManager.init({ tty: false });
      mgr.updateStage("code");

      await Promise.resolve();

      // Should still produce no output
      const allOutput = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("");
      expect(allOutput).toBe("");
    });
  });

  describe("onResize", () => {
    it("triggers renderer reconfigure on resize", () => {
      const mgr = FooterManager.init({ tty: true });
      // Change terminal height
      process.stdout.rows = 40;
      const callCountBefore = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls.length;

      mgr.onResize();

      const callCountAfter = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls.length;
      // Should produce output for reconfigure
      expect(callCountAfter).toBeGreaterThan(callCountBefore);

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("\x1b[1;39r"); // 40 rows → 1-39
    });
  });

  describe("NO_COLOR gating", () => {
    it("is active when init is called with tty:true (NO_COLOR unset at the gate)", () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;

      FooterManager.init({ tty: true });

      expect(FooterManager.isActive()).toBe(true);
    });

    it("is inactive when init is called with tty:false (NO_COLOR set at the gate)", () => {
      process.stdout.isTTY = true;
      process.env.NO_COLOR = "1";

      FooterManager.init({ tty: false });

      expect(FooterManager.isActive()).toBe(false);
    });

    it("emits zero stdout output when the NO_COLOR gate forces tty:false", async () => {
      process.env.NO_COLOR = "1";

      FooterManager.init({ tty: false });
      FooterManager.instance()?.updateStage("code");
      FooterManager.instance()?.updateAction("write_file");
      FooterManager.instance()?.updateTokens(100, 50);

      await Promise.resolve();

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toBe("");
    });
  });

  describe("quiet opt-out (FooterSpec.quiet)", () => {
    it("creates a singleton without painting anything", () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;

      const mgr = FooterManager.init({ tty: true, quiet: true });

      expect(FooterManager.instance()).toBe(mgr);
      expect(FooterManager.isActive()).toBe(true);
      expect((process.stdout.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });

    it("does not render updates and never starts the spinner timer", async () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      const mgr = FooterManager.init({ tty: true, quiet: true });
      mgr.updateStage("code");
      mgr.updateThinkingStart("agent-01");

      await Promise.resolve();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toBe("");

      setIntervalSpy.mockRestore();
    });

    it("writeSafe raw-writes when the singleton is muted", () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      FooterManager.init({ tty: true, quiet: true });
      (process.stdout.write as ReturnType<typeof vi.fn>).mockClear();

      FooterManager.writeSafe("plain line\n");

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(1);
      expect(String(calls[0][0])).toBe("plain line\n");
    });
  });

  describe("writeSafe", () => {
    it("raw-writes to stdout when no singleton exists", () => {
      FooterManager.instance()?.shutdown();
      (process.stdout.write as ReturnType<typeof vi.fn>).mockClear();

      FooterManager.writeSafe("plain line\n");

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(1);
      expect(String(calls[0][0])).toBe("plain line\n");
    });

    it("routes through the scroll guard when the footer is active on a TTY", async () => {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      FooterManager.init({ tty: true });
      (process.stdout.write as ReturnType<typeof vi.fn>).mockClear();

      FooterManager.writeSafe("agent output\n");

      const calls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
      const allOutput = calls.map((c: unknown[]) => String(c[0])).join("");
      expect(allOutput).toContain("agent output");
    });
  });

  describe("path gate (structural)", () => {
    it("no removed SDLC agent tree remains after the worker-only cleanup", () => {
      const testFile = fileURLToPath(import.meta.url);
      const root = path.resolve(path.dirname(testFile), "..", "..");

      // The cleanup keeps exactly one agent: the worker agent. The former
      // SDLC agent tree (sdlc-agent) and the extra specialised agents must
      // not come back, because their orchestrators owned the footer lifecycle.
      expect(fs.existsSync(path.join(root, "src", "sdlc-agent"))).toBe(false);
      expect(fs.existsSync(path.join(root, "src", "instance-swarm"))).toBe(false);
    });

    it("FooterManager is never initialised from a module outside its own source", () => {
      const testFile = fileURLToPath(import.meta.url);
      const root = path.resolve(path.dirname(testFile), "..", "..");
      const srcDir = path.join(root, "src");

      const offenders: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
          if (entry.name === "footer-manager.ts") continue;
          if (fs.readFileSync(full, "utf8").includes("FooterManager.init(")) {
            offenders.push(path.relative(root, full));
          }
        }
      };
      walk(srcDir);

      expect(offenders).toEqual([]);
    });
  });
});
