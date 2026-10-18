// ── Colorful animated thinking spinner for the samurai agent (and eventually beyond). ──
//
// When stdout is a TTY and NO_COLOR is not set:
//   - Color-cycling label + rotating glyph (Unicode Braille, ASCII fallback on
//     non-UTF-8 Windows consoles).
//   - Updates every ~100ms via setInterval (non-blocking).
//   - Hides/shows the cursor around the animation.
//   - Supports pause() / resume() so interleaved log messages don't mangle
//     the spinner line.
//
// When stdout is NOT a TTY or NO_COLOR is set:
//   - Emits one static "Thinking…" line, then appends dots periodically.
//   - No ANSI, no animation, no cursor control.

// ── Types ──

export interface ThinkingHandle {
  /** Stop the spinner and replace it with a success message (erases the spinner line). */
  stop(message: string): void;

  /** Stop the spinner and replace it with a failure message (erases the spinner line). */
  fail(message: string): void;

  /** Pause the spinner animation and clear its line so other log output can
   *  be printed without mangling. Call resume() to restart. */
  pause(): void;

  /** Resume the spinner animation after a pause(). */
  resume(): void;
}

// ── Internal constants ──

const COLOR_PALETTE: readonly string[] = [
  "\x1b[38;5;78m",   // green
  "\x1b[38;5;80m",   // cyan
  "\x1b[38;5;141m",  // magenta
  "\x1b[38;5;220m",  // yellow
];
const COLOR_RESET = "\x1b[0m";

// Unicode Braille spinner (works on Windows Terminal, WSL, macOS, most Linux)
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ASCII fallback for legacy Windows console (cp1252, cmd.exe without modern Terminal)
const ASCII_FRAMES = ["|", "/", "-", "\\"];

// ── Platform detection ──

function isInteractive(): boolean {
  return (process.stdout.isTTY as boolean) === true && process.env.NO_COLOR === undefined;
}

function shouldUseAscii(): boolean {
  // On Windows, check if the console encoding supports Unicode.
  // process.stdout.encoding is the most reliable signal (added in Node 20+).
  if (process.platform === "win32") {
    const enc = (process.stdout as NodeJS.WriteStream & { encoding?: string }).encoding;
    // encoding is typically "utf8" on modern terminals (Windows Terminal, VSCode, etc.)
    // and "buffer" or absent on legacy cmd.exe.
    if (enc !== "utf8" && enc !== "utf-8") {
      // Additional check: WT_SESSION indicates Windows Terminal, which handles Braille fine.
      if (!process.env.WT_SESSION && !process.env.TERMINAL_EMULATOR) {
        return true;
      }
    }
  }
  return false;
}

function getFrames(): readonly string[] {
  return shouldUseAscii() ? ASCII_FRAMES : BRAILLE_FRAMES;
}

// ── ANSI helpers ──

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";
const CARRIAGE_RETURN = "\r";

function writeToStdout(text: string): void {
  process.stdout.write(text);
}

// ── Implementation ──

/**
 * Start a colorful animated thinking spinner on stdout.
 *
 * When stdout is a TTY and NO_COLOR is not set:
 *   - Renders a rotating glyph (Unicode Braille or ASCII fallback on cp1252
 *     terminals) with a color-cycling label on a single line.
 *   - Updates every ~100ms via setInterval (non-blocking to the event loop).
 *   - Hides the cursor while active.
 *
 * When stdout is NOT a TTY or NO_COLOR is set:
 *   - Emits one static "Thinking…" line, then appends a dot every ~2s.
 *   - No ANSI codes, no animation, no cursor control.
 *
 * @param label - A short identifier shown next to the spinner (e.g. "samurai").
 */
export function startThinking(label: string): ThinkingHandle {
  const interactive = isInteractive();

  if (!interactive) {
    return createStaticSpinner(label);
  }

  return createAnimatedSpinner(label);
}

// ── Non-interactive (static) spinner ──

function createStaticSpinner(label: string): ThinkingHandle {
  let stopped = false;
  let dots = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  writeToStdout(`Thinking… [${label}]`);

  interval = setInterval(() => {
    if (stopped) return;
    dots = (dots + 1) % 4;
    writeToStdout(".");
  }, 2000);

  function cleanup(finalMessage: string): void {
    if (stopped) return;
    stopped = true;
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
    writeToStdout(`\n${finalMessage}\n`);
  }

  return {
    stop(message: string) {
      cleanup(message);
    },
    fail(message: string) {
      cleanup(`✗ ${message}`);
    },
    pause() {
      // No-op in static mode — dots are harmless and interleaved logs
      // won't mangle because we append dots in-place without carriage-return.
    },
    resume() {
      // No-op.
    },
  };
}

// ── Animated (TTY) spinner ──

function createAnimatedSpinner(label: string): ThinkingHandle {
  let tick = 0;
  let stopped = false;
  let paused = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  const frames = getFrames();

  // Hide cursor
  writeToStdout(HIDE_CURSOR);

  function render(): void {
    if (stopped || paused) return;
    const colorCode = COLOR_PALETTE[tick % COLOR_PALETTE.length];
    const glyph = frames[tick % frames.length];
    // Format: <CR><clear-line><color><glyph> <label> thinking…<reset>
    writeToStdout(`${CARRIAGE_RETURN}${CLEAR_LINE}${colorCode}${glyph} ${label} thinking…${COLOR_RESET}`);
  }

  // First frame immediately
  render();
  tick++;

  interval = setInterval(() => {
    render();
    tick++;
  }, 100);

  function eraseLine(): void {
    writeToStdout(`${CARRIAGE_RETURN}${CLEAR_LINE}`);
  }

  function cleanup(finalMessage: string): void {
    if (stopped) return;
    stopped = true;
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
    eraseLine();
    writeToStdout(`${finalMessage}\n`);
    // Show cursor
    writeToStdout(SHOW_CURSOR);
  }

  return {
    stop(message: string) {
      cleanup(`✓ ${message}`);
    },
    fail(message: string) {
      cleanup(`✗ ${message}`);
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      eraseLine();
      writeToStdout(SHOW_CURSOR);
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      writeToStdout(HIDE_CURSOR);
      render();
      tick++;
      interval = setInterval(() => {
        render();
        tick++;
      }, 100);
    },
  };
}
