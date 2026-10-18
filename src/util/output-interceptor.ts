// xcoder:version 1 | xcoder:task task-e23ea7 | xcoder:updated 2026-08-05T09:39:06.813Z | xcoder:subtask code-st-a00941
import type { ScrollRegionGuard } from "./scroll-region-guard.js";

/**
 * OutputInterceptor — monkey-patches `process.stdout.write` during the
 * footer's active lifetime to route ALL writes through the ScrollRegionGuard.
 *
 * This is the "nuclear option" that guarantees no write can break the
 * scroll region, even from third-party code or libraries we don't control
 * (ora, clack, etc.).
 *
 * Activated via XCODER_INTERCEPT_STDOUT=1 feature flag. Not enabled by
 * default because monkey-patching process.stdout.write is fragile and
 * can interfere with cursor-positioning ANSI sequences that clack/ora
 * rely on.
 *
 * @param guard - The ScrollRegionGuard to route writes through.
 * @returns A restore function that undoes the monkey-patch.
 */
export function interceptStdout(guard: ScrollRegionGuard): () => void {
  const originalWrite = process.stdout.write.bind(process.stdout);

  // Prevent double-patching
  if ((process.stdout.write as unknown as { _intercepted?: boolean })._intercepted) {
    return () => {};
  }
  (process.stdout.write as unknown as { _intercepted?: boolean })._intercepted = true;

  process.stdout.write = function (
    this: typeof process.stdout,
    chunk: Uint8Array | string,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void
  ): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = typeof chunk === "string" ? chunk : (chunk as any).toString();

    // Resolve callback arguments
    let callback: ((err?: Error) => void) | undefined;
    let encoding: BufferEncoding | undefined;
    if (typeof encodingOrCb === "function") {
      callback = encodingOrCb;
    } else if (encodingOrCb) {
      encoding = encodingOrCb;
      callback = cb;
    }

    // Guard: write safely through the scroll region
    guard.write(text);

    // Fire callback if provided
    if (callback) {
      callback();
    }
    return true;
  } as typeof process.stdout.write;

  return () => {
    (process.stdout.write as unknown as { _intercepted?: boolean })._intercepted = false;
    process.stdout.write = originalWrite;
  };
}
