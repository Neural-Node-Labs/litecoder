// xcoder:version 2 | xcoder:task task-a616bd | xcoder:updated 2026-08-05T07:30:29.849Z | xcoder:subtask test-st-a0969d
import { describe, it, expect } from "vitest";
import { getEnvironmentInfo, environmentPromptBlock } from "./env-info.js";

describe("getEnvironmentInfo", () => {
  it("returns an object with platform, isWindows, shellHint, pathSep, release", () => {
    const info = getEnvironmentInfo();
    expect(info).toHaveProperty("platform");
    expect(info).toHaveProperty("isWindows");
    expect(typeof info.isWindows).toBe("boolean");
    expect(info).toHaveProperty("shellHint");
    expect(typeof info.shellHint).toBe("string");
    expect(info).toHaveProperty("pathSep");
    expect(typeof info.pathSep).toBe("string");
    expect(info).toHaveProperty("release");
    expect(typeof info.release).toBe("string");
  });

  it("sets isWindows to true only on win32", () => {
    const info = getEnvironmentInfo();
    if (process.platform === "win32") {
      expect(info.isWindows).toBe(true);
      expect(info.pathSep).toBe("\\");
      expect(info.shellHint).toContain("PowerShell");
    } else {
      expect(info.isWindows).toBe(false);
      expect(info.pathSep).toBe("/");
      expect(info.shellHint).toContain("POSIX");
    }
  });

  it("returns the actual process platform", () => {
    const info = getEnvironmentInfo();
    expect(info.platform).toBe(process.platform);
  });

  it("returns os.release() string", async () => {
    const os = await import("node:os");
    const info = getEnvironmentInfo();
    expect(info.release).toBe(os.release());
  });

  it("does not throw", () => {
    expect(() => getEnvironmentInfo()).not.toThrow();
  });
});

describe("environmentPromptBlock", () => {
  it("returns a string that includes 'Runtime environment'", () => {
    const info = getEnvironmentInfo();
    const block = environmentPromptBlock(info);
    expect(typeof block).toBe("string");
    expect(block).toContain("Runtime environment");
  });

  it("mentions Windows-specific guidance when isWindows is true", () => {
    const windowsEnv = {
      platform: "win32" as NodeJS.Platform,
      isWindows: true,
      shellHint: "PowerShell or cmd.exe",
      pathSep: "\\",
      release: "10.0.26200",
    };
    const block = environmentPromptBlock(windowsEnv);
    expect(block).toContain("Windows");
    expect(block).toContain("PowerShell-compatible");
  });

  it("mentions POSIX guidance when isWindows is false", () => {
    const unixEnv = {
      platform: "linux" as NodeJS.Platform,
      isWindows: false,
      shellHint: "a POSIX shell",
      pathSep: "/",
      release: "5.15.0",
    };
    const block = environmentPromptBlock(unixEnv);
    expect(block).toContain("POSIX");
    expect(block).toContain("Standard unix commands");
    expect(block).not.toContain("PowerShell-compatible");
  });

  it("returns non-empty string for any valid EnvironmentInfo", () => {
    const info = getEnvironmentInfo();
    const block = environmentPromptBlock(info);
    expect(block.length).toBeGreaterThan(100);
  });

  it("mentions glob, grep, read_file, edit_file, write_file tools", () => {
    const info = getEnvironmentInfo();
    const block = environmentPromptBlock(info);
    expect(block).toContain("glob");
    expect(block).toContain("grep");
    expect(block).toContain("write_file");
  });
});
