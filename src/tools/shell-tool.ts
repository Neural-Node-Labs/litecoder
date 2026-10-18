// xcoder:version 2 | xcoder:task task-a73fdc | xcoder:updated 2026-08-03T20:52:06.503Z | xcoder:subtask code-st-dd8b38
import { exec } from "node:child_process";
import type { ShellResult } from "./shell-result.js";

export type { ShellResult } from "./shell-result.js";

/**
 * A denylist, not a sandbox. This catches the obviously destructive
 * one-liners a model might produce while "cleaning up" or "starting
 * fresh" — it is NOT a security boundary against an adversarial actor.
 * Kooder is designed to run each task inside its own disposable container
 * or VM (the same isolation principle Agent Factory's Tool Execution
 * Sandbox uses) — this denylist is a courtesy guardrail on top of that,
 * not a substitute for it.
 */
const DENYLIST_PATTERNS: RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:--\s+)?(?:\/|~|\$HOME|"\$HOME")(?:\*|\/\*)?(?:\s|$)/, // rm -rf / ~ /* $HOME (any flag order)
  /\brm\s+(?:--recursive|--force)\b.*\s(?:\/|~)(?:\s|$)/,
  /\bmkfs\b/,
  /:\(\)\s*\{.*:\|:.*\};\s*:/, // fork bomb
  /\bdd\s+if=.*of=\/dev\/(sd|nvme|hd)/,
  /\bchmod\s+-R\s+777\s+\//,
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/, // pipe-to-shell from a URL — force an explicit review step instead
  />\s*\/dev\/(sd|nvme|hd)/,
];

/**
 * Minimal shell-quote-aware split: respects single-quoted and double-quoted
 * strings. Does NOT handle escaped quotes, nested quoting, or advanced
 * features — it just needs to be good enough to split "npm run build" into
 * ["npm", "run", "build"] and preserve "echo 'hello world'" as
 * ["echo", "hello world"].
 *
 * Migrated from runCommandTool.ts. Exported for testing but intended as
 * an internal utility of shell-tool.ts.
 */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

/**
 * Windows-specific PATHEXT resolution: wraps .cmd/.bat/.ps1 commands
 * with the appropriate interpreter so they work on Windows even when
 * passed to exec(). This is a transparent safety net — exec() already
 * handles .cmd/.bat natively in many shells, but wrapping ensures
 * consistent behavior across all Windows configurations.
 *
 * On non-Windows platforms this is a no-op.
 *
 * Migrated from runCommandTool.ts. Exported for testing but intended as
 * an internal utility of shell-tool.ts.
 */
export function resolveWindowsExecutable(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command, args };

  const lower = command.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return { command: "cmd.exe", args: ["/c", command, ...args] };
  }
  if (lower.endsWith(".ps1")) {
    return { command: "powershell.exe", args: ["-File", command, ...args] };
  }
  return { command, args };
}

export function isDenied(command: string): string | null {
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(command)) {
      return `command matches a denylisted destructive pattern (${pattern}) and was not run.`;
    }
  }
  return null;
}

/**
 * The single entry point for executing shell commands via the run_command
 * tool. Internally:
 * 1. Checks the denylist — denied commands return immediately.
 * 2. Splits the command to identify the executable.
 * 3. On Windows, wraps .cmd/.bat/.ps1 executables with the appropriate
 *    interpreter via resolveWindowsExecutable().
 * 4. Executes via child_process.exec().
 *
 * @param command  - The full command string, e.g. "npm run build".
 * @param cwd      - Working directory (the workspace root).
 * @param timeoutMs - Optional timeout in milliseconds (default 120_000).
 * @returns A ShellResult promise.
 */
export function runCommandTool(
  command: string,
  cwd: string,
  timeoutMs = 120_000
): Promise<ShellResult> {
  const denyReason = isDenied(command);
  if (denyReason) {
    return Promise.resolve({ ok: false, exitCode: null, stdout: "", stderr: denyReason, timedOut: false });
  }

  // Apply OS-aware executable wrapping for Windows .cmd/.bat/.ps1 commands
  const trimmed = command.trim();
  let finalCommand = trimmed;
  if (trimmed.length > 0 && process.platform === "win32") {
    const parts = splitCommand(trimmed);
    const executable = parts[0];
    const rawArgs = parts.slice(1);
    const { command: resolvedCmd, args } = resolveWindowsExecutable(executable, rawArgs);
    if (resolvedCmd !== executable) {
      // The executable was wrapped — reconstruct the command string
      finalCommand = [resolvedCmd, ...args].map((a) =>
        a.includes(" ") ? `"${a}"` : a
      ).join(" ");
    }
  }

  return new Promise((resolve) => {
    const child = exec(
      finalCommand,
      { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const timedOut = !!error && (error as unknown as { killed?: boolean }).killed === true && error.signal === "SIGTERM";
        resolve({
          ok: !error,
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
          timedOut,
        });
      }
    );
    void child;
  });
}
