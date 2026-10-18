import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printSwarmSummary } from "./terminal.js";

// ── Capture clack output ──
const clackMessages: Array<{ type: string; text: string }> = [];
const clackErrors: Array<{ type: string; text: string }> = [];

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    step: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn((text: string) => {
      clackErrors.push({ type: "error", text });
    }),
    warn: vi.fn(),
    message: vi.fn((text: string) => {
      clackMessages.push({ type: "message", text });
    }),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  note: vi.fn(),
}));

describe("printSwarmSummary", () => {
  beforeEach(() => {
    clackMessages.length = 0;
    clackErrors.length = 0;
  });

  describe("format and structure", () => {
    it("does not throw with completed status", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-test",
          status: "completed",
          errors: [],
          workerCount: 3,
          crashedCount: 0,
          totalInputTokens: 500,
          totalOutputTokens: 300,
          outputDir: "/tmp/output",
        })
      ).not.toThrow();
    });

    it("does not throw with failed status", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-failed",
          status: "failed",
          errors: ["worker crashed", "protocol error"],
          workerCount: 2,
          crashedCount: 2,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          outputDir: "/tmp/output",
        })
      ).not.toThrow();
    });

    it("does not throw with timeout status", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-timeout",
          status: "timeout",
          errors: [],
          workerCount: 1,
          crashedCount: 0,
          totalInputTokens: 200,
          totalOutputTokens: 100,
          outputDir: "/tmp/output",
        })
      ).not.toThrow();
    });
  });

  describe("status message", () => {
    it("includes 'Swarm finished' in first message", () => {
      printSwarmSummary({
        instanceId: "swarm-is-done",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        outputDir: "/tmp",
      });

      const statusMessage = clackMessages.find((m) =>
        m.text.includes("Swarm finished")
      );
      expect(statusMessage).toBeDefined();
    });

    it("includes completed status with checkmark", () => {
      printSwarmSummary({
        instanceId: "swarm-is-done",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        outputDir: "/tmp",
      });

      const statusMessage = clackMessages.find((m) =>
        m.text.includes("Swarm finished")
      );
      expect(statusMessage!.text).toMatch(/✓/);
      expect(statusMessage!.text).toContain("completed");
    });

    it("includes failed status with cross mark", () => {
      printSwarmSummary({
        instanceId: "swarm-is-fail",
        status: "failed",
        errors: ["boom"],
        workerCount: 1,
        crashedCount: 1,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        outputDir: "/tmp",
      });

      const statusMessage = clackMessages.find((m) =>
        m.text.includes("Swarm finished")
      );
      expect(statusMessage!.text).toMatch(/✗/);
      expect(statusMessage!.text).toContain("failed");
    });

    it("includes timeout status with hourglass", () => {
      printSwarmSummary({
        instanceId: "swarm-is-tout",
        status: "timeout",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        outputDir: "/tmp",
      });

      const statusMessage = clackMessages.find((m) =>
        m.text.includes("Swarm finished")
      );
      expect(statusMessage!.text).toMatch(/⏱/);
      expect(statusMessage!.text).toContain("timeout");
    });
  });

  describe("instanceId display", () => {
    it("includes instanceId in output", () => {
      printSwarmSummary({
        instanceId: "swarm-is-abc123",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        outputDir: "/tmp/output",
      });

      const idMessage = clackMessages.find((m) =>
        m.text.includes("swarm-is-abc123")
      );
      expect(idMessage).toBeDefined();
    });
  });

  describe("worker count display", () => {
    it("shows completed count as workers - crashed", () => {
      printSwarmSummary({
        instanceId: "swarm-is-test",
        status: "completed",
        errors: [],
        workerCount: 10,
        crashedCount: 3,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        outputDir: "/tmp",
      });

      // Should show 7 completed, 3 crashed
      const workerMessage = clackMessages.find((m) =>
        m.text.includes("workers:")
      );
      expect(workerMessage).toBeDefined();
      expect(workerMessage!.text).toContain("7");
      expect(workerMessage!.text).toContain("3");
    });

    it("shows only completed count when no crashes", () => {
      printSwarmSummary({
        instanceId: "swarm-is-test",
        status: "completed",
        errors: [],
        workerCount: 5,
        crashedCount: 0,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        outputDir: "/tmp",
      });

      const workerMessage = clackMessages.find((m) =>
        m.text.includes("workers:")
      );
      expect(workerMessage).toBeDefined();
      expect(workerMessage!.text).toContain("5");
    });

    it("handles all workers crashed", () => {
      printSwarmSummary({
        instanceId: "swarm-is-crashed",
        status: "failed",
        errors: ["all dead"],
        workerCount: 5,
        crashedCount: 5,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        outputDir: "/tmp",
      });

      const workerMessage = clackMessages.find((m) =>
        m.text.includes("workers:")
      );
      expect(workerMessage).toBeDefined();
      expect(workerMessage!.text).toContain("0");
      expect(workerMessage!.text).toContain("5");
    });

    it("handles zero workers", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-empty",
          status: "completed",
          errors: [],
          workerCount: 0,
          crashedCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });
  });

  describe("token display", () => {
    it("displays both input and output tokens", () => {
      printSwarmSummary({
        instanceId: "swarm-is-tok",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 1234,
        totalOutputTokens: 5678,
        outputDir: "/tmp",
      });

      const tokenMessage = clackMessages.find(
        (m) =>
          m.text.includes("tokens:") &&
          m.text.includes("1234") &&
          m.text.includes("5678")
      );
      expect(tokenMessage).toBeDefined();
    });

    it("displays zero tokens correctly", () => {
      printSwarmSummary({
        instanceId: "swarm-is-zero",
        status: "completed",
        errors: [],
        workerCount: 0,
        crashedCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        outputDir: "/tmp",
      });

      const tokenMessage = clackMessages.find((m) =>
        m.text.includes("tokens:")
      );
      expect(tokenMessage).toBeDefined();
      expect(tokenMessage!.text).toContain("0 in");
      expect(tokenMessage!.text).toContain("0 out");
    });

    it("handles large token numbers", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-huge",
          status: "completed",
          errors: [],
          workerCount: 5,
          crashedCount: 0,
          totalInputTokens: 999999999,
          totalOutputTokens: 888888888,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });
  });

  describe("outputDir display", () => {
    it("displays the output directory path", () => {
      printSwarmSummary({
        instanceId: "swarm-is-dir",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        outputDir: "/home/user/projects/output",
      });

      const dirMessage = clackMessages.find(
        (m) =>
          m.text.includes("outputDir:") &&
          m.text.includes("/home/user/projects/output")
      );
      expect(dirMessage).toBeDefined();
    });
  });

  describe("errors display", () => {
    it("does not show errors when errors array is empty", () => {
      printSwarmSummary({
        instanceId: "swarm-is-noerr",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        outputDir: "/tmp",
      });

      // No error messages should be logged
      expect(clackErrors.length).toBe(0);
    });

    it("shows each error when errors are present", () => {
      printSwarmSummary({
        instanceId: "swarm-is-errs",
        status: "failed",
        errors: ["error one", "error two"],
        workerCount: 2,
        crashedCount: 2,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        outputDir: "/tmp",
      });

      // Should have the errors heading + 2 error items
      expect(clackErrors.length).toBe(2);
      expect(clackErrors[0].text).toContain("error one");
      expect(clackErrors[1].text).toContain("error two");
    });

    it("handles errors with special characters", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-special",
          status: "failed",
          errors: [
            "ANSI: \\x1b[31mcode\\x1b[0m",
            "newlines\nand\ttabs",
            "<script>alert(1)</script>",
          ],
          workerCount: 1,
          crashedCount: 1,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });
  });

  describe("non-TTY mode", () => {
    let originalIsTTY: boolean;
    let originalNoColor: string | undefined;

    beforeEach(() => {
      originalIsTTY = (process.stdout as unknown as { isTTY: boolean }).isTTY;
      originalNoColor = process.env.NO_COLOR;

      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
        writable: true,
      });
      process.env.NO_COLOR = "1";
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
        writable: true,
      });
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    });

    it("does not throw in non-TTY mode", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-ntty",
          status: "completed",
          errors: [],
          workerCount: 1,
          crashedCount: 0,
          totalInputTokens: 100,
          totalOutputTokens: 50,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });

    it("strips ANSI escape codes in non-TTY mode", () => {
      printSwarmSummary({
        instanceId: "swarm-is-plain",
        status: "completed",
        errors: [],
        workerCount: 1,
        crashedCount: 0,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        outputDir: "/tmp",
      });

      // In no-color mode, there should be no ANSI codes in messages
      for (const msg of clackMessages) {
        expect(msg.text).not.toContain("\x1b[");
      }
    });
  });

  describe("resilience to edge inputs", () => {
    it("handles very long instanceId", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-" + "x".repeat(500),
          status: "completed",
          errors: [],
          workerCount: 1,
          crashedCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });

    it("handles very long outputDir path", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-test",
          status: "completed",
          errors: [],
          workerCount: 1,
          crashedCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          outputDir: "/" + "a/".repeat(200) + "final",
        })
      ).not.toThrow();
    });

    it("handles negative token counts (defensive)", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-neg",
          status: "completed",
          errors: [],
          workerCount: 1,
          crashedCount: 0,
          totalInputTokens: -100,
          totalOutputTokens: -50,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });

    it("handles crashedCount greater than workerCount (defensive)", () => {
      expect(() =>
        printSwarmSummary({
          instanceId: "swarm-is-odd",
          status: "failed",
          errors: ["miscount"],
          workerCount: 3,
          crashedCount: 10,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          outputDir: "/tmp",
        })
      ).not.toThrow();
    });
  });
});
