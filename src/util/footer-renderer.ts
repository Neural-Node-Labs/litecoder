// xcoder:version 2 | xcoder:task task-e23ea7 | xcoder:updated 2026-08-05T09:38:37.696Z | xcoder:subtask code-st-a00941
import type { FooterState } from "./footer-state.js";

/**
 * ANSI escape sequences for the built-in terminal color palette.
 * Matches the existing palette in terminal.ts.
 */
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  amber: "\x1b[38;5;214m",
  cyan: "\x1b[38;5;80m",
  green: "\x1b[38;5;78m",
  coral: "\x1b[38;5;203m",
  violet: "\x1b[38;5;140m",
  white: "\x1b[38;5;255m",
  bgFooter: "\x1b[48;5;236m",
};

// ── Scroll region helpers ──
const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";
const RESET_SCROLL_REGION = "\x1b[r";
const CURSOR_TO_BOTTOM = "\x1b[999;1H";
const CLEAR_LINE = "\x1b[2K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
// Scroll up by 1 to make room for the footer when enabling.
const SCROLL_UP = "\x1b[1S";

/** Resolve current terminal width, with a fallback. */
function getWidth(): number {
  if (process.stdout && typeof process.stdout.columns === "number" && process.stdout.columns > 0) {
    return process.stdout.columns;
  }
  return 80;
}

/** Truncate a single segment with "…" if too long. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/** Spinner frames compatible with clack — simple Braille spinner. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Converts a FooterState into a single ANSI escape sequence string
 * that paints a 1-row footer at the bottom of the terminal.
 *
 * Design:
 * - 1-row footer using scroll region to reserve the bottom line.
 * - Truncation priority: stage+spinner > action > tokens > agentId > taskDesc > docs.
 * - Respects NO_COLOR and TTY detection.
 * - Handles window resize by re-reading process.stdout.columns.
 */
export class FooterRenderer {
  private _active = false;
  private _hidden = false;
  private _spinnerIdx = 0;
  private _spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private _currentState: FooterState | null = null;
  private _noColor = false;

  /**
   * Perform one-time setup: enable scroll region, hide cursor.
   * Must be called before render(). Safe to call when already active (no-op).
   */
  setup(state: FooterState): void {
    this._noColor = !state.tty;
    if (!state.tty || this._active) return;

    this._active = true;
    this._hidden = false;

    // Reserve bottom row via scroll region (all rows except last).
    const height = process.stdout.rows ?? 24;
    // Scroll region: rows 1 to (height - 1), keeping row `height` free.
    const scrollBottom = Math.max(1, height - 1);
    process.stdout.write(HIDE_CURSOR);
    process.stdout.write(`\x1b[1;${scrollBottom}r`);
    this._render(state);
  }

  /**
   * Render the current state to the reserved bottom row.
   * Handles layout, truncation, and spinner animation.
   */
  render(state: FooterState): void {
    if (!this._active || this._hidden || !state.tty) {
      this._currentState = state;
      return;
    }
    this._render(state);
  }

  /** Re-read terminal size and re-apply scroll region after a resize. */
  reconfigure(state: FooterState, partial?: Partial<FooterState>): void {
    if (!state.tty || !this._active) return;
    const height = process.stdout.rows ?? 24;
    const scrollBottom = Math.max(1, height - 1);
    process.stdout.write(RESET_SCROLL_REGION);
    process.stdout.write(`\x1b[1;${scrollBottom}r`);
    if (partial) {
      this.render({ ...state, ...partial });
    } else {
      this.render(state);
    }
  }

  /** Temporarily hide the footer (e.g. during interrupt prompts). */
  hide(): void {
    if (!this._active || this._hidden) return;
    this._hidden = true;
    process.stdout.write(RESET_SCROLL_REGION);
    process.stdout.write(SHOW_CURSOR);
    // Clear the footer row.
    this._clearFooterRow();
  }

  /** Restore the footer after being hidden. */
  show(state: FooterState): void {
    if (!this._active || !this._hidden) return;
    this._hidden = false;
    const height = process.stdout.rows ?? 24;
    const scrollBottom = Math.max(1, height - 1);
    process.stdout.write(HIDE_CURSOR);
    process.stdout.write(`\x1b[1;${scrollBottom}r`);
    if (this._currentState) {
      this._render(this._currentState);
    } else {
      this._render(state);
    }
  }

  /**
   * Return the current reserved scroll-region bottom row index (height - 1).
   * Used by ScrollRegionGuard to know which row to keep free.
   */
  getScrollBottom(): number {
    const height = process.stdout.rows ?? 24;
    return Math.max(1, height - 1);
  }

  /**
   * Force-render the footer without checking _hidden/_active guards.
   * Used by ScrollRegionGuard during re-establish after a guarded write.
   */
  forceRender(state: FooterState): void {
    if (!state.tty) return;
    this._render(state);
  }

  /**
   * Write text above the footer safely. Saves cursor, resets scroll region,
   * writes the text, re-establishes scroll region, re-renders footer,
   * and restores cursor. This is the core defensive write — it ensures
   * no output can break the scroll region.
   */
  writeAbove(text: string, state: FooterState): void {
    if (!this._active || !state.tty) {
      process.stdout.write(text);
      return;
    }

    const scrollBottom = this.getScrollBottom();
    // Save cursor
    process.stdout.write(SAVE_CURSOR);
    // Reset scroll region so write lands in the scrollable area
    process.stdout.write(RESET_SCROLL_REGION);
    // Perform the write
    process.stdout.write(text);
    // Re-establish scroll region
    process.stdout.write(`\x1b[1;${scrollBottom}r`);
    // Re-render footer
    this.forceRender(state);
    // Restore cursor
    process.stdout.write(RESTORE_CURSOR);
  }

  /**
   * Tear down: reset scroll region, show cursor, clear footer.
   */
  teardown(): void {
    if (!this._active) return;
    this._active = false;
    this._hidden = false;
    if (this._spinnerInterval) {
      clearInterval(this._spinnerInterval);
      this._spinnerInterval = null;
    }
    process.stdout.write(RESET_SCROLL_REGION);
    process.stdout.write(SHOW_CURSOR);
    this._clearFooterRow();
  }

  // ── private helpers ──

  private _render(state: FooterState): void {
    this._currentState = state;
    const width = getWidth();

    // Build the footer line — truncation priority:
    // stage+spinner > action > tokens > agentId > taskDesc > docs
    const segments: string[] = [];

    // Stage (amber) + optional spinner
    if (state.stage) {
      let stageSeg = paint(C.amber, state.stage, this._noColor);
      if (state.spinner) {
        const frame = SPINNER_FRAMES[this._spinnerIdx % SPINNER_FRAMES.length];
        stageSeg = `${frame} ${stageSeg}`;
      }
      segments.push(stageSeg);
    }

    // Action
    if (state.action) {
      segments.push(paint(C.cyan, state.action, this._noColor));
    }

    // Tokens
    if (state.tokens) {
      segments.push(paint(C.dim, state.tokens, this._noColor));
    }

    // AgentId
    if (state.agentId) {
      segments.push(paint(C.green, `[${state.agentId}]`, this._noColor));
    }

    // Task description
    if (state.taskDesc) {
      segments.push(paint(C.white, state.taskDesc, this._noColor));
    }

    // Docs
    if (state.docs) {
      segments.push(paint(C.dim, state.docs, this._noColor));
    }

    // Join and truncate to width
    let line = segments.join(paint(C.dim, " │ ", this._noColor));
    if (line.length > width) {
      line = line.slice(0, width - 1) + "…";
    }
    // Pad to full width
    line = line.padEnd(width, " ");

    // Paint the full line with background
    const bgLine = this._noColor ? line : `${C.bgFooter}${line}${C.reset}`;

    // Write: save cursor, go to bottom row, draw, restore cursor
    process.stdout.write(SAVE_CURSOR);
    process.stdout.write(CURSOR_TO_BOTTOM);
    process.stdout.write(CLEAR_LINE);
    process.stdout.write(bgLine);
    process.stdout.write(RESTORE_CURSOR);
  }

  private _clearFooterRow(): void {
    process.stdout.write(CURSOR_TO_BOTTOM);
    process.stdout.write(CLEAR_LINE);
  }

  /**
   * Start spinner tick — called by FooterManager when initiating thinking.
   * Managed here so the renderer owns the interval lifecycle.
   */
  startSpinner(): void {
    if (this._spinnerInterval) return;
    this._spinnerInterval = setInterval(() => {
      this._spinnerIdx++;
      if (this._currentState && this._currentState.tty && !this._hidden) {
        this._render({ ...this._currentState, spinner: true });
      }
    }, 100);
  }

  /**
   * Stop spinner tick — called by FooterManager when thinking stops.
   */
  stopSpinner(): void {
    if (this._spinnerInterval) {
      clearInterval(this._spinnerInterval);
      this._spinnerInterval = null;
    }
  }
}

function paint(code: string, text: string, noColor: boolean): string {
  return noColor ? text : `${code}${text}${C.reset}`;
}
