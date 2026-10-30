#!/usr/bin/env node
// xcoder:version 1 | xcoder:task litecoder-1793381927596 | xcoder:updated 2026-10-30T17:42:45.921Z | xcoder:subtask implement-sentinel-cli
/**
 * standalone `sentinel` bin — the security daemon as its own command.
 *
 * Parses the shared command definition from `./cli.js` (the same one
 * `litecoder sentinel` mounts), so the two surfaces cannot drift. The filtered
 * .env loader runs first, exactly like the other bins, otherwise `SENTINEL_*`
 * and provider settings from a project `.env` would silently not load.
 */
import '../config/loadConfig.js';
import { createSentinelCommand } from './cli.js';

createSentinelCommand({ standalone: true, programLabel: 'sentinel' })
  .parseAsync(process.argv)
  .catch((e: unknown) => {
    process.stderr.write(`sentinel: ${(e as Error)?.message ?? String(e)}\n`);
    process.exitCode = 2;
  });
