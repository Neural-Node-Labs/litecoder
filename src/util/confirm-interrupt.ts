// xcoder:version 3 | xcoder:task task-0684a6 | xcoder:updated 2026-08-03T10:25:48.381Z | xcoder:subtask test-st-5ed700
import * as clack from "@clack/prompts";

/**
 * Display a Yes/No confirmation dialog using @clack/prompts.
 *
 * Callers are responsible for toggling raw mode on/off around the
 * call — this utility assumes stdin is in cooked mode when called
 * (Tradeoff 4: caller-owned lifecycle for clear ownership).
 *
 * @returns true if the user confirms Yes, false otherwise (including on cancel or error).
 */
export async function confirmInterrupt(): Promise<boolean> {
  try {
    const answer = await clack.confirm({
      message: "Do you want to interrupt the current run?",
      active: "Yes",
      inactive: "No",
      initialValue: false,
    });

    // clack.confirm returns boolean | symbol (for cancel)
    if (clack.isCancel(answer)) {
      return false;
    }

    // Coerce to strict boolean: true on Yes, false on anything else (No, null, undefined, etc.)
    return Boolean(answer);
  } catch {
    // If the prompt fails for any reason (e.g. non-TTY), default to not interrupting.
    return false;
  }
}
