// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:21:06.599Z | xcoder:subtask code-st-39dbde
import { fail, type AdapterResult, type FamilyLimits, type OpBudget } from "./types.js";

/**
 * Named limits and fail-closed guards (design C3).
 *
 * Every limit here exists because the underlying operation can be made to
 * allocate unbounded memory from a small input — a ZIP bomb, a 60000×60000 PNG
 * header, a 50MB xlsx. Nothing in this module parses content: it only decides
 * whether an operation is still within budget, and refuses when it isn't.
 */

/** Absolute ceiling applied before any format-specific limit. */
export const HARD_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Total uncompressed bytes we will ever inflate out of one archive. */
export const HARD_MAX_INFLATED_BYTES = 192 * 1024 * 1024;
/** Maximum entries we will enumerate in one ZIP container. */
export const HARD_MAX_ZIP_ENTRIES = 4096;
/** Refuse any single image whose pixel count exceeds this (decompression bomb). */
export const HARD_MAX_PIXELS = 80_000_000;
/** Refuse any single spreadsheet region larger than this many cells. */
export const HARD_MAX_CELLS = 200_000;
/** Per-operation wall-clock ceiling. */
export const HARD_TIMEOUT_MS = 20_000;

export const FAMILY_LIMITS: Record<string, FamilyLimits> = {
  excel: { maxInputBytes: 32 * 1024 * 1024, maxOutputBytes: 32 * 1024 * 1024, maxUnits: HARD_MAX_CELLS, timeoutMs: HARD_TIMEOUT_MS },
  word: { maxInputBytes: 32 * 1024 * 1024, maxOutputBytes: 32 * 1024 * 1024, maxUnits: 20_000, timeoutMs: HARD_TIMEOUT_MS },
  pdf: { maxInputBytes: 48 * 1024 * 1024, maxOutputBytes: 48 * 1024 * 1024, maxUnits: 500, timeoutMs: HARD_TIMEOUT_MS },
  image: { maxInputBytes: 24 * 1024 * 1024, maxOutputBytes: 24 * 1024 * 1024, maxUnits: HARD_MAX_PIXELS, timeoutMs: HARD_TIMEOUT_MS },
  slides: { maxInputBytes: 32 * 1024 * 1024, maxOutputBytes: 32 * 1024 * 1024, maxUnits: 2_000, timeoutMs: HARD_TIMEOUT_MS },
  video: { maxInputBytes: HARD_MAX_INPUT_BYTES, maxOutputBytes: HARD_MAX_OUTPUT_BYTES, maxUnits: 64 * 1024 * 1024, timeoutMs: HARD_TIMEOUT_MS },
};

export function makeBudget(limits: FamilyLimits): OpBudget {
  return {
    deadline: Date.now() + limits.timeoutMs,
    maxBytes: Math.min(limits.maxOutputBytes, HARD_MAX_OUTPUT_BYTES),
    maxUnits: limits.maxUnits,
    unitsUsed: 0,
  };
}

/** Remaining units; negative means the budget is already blown. */
export function remainingUnits(budget: OpBudget): number {
  return budget.maxUnits - (budget.unitsUsed ?? 0);
}

/** Charge `n` units against the budget, refusing if it would overrun. */
export function chargeUnits(budget: OpBudget, n: number): AdapterResult<number> {
  if (!Number.isFinite(n) || n < 0) {
    return fail("invalid_input", `internal: refusing to charge a non-finite unit count (${n}).`);
  }
  const used = (budget.unitsUsed ?? 0) + n;
  budget.unitsUsed = used;
  if (used > budget.maxUnits) {
    return fail("limit_exceeded", `operation needs ${used} units but the limit is ${budget.maxUnits}.`, {
      limit: budget.maxUnits,
      requested: used,
    });
  }
  return { ok: true, value: used };
}

/** True when the operation has run out of wall-clock time. */
export function deadlineExceeded(budget: OpBudget): boolean {
  return Date.now() > budget.deadline;
}

export function assertNotExpired(budget: OpBudget): AdapterResult<void> {
  if (deadlineExceeded(budget)) {
    return fail("limit_exceeded", "operation exceeded its time budget.");
  }
  return { ok: true, value: undefined };
}

/** Check an input buffer against the hard and family ceilings. */
export function assertInputBytes(bytes: Uint8Array, limits: FamilyLimits): AdapterResult<void> {
  const cap = Math.min(limits.maxInputBytes, HARD_MAX_INPUT_BYTES);
  if (bytes.byteLength > cap) {
    return fail(
      "limit_exceeded",
      `input is ${bytes.byteLength} bytes, above the ${cap}-byte limit for this format — refusing rather than degrading.`,
      { bytes: bytes.byteLength, limit: cap }
    );
  }
  return { ok: true, value: undefined };
}

export function assertOutputBytes(bytes: Uint8Array, limits: FamilyLimits): AdapterResult<void> {
  const cap = Math.min(limits.maxOutputBytes, HARD_MAX_OUTPUT_BYTES);
  if (bytes.byteLength > cap) {
    return fail("limit_exceeded", `produced ${bytes.byteLength} bytes, above the ${cap}-byte output limit.`, {
      bytes: bytes.byteLength,
      limit: cap,
    });
  }
  return { ok: true, value: undefined };
}

/** Pixel-count guard — a 100×100 PNG can declare 60000×60000 in its header. */
export function assertPixels(width: number, height: number): AdapterResult<void> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return fail("invalid_input", `image dimensions must be positive integers, got ${width}×${height}.`);
  }
  const total = width * height;
  if (!Number.isSafeInteger(total) || total > HARD_MAX_PIXELS) {
    return fail("limit_exceeded", `image of ${width}×${height} (${total} pixels) exceeds the ${HARD_MAX_PIXELS}-pixel limit.`, {
      width,
      height,
      limit: HARD_MAX_PIXELS,
    });
  }
  return { ok: true, value: undefined };
}

export function assertCells(count: number): AdapterResult<void> {
  if (!Number.isFinite(count) || count < 0) {
    return fail("invalid_input", `cell count must be a non-negative number, got ${count}.`);
  }
  if (count > HARD_MAX_CELLS) {
    return fail("limit_exceeded", `${count} cells requested, above the ${HARD_MAX_CELLS}-cell limit.`, {
      limit: HARD_MAX_CELLS,
      requested: count,
    });
  }
  return { ok: true, value: undefined };
}

/** ZIP containment: entry count *and* inflated total, both fail-closed. */
export function assertZipBudget(entryCount: number, inflatedBytes: number): AdapterResult<void> {
  if (entryCount > HARD_MAX_ZIP_ENTRIES) {
    return fail("limit_exceeded", `archive has ${entryCount} entries, above the ${HARD_MAX_ZIP_ENTRIES}-entry limit.`, {
      limit: HARD_MAX_ZIP_ENTRIES,
      entries: entryCount,
    });
  }
  if (inflatedBytes > HARD_MAX_INFLATED_BYTES) {
    return fail(
      "limit_exceeded",
      `archive would inflate to ${inflatedBytes} bytes, above the ${HARD_MAX_INFLATED_BYTES}-byte limit.`,
      { limit: HARD_MAX_INFLATED_BYTES, inflatedBytes }
    );
  }
  return { ok: true, value: undefined };
}

/**
 * Run `fn` but give up at the budget deadline. The underlying work is not
 * cancellable (pure CPU on a buffer), so this races it: a late result is
 * discarded rather than allowed to keep the request alive.
 */
export async function withTimeout<T>(
  budget: OpBudget,
  fn: () => Promise<T>,
  onTimeout?: () => AdapterResult<T>
): Promise<AdapterResult<T> | T> {
  const remaining = Math.max(0, budget.deadline - Date.now());
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<AdapterResult<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve(onTimeout ? onTimeout() : fail("limit_exceeded", "operation exceeded its time budget."));
    }, remaining);
    if (typeof timer.unref === "function") timer.unref();
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Coerce an untrusted numeric argument, clamping into a safe range. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
