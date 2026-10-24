// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:25:23.713Z | xcoder:subtask code-st-39dbde
import {
  adapterFor,
  DOCUMENT_TOOLS,
  extensionOf,
  limitsFor,
  supportsOp,
} from "./format-registry.js";
import { readContained, writeAtomic } from "./atomic-write.js";
import { assertInputBytes, assertOutputBytes, makeBudget } from "./limits.js";
import { recordDocOperation } from "./doc-log.js";
import { parseToolInput } from "./schemas.js";
import { requireDeclaredMatch, sniffFormat } from "./format-sniff.js";
import type { DocErrorCode, OpBudget } from "./types.js";

export type DocumentToolName = (typeof DOCUMENT_TOOLS)[number];

export interface DocumentToolOutput {
  ok: boolean;
  code?: DocErrorCode;
  error?: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The single dispatch target for all six document/media tools (design C6, T5).
 *
 * Order is the security contract, and it is not negotiable:
 *   1. schema-validate the model's input (nothing unvalidated reaches a parser);
 *   2. contain the path and read the bytes (workspace escape + size ceiling);
 *   3. sniff the magic bytes and require them to match the declared extension;
 *   4. run the adapter op under a unit + wall-clock budget;
 *   5. write atomically, only with explicit overwrite;
 *   6. log a redacted record.
 *
 * Every failure becomes a typed `{ ok: false, code, error }` — this function
 * never throws, exactly like every other branch of `dispatchTool`.
 */
export async function handleDocumentTool(
  root: string,
  toolName: string,
  input: unknown,
  _ctx?: { taskId: string; subtaskId: string }
): Promise<DocumentToolOutput> {
  const started = Date.now();
  const raw = asRecord(input);
  const op = typeof raw.op === "string" ? raw.op : "(none)";
  const relPath = typeof raw.path === "string" ? raw.path : "(none)";
  const finish = (out: DocumentToolOutput, bytesIn?: number, bytesOut?: number): DocumentToolOutput => {
    recordDocOperation({
      tool: toolName,
      op,
      relPath,
      ok: out.ok,
      code: out.code,
      bytesIn,
      bytesOut,
      durationMs: Date.now() - started,
    });
    return out;
  };

  try {
    const adapter = adapterFor(toolName);
    if (!adapter) {
      return finish({
        ok: false,
        code: "invalid_input",
        error: `"${toolName}" is not a document tool. Known tools: ${DOCUMENT_TOOLS.join(", ")}.`,
      });
    }

    // 1. Schema validation — the only path by which model output becomes an argument.
    const parsed = parseToolInput(toolName as DocumentToolName, input);
    if (!parsed.ok) {
      return finish({
        ok: false,
        code: "invalid_input",
        error: `invalid input for "${toolName}": ${parsed.error}`,
      });
    }
    const args = parsed.value as unknown as Record<string, unknown>;

    if (!supportsOp(toolName as DocumentToolName, parsed.value.op)) {
      return finish({
        ok: false,
        code: "invalid_op",
        error: `"${toolName}" does not support op "${parsed.value.op}" — supported ops: ${adapter.ops.join(", ")}.`,
      });
    }

    const targetPath = String(args.path ?? "");
    const ext = extensionOf(targetPath);
    if (!adapter.extensions.includes(ext)) {
      return finish({
        ok: false,
        code: "unsupported_format",
        error:
          `"${toolName}" handles ${adapter.extensions.join(", ")} — "${targetPath}" has extension ` +
          `"${ext || "(none)"}". Pick the matching tool or rename the file; these tools never convert implicitly.`,
      });
    }

    const limits = limitsFor(toolName as DocumentToolName);
    const budget: OpBudget = makeBudget(limits);

    // ── create ────────────────────────────────────────────────────────
    if (parsed.value.op === "create") {
      const built = await adapter.create(args, budget);
      if (!built.ok) return finish({ ok: false, code: built.code, error: built.error });
      const outputBytes = assertOutputBytes(built.value, limits);
      if (!outputBytes.ok) return finish({ ok: false, code: outputBytes.code, error: outputBytes.error });

      const written = await writeAtomic(root, targetPath, built.value, { overwrite: args.overwrite === true });
      if (!written.ok) return finish({ ok: false, code: written.code, error: written.error });

      return finish(
        {
          ok: true,
          relPath: written.value.relPath,
          format: ext.replace(".", ""),
          bytesWritten: written.value.bytesWritten,
          sha256: written.value.sha256,
          created: written.value.created,
        },
        undefined,
        written.value.bytesWritten
      );
    }

    // 2. Read the existing bytes through the containment guard.
    const read = await readContained(root, targetPath);
    if (!read.ok) return finish({ ok: false, code: read.code, error: read.error });
    const bytesIn = read.value.byteLength;

    const sizeOk = assertInputBytes(read.value, limits);
    if (!sizeOk.ok) return finish({ ok: false, code: sizeOk.code, error: sizeOk.error }, bytesIn);

    // 3. Magic bytes decide the format — the extension was only a hint.
    const sniffed = sniffFormat(read.value);
    const matched = requireDeclaredMatch(ext, sniffed);
    if (!matched.ok) return finish({ ok: false, code: matched.code, error: matched.error }, bytesIn);

    // ── read ─────────────────────────────────────────────────────────
    if (parsed.value.op === "read") {
      const result = await adapter.read(read.value, args, budget);
      if (!result.ok) return finish({ ok: false, code: result.code, error: result.error }, bytesIn);
      return finish({ ok: true, relPath: targetPath, ...result.value }, bytesIn);
    }

    // ── update ───────────────────────────────────────────────────────
    let working = read.value;
    if (typeof args.copyFrom === "string" && args.copyFrom !== "") {
      const source = await readContained(root, args.copyFrom);
      if (!source.ok) {
        return finish({ ok: false, code: source.code, error: `copyFrom: ${source.error}` }, bytesIn);
      }
      const sourceSize = assertInputBytes(source.value, limits);
      if (!sourceSize.ok) return finish({ ok: false, code: sourceSize.code, error: sourceSize.error }, bytesIn);
      const sourceSniff = sniffFormat(source.value);
      const sourceMatch = requireDeclaredMatch(extensionOf(args.copyFrom), sourceSniff);
      if (!sourceMatch.ok) {
        return finish({ ok: false, code: sourceMatch.code, error: `copyFrom: ${sourceMatch.error}` }, bytesIn);
      }
      working = source.value;
    }

    const updated = await adapter.update(working, args, budget);
    if (!updated.ok) return finish({ ok: false, code: updated.code, error: updated.error }, bytesIn);

    const outputBytes = assertOutputBytes(updated.value, limits);
    if (!outputBytes.ok) return finish({ ok: false, code: outputBytes.code, error: outputBytes.error }, bytesIn);

    const written = await writeAtomic(root, targetPath, updated.value, { overwrite: args.overwrite === true });
    if (!written.ok) return finish({ ok: false, code: written.code, error: written.error }, bytesIn);

    return finish(
      {
        ok: true,
        relPath: written.value.relPath,
        bytesWritten: written.value.bytesWritten,
        sha256: written.value.sha256,
      },
      bytesIn,
      written.value.bytesWritten
    );
  } catch (e) {
    // Defence in depth: an adapter bug becomes a typed error, never a crash.
    return finish({
      ok: false,
      code: "read_error",
      error: `internal error while handling "${toolName}": ${(e as Error).message}`,
    });
  }
}

/** Convenience wrapper used by the registry dispatch cases and the tests. */
export async function runDocumentTool(
  root: string,
  toolName: string,
  input: unknown
): Promise<DocumentToolOutput> {
  return handleDocumentTool(root, toolName, input);
}
