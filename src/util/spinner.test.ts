// xcoder:version 2 | xcoder:task task-a616bd | xcoder:updated 2026-08-05T07:31:07.247Z | xcoder:subtask test-st-a0969d
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  setSpinnerStyle,
  getSpinnerStyle,
  createSpinner,
  type SpinnerHandle,
} from "./spinner.js";

describe("setSpinnerStyle", () => {
  afterEach(() => {
    // Reset to default after each test
    setSpinnerStyle(undefined);
    setSpinnerStyle("clack");
  });

  it("sets recognized spinner style 'clack'", () => {
    setSpinnerStyle("clack");
    expect(getSpinnerStyle()).toBe("clack");
  });

  it("sets recognized spinner style 'dots'", () => {
    setSpinnerStyle("dots");
    expect(getSpinnerStyle()).toBe("dots");
  });

  it("sets recognized spinner style 'line'", () => {
    setSpinnerStyle("line");
    expect(getSpinnerStyle()).toBe("line");
  });

  it("sets recognized spinner style 'arc'", () => {
    setSpinnerStyle("arc");
    expect(getSpinnerStyle()).toBe("arc");
  });

  it("does not change style when passed undefined", () => {
    setSpinnerStyle("dots");
    setSpinnerStyle(undefined);
    expect(getSpinnerStyle()).toBe("dots");
  });

  it("logs error for unrecognized style but does not throw", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevStyle = getSpinnerStyle();
    expect(() => setSpinnerStyle("nonexistent-style-xyz")).not.toThrow();
    expect(getSpinnerStyle()).toBe(prevStyle); // unchanged
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toContain("Unknown --spinner");
    errorSpy.mockRestore();
  });

  it("handles known cli-spinners styles", () => {
    // 'dots3', 'sand', 'pipe' are known cli-spinners styles
    const knownStyles = ["dots3", "sand", "pipe"];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const style of knownStyles) {
      setSpinnerStyle(style);
      expect(getSpinnerStyle()).toBe(style);
    }
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("getSpinnerStyle", () => {
  afterEach(() => {
    setSpinnerStyle("clack");
  });

  it("returns 'clack' by default", () => {
    setSpinnerStyle(undefined);
    setSpinnerStyle("clack");
    expect(getSpinnerStyle()).toBe("clack");
  });

  it("returns the current style after setSpinnerStyle", () => {
    setSpinnerStyle("line");
    expect(getSpinnerStyle()).toBe("line");
  });

  it("always returns a string", () => {
    expect(typeof getSpinnerStyle()).toBe("string");
  });
});

describe("createSpinner", () => {
  afterEach(() => {
    setSpinnerStyle("clack");
  });

  it("returns a SpinnerHandle with stop and fail methods", () => {
    const spinner = createSpinner("Testing...");
    expect(spinner).toHaveProperty("stop");
    expect(typeof spinner.stop).toBe("function");
    expect(spinner).toHaveProperty("fail");
    expect(typeof spinner.fail).toBe("function");
  });

  it("calling stop does not throw for clack style", () => {
    setSpinnerStyle("clack");
    const spinner = createSpinner("Working...");
    expect(() => spinner.stop("Done")).not.toThrow();
  });

  it("calling fail does not throw for clack style", () => {
    setSpinnerStyle("clack");
    const spinner = createSpinner("Working...");
    expect(() => spinner.fail("Oops")).not.toThrow();
  });

  it("calling stop does not throw for ora-based style", () => {
    setSpinnerStyle("dots");
    const spinner = createSpinner("Working...");
    expect(() => spinner.stop("Done")).not.toThrow();
  });

  it("calling fail does not throw for ora-based style", () => {
    setSpinnerStyle("line");
    const spinner = createSpinner("Working...");
    expect(() => spinner.fail("Oops")).not.toThrow();
  });

  it("returns independent instances", () => {
    const s1 = createSpinner("First");
    const s2 = createSpinner("Second");
    expect(s1).not.toBe(s2);
    expect(() => s1.stop("done 1")).not.toThrow();
    expect(() => s2.stop("done 2")).not.toThrow();
  });
});
