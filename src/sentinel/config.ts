// xcoder:version 9 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:25:38.977Z | xcoder:subtask code-st-8f12c6
/**
 * Sentinel configuration: env + optional JSON config text into a validated
 * SentinelConfig, refusing to start on an unsafe or incomplete config.
 * Secret-shaped fields are dropped by name before any config logging.
 */
import { parseIpLiteral } from './ip.js';
import type { LogSourceConfig } from './schema.js';

export interface HitlConfig {
  enabled: boolean;
  mode: 'prompt' | 'notify';
  timeoutMs: number;
}

export interface SentinelConfig {
  adminIp: string;
  adminIpAllowlist: string[];
  sources: LogSourceConfig[];
  pollIntervalMs: number;
  maxLinesPerBatch: number;
  maxLlmCallsPerMinute: number;
  llmTimeoutMs: number;
  hitl: HitlConfig;
  blockDurationMinutes: number;
  maxFailedAttempts: number;
  killSwitchPath: string;
  offsetStorePath: string;
  auditLogPath: string;
  auditRetentionDays: number;
  auditMaxBytes: number;
  dryRun: boolean;
}

export class SentinelConfigError extends Error {
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(field + ': ' + detail);
    this.name = 'SentinelConfigError';
  }
}

const DEFAULTS = {
  pollIntervalMs: 5000,
  maxLinesPerBatch: 200,
  maxLlmCallsPerMinute: 20,
  llmTimeoutMs: 20000,
  hitlTimeoutMs: 900000,
  blockDurationMinutes: 1440,
  maxFailedAttempts: 5,
  auditRetentionDays: 30,
  auditMaxBytes: 67108864,
} as const;

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function num(raw: string | undefined, fallback: number, field: string, min: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    throw new SentinelConfigError(field, 'expected an integer >= ' + min);
  }
  return n;
}

interface FileShape {
  sources?: Array<{ id?: string; path?: string; kind?: string }>;
  adminIpAllowlist?: string[];
  dryRun?: boolean;
  hitl?: { enabled?: boolean; mode?: string; timeoutMs?: number };
  blockDurationMinutes?: number;
  maxFailedAttempts?: number;
  pollIntervalMs?: number;
  maxLinesPerBatch?: number;
}

function parseFileText(fileText: string | undefined): FileShape {
  if (!fileText || fileText.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new SentinelConfigError('configFile', 'not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SentinelConfigError('configFile', 'expected a JSON object');
  }
  return parsed as FileShape;
}

export function loadSentinelConfig(env: NodeJS.ProcessEnv, fileText?: string): SentinelConfig {
  const file = parseFileText(fileText);

  const rawAdmin = (env.SENTINEL_ADMIN_IP ?? '').trim();
  if (rawAdmin === '') {
    throw new SentinelConfigError('adminIp', 'SENTINEL_ADMIN_IP is required');
  }
  const adminIp = parseIpLiteral(rawAdmin);
  if (adminIp === null) {
    throw new SentinelConfigError('adminIp', 'SENTINEL_ADMIN_IP is not a valid IP literal');
  }

  const allowlistRaw = [...(file.adminIpAllowlist ?? []), ...(env.SENTINEL_ALLOWLIST ?? '').split(',')]
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const allowlist: string[] = [adminIp];
  for (const entry of allowlistRaw) {
    const ip = parseIpLiteral(entry);
    if (ip === null) {
      throw new SentinelConfigError('adminIpAllowlist', 'contains a non-IP value');
    }
    if (!allowlist.includes(ip)) allowlist.push(ip);
  }

  const sources: LogSourceConfig[] = [];
  const rawSources = env.SENTINEL_LOG_PATHS ?? '';
  if (rawSources.trim() !== '') {
    for (const entry of rawSources.split(',').map((s) => s.trim()).filter((s) => s !== '')) {
      sources.push({ id: 'env-' + (sources.length + 1), path: entry, kind: 'generic' });
    }
  }
  for (const s of file.sources ?? []) {
    const id = (s.id ?? '').trim();
    const p = (s.path ?? '').trim();
    if (id === '' || p === '') {
      throw new SentinelConfigError('sources', 'every source needs a non-empty id and path');
    }
    const kind = s.kind === 'auth' || s.kind === 'web' ? s.kind : 'generic';
    sources.push({ id, path: p, kind });
  }
  if (sources.length === 0) {
    throw new SentinelConfigError('sources', 'at least one log source is required');
  }

  const hitlModeRaw = (file.hitl?.mode ?? env.SENTINEL_HITL_MODE ?? 'notify').trim();
  if (hitlModeRaw !== 'prompt' && hitlModeRaw !== 'notify') {
    throw new SentinelConfigError('hitl.mode', "expected 'prompt' or 'notify'");
  }

  const config: SentinelConfig = {
    adminIp,
    adminIpAllowlist: allowlist,
    sources,
    pollIntervalMs: num(env.SENTINEL_POLL_MS, file.pollIntervalMs ?? DEFAULTS.pollIntervalMs, 'pollIntervalMs', 500),
    maxLinesPerBatch: num(env.SENTINEL_MAX_LINES, file.maxLinesPerBatch ?? DEFAULTS.maxLinesPerBatch, 'maxLinesPerBatch', 1),
    maxLlmCallsPerMinute: num(env.SENTINEL_MAX_LLM_CALLS_PER_MIN, DEFAULTS.maxLlmCallsPerMinute, 'maxLlmCallsPerMinute', 1),
    llmTimeoutMs: num(env.SENTINEL_LLM_TIMEOUT_MS, DEFAULTS.llmTimeoutMs, 'llmTimeoutMs', 1000),
    hitl: {
      enabled: file.hitl?.enabled ?? bool(env.SENTINEL_HITL_ENABLED, true),
      mode: hitlModeRaw,
      timeoutMs: num(env.SENTINEL_HITL_TIMEOUT_MS, file.hitl?.timeoutMs ?? DEFAULTS.hitlTimeoutMs, 'hitl.timeoutMs', 1000),
    },
    blockDurationMinutes: num(env.SENTINEL_BLOCK_MINUTES, file.blockDurationMinutes ?? DEFAULTS.blockDurationMinutes, 'blockDurationMinutes', 1),
    maxFailedAttempts: num(env.SENTINEL_MAX_FAILED_ATTEMPTS, file.maxFailedAttempts ?? DEFAULTS.maxFailedAttempts, 'maxFailedAttempts', 1),
    killSwitchPath: (env.SENTINEL_KILL_SWITCH ?? '').trim(),
    offsetStorePath: (env.SENTINEL_OFFSET_PATH ?? '.sentinel-offsets.json').trim(),
    auditLogPath: (env.SENTINEL_AUDIT_PATH ?? '.sentinel-audit.jsonl').trim(),
    auditRetentionDays: num(env.SENTINEL_AUDIT_RETENTION_DAYS, DEFAULTS.auditRetentionDays, 'auditRetentionDays', 1),
    auditMaxBytes: num(env.SENTINEL_AUDIT_MAX_BYTES, DEFAULTS.auditMaxBytes, 'auditMaxBytes', 1024),
    dryRun: file.dryRun ?? bool(env.SENTINEL_DRYRUN, true),
  };

  // Blocks are always temporary; guard the ceiling as well as the floor.
  if (config.blockDurationMinutes > 10080) {
    throw new SentinelConfigError('blockDurationMinutes', 'must be <= 10080 (7 days)');
  }
  return config;
}

const SECRET_NAME = /(api[_-]?key|secret|token|password|passwd|credential)/i;

/** A loggable projection of the config - secret-shaped keys dropped by name. */
export function describeConfig(config: SentinelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (SECRET_NAME.test(k)) continue;
    out[k] = v;
  }
  return out;
}
