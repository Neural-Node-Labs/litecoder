import * as clack from "@clack/prompts";
import ora, { type Ora } from "ora";
import cliSpinners from "cli-spinners";

export const AVAILABLE_SPINNER_STYLES = ["clack", ...Object.keys(cliSpinners)] as const;

let activeStyle = "clack";

/**
 * `--spinner <style>`: "clack" (default, Anthropic's own prompt library's
 * spinner) or any named style from `cli-spinners` (the same package `ora`
 * itself uses) — "dots", "line", "arc", "bounceBar", "star", etc. Falls
 * back to "clack" on an unrecognized name rather than throwing, since a
 * bad `--spinner` value shouldn't stop a task from running.
 */
export function setSpinnerStyle(style: string | undefined): void {
  if (!style) return;
  if (style === "clack" || style in cliSpinners) {
    activeStyle = style;
  } else {
    console.error(
      `Unknown --spinner "${style}". Using "clack". Available: clack, ${Object.keys(cliSpinners).slice(0, 12).join(", ")}, ... ` +
        `(${Object.keys(cliSpinners).length} total from cli-spinners)`
    );
  }
}

export function getSpinnerStyle(): string {
  return activeStyle;
}

export interface SpinnerHandle {
  stop(message: string): void;
  fail(message: string): void;
}

export function createSpinner(startMessage: string): SpinnerHandle {
  if (activeStyle === "clack") {
    const s = clack.spinner();
    s.start(startMessage);
    return {
      stop: (msg: string) => s.stop(msg),
      fail: (msg: string) => s.stop(msg, 1),
    };
  }

  // Cast is safe: `activeStyle` is validated against `cliSpinners`'s own keys
  // in `setSpinnerStyle` before it can ever reach here (or is the literal
  // "clack" string, handled in the branch above).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance: Ora = ora({ text: startMessage, spinner: activeStyle as any }).start();
  return {
    stop: (msg: string) => {
      instance.succeed(msg);
    },
    fail: (msg: string) => {
      instance.fail(msg);
    },
  };
}
