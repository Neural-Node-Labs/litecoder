// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:20:49.729Z | xcoder:subtask code-st-39dbde
/**
 * Shared vocabulary for the document/media tool surface (design C1–C13).
 *
 * Kept in its own module so adapters can depend on the contract without
 * importing the registry (which imports the adapters) — a runtime cycle would
 * otherwise exist purely for types.
 */

export type FormatFamily = "excel" | "word" | "pdf" | "image" | "slides" | "video";

export type DocumentToolName = FormatFamily;

export type DocOp = "read" | "create" | "update";

/** Closed error vocabulary — every failure a document tool can report. */
export const DOC_ERROR_CODES = [
  "workspace_escape",
  "file_not_found",
  "read_error",
  "write_error",
  "format_mismatch",
  "unsupported_format",
  "corrupt_input",
  "invalid_input",
  "invalid_op",
  "limit_exceeded",
  "overwrite_refused",
  "password_protected",
  "unsupported_feature",
] as const;

export type DocErrorCode = (typeof DOC_ERROR_CODES)[number];

export type AdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: DocErrorCode; error: string; detail?: Record<string, unknown> };

/** Everything an adapter is allowed to spend on one operation. */
export interface OpBudget {
  /** Absolute epoch-ms after which the operation must give up. */
  deadline: number;
  /** Hard ceiling for input **and** produced output bytes. */
  maxBytes: number;
  /** Unit budget (cells, paragraphs, zip entries, frames …). */
  maxUnits: number;
  /** Bytes still available under `maxUnits`-style accounting. */
  unitsUsed?: number;
}

export interface FamilyLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxUnits: number;
  timeoutMs: number;
}

/** The internal adapter contract; the public surface is `schemas.ts`. */
export interface FormatAdapter {
  readonly family: FormatFamily;
  readonly extensions: readonly string[];
  readonly ops: readonly DocOp[];
  readonly limits: FamilyLimits;
  read(bytes: Uint8Array, args: Record<string, unknown>, budget: OpBudget): Promise<AdapterResult<Record<string, unknown>>>;
  create(args: Record<string, unknown>, budget: OpBudget): Promise<AdapterResult<Uint8Array>>;
  update(
    bytes: Uint8Array,
    args: Record<string, unknown>,
    budget: OpBudget
  ): Promise<AdapterResult<Uint8Array>>;
}

export function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value };
}

export function fail(
  code: DocErrorCode,
  error: string,
  detail?: Record<string, unknown>
): AdapterResult<never> {
  return detail ? { ok: false, code, error, detail } : { ok: false, code, error };
}
