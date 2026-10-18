// xcoder:version 5 | xcoder:task task-e53af9 | xcoder:updated 2026-08-13T14:02:15.014Z | xcoder:subtask code-st-a2df76
import { FooterRenderer } from "./footer-renderer.js";
import { createFooterState, type FooterState } from "./footer-state.js";
import { createScrollRegionGuard, type ScrollRegionGuard } from "./scroll-region-guard.js";
import type { SdlcStage } from "../types.js";

/**
 * Specification passed to FooterManager.init() from the orchestrator.
 */
export interface FooterSpec {
  /** Effective ANSI gate: TTY attached and NO_COLOR unset (see isInteractiveStdout). */
  tty: boolean;
  /** Optional task description shown in the footer. */
  taskDesc?: string;
  /**
   * Optional opt-out for orchestrator-adjacent runners. When true the
   * singleton still exists (consumers may optional-chain safely) but no
   * footer output, scroll region, spinner, or ANSI escapes are ever
   * emitted. Defaults to false.
   */
  quiet?: boolean;
}

/**
 * Public API facade for the terminal status footer.
 *
 * Manages FooterState + FooterRenderer lifecycle.
 * Serializes concurrent updates via a microtask queue (the JS event loop
 * naturally batches all synchronous calls into one render).
 *
 * Design reference: `src/util/footer-state.ts`, `src/util/footer-renderer.ts`
 */
export class FooterManager {
  private static _instance: FooterManager | null = null;

  private _state: FooterState;
  private _renderer: FooterRenderer;
  private _scrollRegionGuard: ScrollRegionGuard | null = null;
  private _muted = false;
  private _pending: Partial<FooterState> = {};
  private _flushScheduled = false;

  private constructor(state: FooterState) {
    this._state = state;
    this._renderer = new FooterRenderer();
  }

  /**
   * Initialize the singleton footer. Sole caller: SdlcOrchestrator._runLoop.
   * Consumers are restricted to `FooterManager.instance()?.` optional-chained
   * update/hide/show/shutdown/writeSafe and must never call init.
   *
   * Availability matrix — the footer is visible iff ALL of these hold:
   *
   * 1) Path gate: the task runs through SdlcOrchestrator.run()/resume() into
   *    _runLoop. Status/bench/backlog list|status|pick|done/sprint/observe/
   *    release/index/test/swarm never construct the orchestrator and never
   *    show a footer. Backlog start/continue DO route through the
   *    orchestrator and DO show one.
   * 2) TTY gate: process.stdout.isTTY === true at init time (ANSI/cursor/
   *    scroll-region output is only safe on a real terminal; piped output
   *    stays raw).
   * 3) NO_COLOR gate: process.env.NO_COLOR is unset. Setting NO_COLOR makes
   *    spec.tty false, so zero escape sequences are emitted and redirected
   *    output stays clean.
   * 4) Lifecycle gate: the footer is outside the interrupt-hide window and
   *    has not yet been shut down by the execution loop.
   *
   * The quiet flag is a deliberate opt-out for orchestrator-adjacent runners:
   * the singleton exists (so optional-chained consumers are safe) but no
   * footer is ever painted and no timer is started.
   */
  static init(spec: FooterSpec): FooterManager {
    if (FooterManager._instance) {
      FooterManager._instance.shutdown();
    }
    const state = createFooterState({
      tty: spec.tty,
      taskDesc: spec.taskDesc ?? null,
    });
    const mgr = new FooterManager(state);
    mgr._muted = spec.quiet === true;
    FooterManager._instance = mgr;

    if (state.tty && !mgr._muted) {
      mgr._renderer.setup(state);
      // Create the ScrollRegionGuard after setup so it knows the active state.
      mgr._scrollRegionGuard = createScrollRegionGuard(
        mgr._renderer,
        () => mgr._state
      );
    }

    return mgr;
  }

  /** Get the current singleton instance (may be null if not initialized). */
  static instance(): FooterManager | null {
    return FooterManager._instance;
  }

  /** Whether the footer is active (TTY attached). */
  static isActive(): boolean {
    return FooterManager._instance != null && FooterManager._instance._state.tty;
  }

  /**
   * Write text safely above the footer. If the footer is active (TTY),
   * routes through the ScrollRegionGuard to preserve the reserved bottom row.
   * If inactive, writes directly to process.stdout.
   */
  static writeSafe(text: string): void {
    const mgr = FooterManager._instance;
    if (mgr && mgr._scrollRegionGuard && mgr._state.tty) {
      mgr._scrollRegionGuard.write(text);
    } else {
      process.stdout.write(text);
    }
  }

  /** Get the ScrollRegionGuard instance (for OutputInterceptor). */
  getScrollRegionGuard(): ScrollRegionGuard | null {
    return this._scrollRegionGuard;
  }

  /** Get the FooterRenderer instance (for direct access to writeAbove / forceRender). */
  getFooterRenderer(): FooterRenderer {
    return this._renderer;
  }

  // ── update helpers ──

  /** Agent started thinking — show spinner and agent ID. */
  updateThinkingStart(agentId: string): void {
    this._apply({ agentId, spinner: true });
    if (!this._muted) {
      this._renderer.startSpinner();
    }
  }

  /** Agent stopped thinking. */
  updateThinkingStop(): void {
    this._renderer.stopSpinner();
    this._apply({ spinner: false });
  }

  /** Agent performed an action. */
  updateAction(tool: string): void {
    this._apply({ action: tool });
  }

  /** Agent received an observation. */
  updateObservation(ok: boolean, text: string): void {
    // Show observing state briefly.
    const preview = text.length > 40 ? text.slice(0, 37) + "..." : text;
    this._apply({ observing: true, action: ok ? preview : `✗ ${preview}` });
    // Clear observing after a tick.
    setTimeout(() => {
      if (this._state.observing) {
        this._apply({ observing: false });
      }
    }, 0);
  }

  /** Update token count display. */
  updateTokens(inputTokens: number, outputTokens: number): void {
    this._apply({ tokens: `${inputTokens} in / ${outputTokens} out` });
  }

  /** Update current SDLC stage. */
  updateStage(stage: SdlcStage): void {
    this._apply({ stage });
  }

  /** Update document info. */
  updateDocument(docs: string): void {
    this._apply({ docs });
  }

  /**
   * Temporarily hide the footer (e.g. for interrupt prompts).
   * Call show() to restore.
   */
  hide(): void {
    this._renderer.hide();
  }

  /**
   * Restore the footer after being hidden.
   */
  show(): void {
    this._renderer.show(this._state);
  }

  /**
   * Shutdown the footer — teardown scroll region, clear line, null singleton.
   * Called when the task run finishes or is interrupted.
   */
  shutdown(): void {
    this._renderer.teardown();
    if (FooterManager._instance === this) {
      FooterManager._instance = null;
    }
  }

  /**
   * Handle terminal resize by reconfiguring the renderer.
   */
  onResize(): void {
    this._renderer.reconfigure(this._state);
  }

  // ── private ──

  /**
   * Accumulate partial state changes and flush on the next microtask.
   * This coalesces multiple synchronous calls into a single render.
   */
  private _apply(patch: Partial<FooterState>): void {
    Object.assign(this._pending, patch);
    if (!this._flushScheduled) {
      this._flushScheduled = true;
      Promise.resolve().then(() => {
        this._flush();
      });
    }
  }

  private _flush(): void {
    this._flushScheduled = false;
    Object.assign(this._state, this._pending);
    this._pending = {};
    if (this._state.tty) {
      this._renderer.render(this._state);
    }
  }
}
