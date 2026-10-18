import fs from "node:fs";
import path from "node:path";

/**
 * Single implementation of the "stay inside the workspace" guard used by every
 * path-taking tool.
 *
 * Two layers:
 *  1. lexical — `path.resolve(root, rel)` must be the root or sit below it
 *     (blocks `..` and absolute paths);
 *  2. physical — the deepest EXISTING ancestor of the target is resolved with
 *     `realpath`, and must still be inside the real workspace root. This is what
 *     stops a symlink living inside the workspace (e.g. `link -> ~/.ssh`) from
 *     redirecting reads/writes elsewhere. A dangling symlink is rejected outright,
 *     because writing through it would create its (possibly external) target.
 *
 * `makeError` lets each module keep throwing its own `WorkspaceEscapeError` class.
 */
export function resolveInWorkspaceSafe(
  root: string,
  relPath: string | undefined,
  makeError: (message: string) => Error = (m) => new Error(m)
): string {
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, relPath ?? ".");
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
    throw makeError(`path "${relPath}" resolves outside the workspace root — refusing.`);
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootAbs);
  } catch {
    return full; // root itself does not exist yet — nothing to be redirected through
  }
  const inside = (p: string): boolean => p === realRoot || p.startsWith(realRoot + path.sep);

  let probe = full;
  for (;;) {
    try {
      if (!inside(fs.realpathSync(probe))) {
        throw makeError(`path "${relPath}" resolves outside the workspace root via a symlink — refusing.`);
      }
      return full;
    } catch (e) {
      if (!isNodeFsError(e)) throw e; // our own escape error
      let isLink = false;
      try {
        isLink = fs.lstatSync(probe).isSymbolicLink();
      } catch {
        /* not there at all — keep walking up */
      }
      if (isLink) {
        throw makeError(`path "${relPath}" goes through a dangling symlink — refusing.`);
      }
      const parent = path.dirname(probe);
      if (parent === probe) return full;
      probe = parent;
    }
  }
}

function isNodeFsError(e: unknown): boolean {
  return typeof e === "object" && e !== null && typeof (e as NodeJS.ErrnoException).code === "string";
}
