// xcoder:version 1 | xcoder:task task-e23ea7 | xcoder:updated 2026-08-05T09:38:18.899Z | xcoder:subtask code-st-a00941
import type { FooterState } from "./footer-state.js";
import type { FooterRenderer } from "./footer-renderer.js";

/**
 * ScrollRegionGuard — defensive layer that makes ALL stdout writes safe
 * regardless of their source. When the footer has reserved a scroll region
 * (bottom row), any write to stdout that scrolls the terminal will push
 * the reserved footer row out of view. This guard intercepts writes,
 * temporarily resets the scroll region to full-screen so the write lands
 * correctly, then re-establishes the scroll region and re-renders the
 * footer — keeping it pinned to the bottom row.
 *
 * Design: wraps process.stdout.write at a low level, so that ora, clack,
 * thinking-spinner, and agent output all pass through this guard without
 * requiring changes to those libraries.
 */

export interface ScrollRegionGuard {
  /** Write safely within the scrollable area without displacing the footer. */
  write(text: string): void;
  /** Convenience: write(text + '\n'). */
  writeln(text: string): void;
  /** Force re-apply the scroll region (used after resize or after hide/show). */
  reestablish(): void;
  /** Reset scroll region to full screen, clear footer row. */
  teardown(): void;
}

// ── ANSI sequences ──
const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";
const RESET_SCROLL_REGION = "\x1b[r";
const CURSOR_TO_BOTTOM = "\x1b[999;1H";
const CLEAR_LINE = "\x1b[2K";

/**
 * Create a ScrollRegionGuard that wraps writes to protect the footer's
 * reserved bottom row.
 *
 * @param footerRenderer - The FooterRenderer instance (for re-rendering after writes).
 * @param getState - A function returning the current FooterState (for re-render).
 */
export function createScrollRegionGuard(
  footerRenderer: FooterRenderer,
  getState: () => FooterState
): ScrollRegionGuard {
  let active = false;

  function getScrollBottom(): number {
    const height = process.stdout.rows ?? 24;
    return Math.max(1, height - 1);
  }

  function writeToStdout(text: string): void {
    process.stdout.write(text);
  }

  const guard: ScrollRegionGuard = {
    write(text: string): void {
      if (!active) {
        writeToStdout(text);
        return;
      }

      const scrollBottom = getScrollBottom();
      const state = getState();

      // Save cursor position
      writeToStdout(SAVE_CURSOR);
      // Reset scroll region to full screen so the write doesn't displace the footer
      writeToStdout(RESET_SCROLL_REGION);
      // Perform the actual write
      writeToStdout(text);
      // Re-establish the scroll region, keeping the bottom row reserved
      writeToStdout(`\x1b[1;${scrollBottom}r`);
      // Re-render the footer on the bottom row
      footerRenderer.forceRender(state);
      // Restore cursor position (so the caller's cursor tracking isn't broken)
      writeToStdout(RESTORE_CURSOR);
    },

    writeln(text: string): void {
      guard.write(text + "\n");
    },

    reestablish(): void {
      const scrollBottom = getScrollBottom();
      writeToStdout(RESET_SCROLL_REGION);
      writeToStdout(`\x1b[1;${scrollBottom}r`);
      const state = getState();
      footerRenderer.forceRender(state);
    },

    teardown(): void {
      active = false;
      writeToStdout(RESET_SCROLL_REGION);
      // Clear the footer row
      writeToStdout(CURSOR_TO_BOTTOM);
      writeToStdout(CLEAR_LINE);
    },
  };

  return guard;
}
