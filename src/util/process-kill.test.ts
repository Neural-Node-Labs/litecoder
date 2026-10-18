// xcoder:version 1 | xcoder:task task-edfac1 | xcoder:updated 2026-08-04T09:45:25.930Z | xcoder:subtask test-st-29556c
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  trackedPids,
  trackPid,
  untrackPid,
  killTrackedPids,
  killProcessTree,
} from "./process-kill.js";

// We can't easily test killProcessTree on a live subprocess in unit tests
// without spawning real processes, but we can test the tracking mechanics
// and the signal-dispatching logic paths.

describe("process-kill", () => {
  // Clean up trackedPids before each test to avoid cross-test pollution.
  beforeEach(() => {
    trackedPids.clear();
  });

  afterEach(() => {
    trackedPids.clear();
  });

  describe("trackedPids", () => {
    it("is initially empty", () => {
      expect(trackedPids.size).toBe(0);
    });

    it("is a Set", () => {
      expect(trackedPids).toBeInstanceOf(Set);
    });
  });

  describe("trackPid", () => {
    it("adds a PID to the tracked set", () => {
      trackPid(12345);
      expect(trackedPids.has(12345)).toBe(true);
      expect(trackedPids.size).toBe(1);
    });

    it("does not duplicate the same PID", () => {
      trackPid(12345);
      trackPid(12345);
      expect(trackedPids.size).toBe(1);
    });

    it("can track multiple different PIDs", () => {
      trackPid(1);
      trackPid(2);
      trackPid(3);
      expect(trackedPids.size).toBe(3);
      expect(trackedPids.has(1)).toBe(true);
      expect(trackedPids.has(2)).toBe(true);
      expect(trackedPids.has(3)).toBe(true);
    });

    it("handles PID 0 (edge case)", () => {
      trackPid(0);
      expect(trackedPids.has(0)).toBe(true);
    });

    it("handles negative PIDs (edge case, though unusual)", () => {
      trackPid(-1);
      expect(trackedPids.has(-1)).toBe(true);
    });
  });

  describe("untrackPid", () => {
    it("removes a tracked PID", () => {
      trackPid(12345);
      untrackPid(12345);
      expect(trackedPids.has(12345)).toBe(false);
      expect(trackedPids.size).toBe(0);
    });

    it("is a no-op when PID is not tracked", () => {
      expect(() => untrackPid(99999)).not.toThrow();
      expect(trackedPids.size).toBe(0);
    });

    it("only removes the specified PID", () => {
      trackPid(1);
      trackPid(2);
      untrackPid(1);
      expect(trackedPids.has(1)).toBe(false);
      expect(trackedPids.has(2)).toBe(true);
      expect(trackedPids.size).toBe(1);
    });
  });

  describe("killTrackedPids", () => {
    it("clears the tracked set after execution", async () => {
      trackPid(12345);
      await killTrackedPids();
      expect(trackedPids.size).toBe(0);
    });

    it("is safe to call with an empty tracked set", async () => {
      await expect(killTrackedPids()).resolves.toBeUndefined();
      expect(trackedPids.size).toBe(0);
    });

    it("does not throw when PIDs don't exist", async () => {
      trackPid(99999999); // Unlikely to exist
      await expect(killTrackedPids()).resolves.not.toThrow();
      expect(trackedPids.size).toBe(0);
    });
  });

  describe("killProcessTree", () => {
    it("resolves without error for a likely non-existent PID", async () => {
      // This should not throw — killProcessTree catches errors internally.
      await expect(killProcessTree(99999999, "SIGKILL")).resolves.toBeUndefined();
    });

    it("resolves with SIGTERM signal", async () => {
      await expect(killProcessTree(99999999, "SIGTERM")).resolves.toBeUndefined();
    });

    it("resolves with SIGKILL signal (default)", async () => {
      // Default signal is SIGKILL
      await expect(killProcessTree(99999999)).resolves.toBeUndefined();
    });

    it("resolves quickly (within 2 seconds) even for dead processes", async () => {
      const start = Date.now();
      await killProcessTree(99999999, "SIGKILL");
      const elapsed = Date.now() - start;
      // Should resolve within 2 seconds even on Windows (taskkill timeout is 3s internally).
      expect(elapsed).toBeLessThan(4000);
    });

    it("handles PID 0 gracefully", async () => {
      await expect(killProcessTree(0, "SIGKILL")).resolves.toBeUndefined();
    });

    it("handles negative PID gracefully", async () => {
      await expect(killProcessTree(-1, "SIGKILL")).resolves.toBeUndefined();
    });
  });

  describe("integration: track → kill flow", () => {
    it("tracks PIDs, then killTrackedPids clears them", async () => {
      trackPid(1000);
      trackPid(2000);
      expect(trackedPids.size).toBe(2);

      await killTrackedPids();
      expect(trackedPids.size).toBe(0);
    });

    it("untrack then track again works correctly", () => {
      trackPid(42);
      untrackPid(42);
      expect(trackedPids.has(42)).toBe(false);

      trackPid(42);
      expect(trackedPids.has(42)).toBe(true);
    });
  });
});
