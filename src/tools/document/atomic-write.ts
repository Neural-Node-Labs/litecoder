// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:21:36.726Z | xcoder:subtask code-st-39dbde
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInWorkspaceSafe } from "../workspace-path.js";
import { fail, ok, type AdapterResult } from "./types.js";

/**
 * temp-in-same-directory + rename (design C4, tradeoff T2).
 *
 * The original file is never opened for writing, so any failure — a thrown
 * adapter, a full disk, a killed process — leaves it byte-identical. The rename
 * is the only mutation, and it is atomic within a filesystem, which is why the
 * temp file must live in the *same* directory rather than the OS temp dir.
 */

export interface WriteOptions {
  /** Must be explicitly true to replace an existing file. */
  overwrite?: boolean;
}

export interface WriteReport {
  relPath: string;
  bytesWritten: number;
  sha256: string;
  created: boolean;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically write `bytes` to `relPath` inside `root`.
 *
 * Refuses to clobber unless `options.overwrite === true`; a `false` overwrite on
 * an existing file is `overwrite_refused`, not a silent no-op, so the model can
 * see it must opt in (bylaw AI-03: no irreversible action without confirmation).
 */
export async function writeAtomic(
  root: string,
  relPath: string,
  bytes: Uint8Array,
  options: WriteOptions = {}
): Promise<AdapterResult<WriteReport>> {
  let full: string;
  try {
    full = resolveInWorkspaceSafe(root, relPath, (m) => new Error(m));
  } catch (e) {
    return fail("workspace_escape", (e as Error).message);
  }

  if (full === path.resolve(root)) {
    return fail("invalid_input", `refusing to write to the workspace root itself ("${relPath}").`);
  }

  const alreadyThere = await exists(full);
  if (alreadyThere && options.overwrite !== true) {
    return fail(
      "overwrite_refused",
      `"${relPath}" already exists. Pass overwrite: true to replace it, or choose a different path.`
    );
  }

  const dir = path.dirname(full);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    return fail("write_error", `could not create the directory for "${relPath}": ${(e as Error).message}`);
  }

  const tmp = path.join(dir, `.${path.basename(full)}.tmp-${randomBytes(6).toString("hex")}`);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmp, full);
  } catch (e) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* already failing — best effort */
      }
    }
    try {
      await fs.unlink(tmp);
    } catch {
      /* temp never created, or already gone */
    }
    return fail("write_error", `failed to write "${relPath}": ${(e as Error).message}`);
  }

  return ok({
    relPath,
    bytesWritten: bytes.byteLength,
    sha256: sha256Hex(bytes),
    created: !alreadyThere,
  });
}

/** Read a workspace-relative file with containment applied. */
export async function readContained(root: string, relPath: string): Promise<AdapterResult<Uint8Array>> {
  let full: string;
  try {
    full = resolveInWorkspaceSafe(root, relPath, (m) => new Error(m));
  } catch (e) {
    return fail("workspace_escape", (e as Error).message);
  }
  try {
    const buf = await fs.readFile(full);
    return ok(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fail("file_not_found", `"${relPath}" does not exist in the workspace.`);
    if (code === "EISDIR") return fail("invalid_input", `"${relPath}" is a directory, not a file.`);
    return fail("read_error", `could not read "${relPath}": ${(e as Error).message}`);
  }
}
