// xcoder:version 2 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:25:44.501Z | xcoder:subtask code-st-8f12c6
/**
 * Fail-fast startup checks: a misconfigured daemon must refuse to start
 * rather than run half-blind. Field names are reported, never file content.
 */
import { constants as fsConstants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SentinelConfigError, type SentinelConfig } from './config.js';
import { RULES } from './policy/rules.js';

/** True if the process is root/Administrator and has not opted in. */
function isPrivileged(): boolean {
  if (process.platform === 'win32') return false;
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  return uid === 0;
}

/**
 * Verifies, in order: at least one source, every source readable, audit dir
 * writable, policy loaded and non-empty, and that we are not silently
 * running privileged.
 */
export async function preflight(config: SentinelConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (config.sources.length === 0) {
    throw new SentinelConfigError('sources', 'at least one readable log source is required');
  }
  for (const source of config.sources) {
    try {
      await access(source.path, fsConstants.R_OK);
    } catch {
      throw new SentinelConfigError('sources.' + source.id, 'log file is not readable');
    }
  }
  const auditDir = path.dirname(path.resolve(config.auditLogPath));
  try {
    await mkdir(auditDir, { recursive: true });
    await access(auditDir, fsConstants.W_OK);
  } catch {
    throw new SentinelConfigError('auditLogPath', 'audit directory is not writable');
  }
  if (!Array.isArray(RULES) || RULES.length === 0) {
    throw new SentinelConfigError('policy', 'policy module loaded but empty');
  }
  if (isPrivileged() && env.SENTINEL_ALLOW_PRIVILEGED !== '1') {
    throw new SentinelConfigError('privilege', 'refusing to run as root without SENTINEL_ALLOW_PRIVILEGED=1');
  }
}
