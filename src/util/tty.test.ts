// xcoder:version 1 | xcoder:task task-e53af9 | xcoder:updated 2026-08-13T14:03:25.981Z | xcoder:subtask code-st-a2df76
// Regression tests for the centralized interactive-stdout gate.
// The footer is available only when this gate passes (TTY + NO_COLOR unset).
import { describe, it, expect, afterEach } from "vitest";
import { isInteractiveStdout } from "./tty.js";

describe("isInteractiveStdout", () => {
  const originalIsTTY = (process.stdout as unknown as { isTTY: boolean }).isTTY;
  const originalNoColor = process.env.NO_COLOR;

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

  it("is true when stdout is a TTY and NO_COLOR is unset", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    delete process.env.NO_COLOR;
    expect(isInteractiveStdout()).toBe(true);
  });

  it("is false when stdout is not a TTY (piped output stays clean)", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    delete process.env.NO_COLOR;
    expect(isInteractiveStdout()).toBe(false);
  });

  it("is false when NO_COLOR is set even if stdout is a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    process.env.NO_COLOR = "1";
    expect(isInteractiveStdout()).toBe(false);
  });

  it("is false when NO_COLOR is set and stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
    process.env.NO_COLOR = "1";
    expect(isInteractiveStdout()).toBe(false);
  });
});
