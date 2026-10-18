import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startThinking, type ThinkingHandle } from "./thinking-spinner.js";

// ── Helpers ──

function captureStdout(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const mock = vi.spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown, _encoding?: unknown, _cb?: unknown): boolean => {
      const str = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      output.push(str);
      return true;
    }) as typeof process.stdout.write,
  );
  return {
    output,
    restore: () => mock.mockRestore(),
  };
}

function setupTty(interactive: boolean): () => void {
  const originalIsTTY = (process.stdout as unknown as { isTTY: boolean }).isTTY;
  const originalNoColor = process.env.NO_COLOR;

  Object.defineProperty(process.stdout, "isTTY", {
    value: interactive,
    configurable: true,
    writable: true,
  });

  if (interactive) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = "1";
  }

  return () => {
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
  };
}

// ── Tests ──

describe("startThinking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("TTY mode (interactive)", () => {
    let restoreEnv: () => void;

    beforeEach(() => {
      restoreEnv = setupTty(true);
    });

    afterEach(() => {
      restoreEnv();
    });

    it("writes ANSI sequences and a first frame on start", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        expect(output.length).toBeGreaterThan(0);

        // Should hide cursor
        expect(output.some((s) => s.includes("\x1b[?25l"))).toBe(true);
        // Should contain the label
        expect(output.some((s) => s.includes("samurai"))).toBe(true);
        // Should contain a glyph from Braille or ASCII frames
        const frameText = output.join("");
        expect(frameText).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\-\\]/);

        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("stop() clears the line, shows cursor, and writes a success message", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        // Advance a few ticks
        vi.advanceTimersByTime(500);
        const preStopLength = output.length;

        handle.stop("response received");

        const postOutput = output.slice(preStopLength).join("");
        expect(postOutput).toContain("\x1b[2K"); // clear line
        expect(postOutput).toContain("\x1b[?25h"); // show cursor
        expect(postOutput).toContain("✓ response received");
      } finally {
        restore();
      }
    });

    it("fail() clears the line, shows cursor, and writes a failure message", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(200);

        handle.fail("llm_error: timeout");

        const postOutput = output.join("");
        expect(postOutput).toContain("\x1b[2K");
        expect(postOutput).toContain("\x1b[?25h");
        expect(postOutput).toContain("✗ llm_error: timeout");
      } finally {
        restore();
      }
    });

    it("cycles colors across ticks", () => {
      const { output, restore } = captureStdout();
      try {
        startThinking("samurai");

        // Collect frames across many ticks
        const colorCodes = new Set<string>();
        for (let i = 0; i < 20; i++) {
          vi.advanceTimersByTime(100);
          output.forEach((s) => {
            const match = s.match(/\x1b\[38;5;(\d+)m/);
            if (match) colorCodes.add(match[1]);
          });
        }

        // Should cycle through at least 2 different colors
        expect(colorCodes.size).toBeGreaterThanOrEqual(2);
      } finally {
        restore();
      }
    });

    it("pause() clears the line and shows cursor", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(300);

        handle.pause();

        const postOutput = output.join("");
        expect(postOutput).toContain("\x1b[2K");
        expect(postOutput).toContain("\x1b[?25h");
      } finally {
        restore();
      }
    });

    it("resume() re-hides cursor and restarts animation", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(300);
        handle.pause();

        // Clear previous output to isolate resume content
        output.length = 0;

        handle.resume();

        const postOutput = output.join("");
        expect(postOutput).toContain("\x1b[?25l"); // re-hide cursor
        expect(postOutput).toContain("samurai thinking…");

        // Advance a tick to confirm the interval is running
        output.length = 0;
        vi.advanceTimersByTime(100);
        expect(output.join("")).toContain("samurai thinking…");

        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("multiple start/stop cycles leave no artifacts", () => {
      // Simulate consecutive LLM calls: start/stop, start/stop
      const { output, restore } = captureStdout();
      try {
        let handle = startThinking("samurai");
        vi.advanceTimersByTime(200);
        handle.stop("response 1");

        // Second cycle
        handle = startThinking("samurai");
        vi.advanceTimersByTime(200);
        handle.stop("response 2");

        const fullOutput = output.join("");
        // Should have two success messages, two cursor hides, two cursor shows
        const cursorHides = (fullOutput.match(/\x1b\[\?25l/g) || []).length;
        const cursorShows = (fullOutput.match(/\x1b\[\?25h/g) || []).length;
        expect(cursorHides).toBe(2);
        expect(cursorShows).toBe(2);
        expect(fullOutput).toContain("✓ response 1");
        expect(fullOutput).toContain("✓ response 2");
      } finally {
        restore();
      }
    });

    it("stop() is idempotent (no duplicate cleanup)", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        handle.stop("done");
        const afterFirstStop = output.length;

        // Second stop should not write anything new
        handle.stop("should not appear");
        expect(output.length).toBe(afterFirstStop);
      } finally {
        restore();
      }
    });

    it("pause() is idempotent (no duplicate cleanup)", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(300);
        handle.pause();
        const afterFirstPause = output.length;

        // Second pause should not write anything new
        handle.pause();
        expect(output.length).toBe(afterFirstPause);

        handle.resume();
        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("resume() when not paused is a no-op", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(300);
        const preResumeLength = output.length;

        // Resume without pause should not write anything
        handle.resume();
        expect(output.length).toBe(preResumeLength);

        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("pause() after stop() is a no-op", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        handle.stop("done");
        const afterStop = output.length;

        handle.pause();
        expect(output.length).toBe(afterStop);
      } finally {
        restore();
      }
    });

    it("resume() after stop() is a no-op", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        handle.stop("done");
        const afterStop = output.length;

        handle.resume();
        expect(output.length).toBe(afterStop);
      } finally {
        restore();
      }
    });

    it("fail() is idempotent (no duplicate cleanup)", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        handle.fail("error");
        const afterFirstFail = output.length;

        // Second fail should not write anything new
        handle.fail("should not appear");
        expect(output.length).toBe(afterFirstFail);
      } finally {
        restore();
      }
    });

    it("multiple pause/resume cycles work correctly", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");

        // Cycle 1: pause/resume
        vi.advanceTimersByTime(300);
        handle.pause();
        output.length = 0;
        handle.resume();
        expect(output.join("")).toContain("samurai thinking…");
        expect(output.join("")).toContain("\x1b[?25l");

        // Cycle 2: pause/resume again
        vi.advanceTimersByTime(300);
        handle.pause();
        output.length = 0;
        handle.resume();
        expect(output.join("")).toContain("samurai thinking…");

        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("handles empty label gracefully", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("");
        vi.advanceTimersByTime(200);

        const allOutput = output.join("");
        // Should still render a frame with the (empty) label
        expect(allOutput).toContain(" thinking…");
        expect(allOutput).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\-\\]/);

        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("handles long label gracefully", () => {
      const { output, restore } = captureStdout();
      try {
        const longLabel = "a".repeat(200);
        const handle = startThinking(longLabel);
        vi.advanceTimersByTime(200);

        const allOutput = output.join("");
        // Should contain the long label
        expect(allOutput).toContain(longLabel);
        expect(allOutput).toContain(" thinking…");

        handle.stop("done");
      } finally {
        restore();
      }
    });

    it("uses ASCII frames on legacy Windows console (cp1252)", () => {
      // Simulate legacy Windows: no WT_SESSION, encoding is not utf8
      const originalPlatform = process.platform;
      const originalWtSession = process.env.WT_SESSION;
      const originalEncoding = (process.stdout as NodeJS.WriteStream & { encoding?: string }).encoding;

      try {
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        delete process.env.WT_SESSION;
        delete process.env.TERMINAL_EMULATOR;
        Object.defineProperty(process.stdout, "encoding", { value: "buffer", configurable: true });

        const { output, restore: restoreCapture } = captureStdout();
        try {
          const handle = startThinking("samurai");
          const frameText = output.join("");

          // Should contain ASCII frames only, not Braille
          expect(frameText).toMatch(/[|/\-\\]/);
          expect(frameText).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);

          handle.stop("done");
        } finally {
          restoreCapture();
        }
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
        if (originalWtSession === undefined) {
          delete process.env.WT_SESSION;
        } else {
          process.env.WT_SESSION = originalWtSession;
        }
        Object.defineProperty(process.stdout, "encoding", { value: originalEncoding, configurable: true });
      }
    });
  });

  describe("non-TTY / NO_COLOR mode", () => {
    let restoreEnv: () => void;

    beforeEach(() => {
      restoreEnv = setupTty(false);
    });

    afterEach(() => {
      restoreEnv();
    });

    it("emits static Thinking… line with no ANSI codes", () => {
      const { output, restore } = captureStdout();
      try {
        startThinking("samurai");
        const allOutput = output.join("");
        expect(allOutput).toContain("Thinking… [samurai]");
        // No ANSI escape sequences
        expect(allOutput).not.toContain("\x1b[");
      } finally {
        restore();
      }
    });

    it("appends dots periodically", () => {
      const { output, restore } = captureStdout();
      try {
        startThinking("samurai");

        const initialLength = output.join("").length;
        vi.advanceTimersByTime(2100); // first dot
        expect(output.join("").length).toBeGreaterThanOrEqual(initialLength + 1);

        vi.advanceTimersByTime(2000); // second dot
        expect(output.join("").length).toBeGreaterThanOrEqual(initialLength + 2);
      } finally {
        restore();
      }
    });

    it("stop() emits a newline and success message", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(100);
        handle.stop("completed");

        const allOutput = output.join("");
        expect(allOutput).toContain("\ncompleted\n");
        // No ANSI
        expect(allOutput).not.toContain("\x1b[");
      } finally {
        restore();
      }
    });

    it("fail() emits a newline and failure message", () => {
      const { output, restore } = captureStdout();
      try {
        const handle = startThinking("samurai");
        vi.advanceTimersByTime(100);
        handle.fail("error");

        const allOutput = output.join("");
        expect(allOutput).toContain("\n✗ error\n");
      } finally {
        restore();
      }
    });
  });

  describe("NO_COLOR set (even when TTY)", () => {
    let restoreEnv: () => void;

    beforeEach(() => {
      // Make it a TTY but set NO_COLOR
      restoreEnv = setupTty(false);
      // Now override isTTY to true while keeping NO_COLOR
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      restoreEnv();
    });

    it("uses static mode with no ANSI codes", () => {
      const { output, restore } = captureStdout();
      try {
        startThinking("samurai");
        const allOutput = output.join("");
        expect(allOutput).toContain("Thinking… [samurai]");
        expect(allOutput).not.toContain("\x1b[");
      } finally {
        restore();
      }
    });
  });
});
