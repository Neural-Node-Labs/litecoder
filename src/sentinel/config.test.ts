// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:34:04.468Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { loadSentinelConfig, SentinelConfigError, describeConfig } from './config.js';

describe('loadSentinelConfig', () => {
  it('refuses to start without an admin IP', () => {
    expect(() => loadSentinelConfig({ SENTINEL_LOG_PATHS: '/var/log/auth.log' })).toThrow(SentinelConfigError);
  });

  it('refuses an admin IP that is not a literal (no CIDR, no injection)', () => {
    expect(() => loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.0/8', SENTINEL_LOG_PATHS: 'x' })).toThrow(SentinelConfigError);
    expect(() => loadSentinelConfig({ SENTINEL_ADMIN_IP: '1.2.3.4; id', SENTINEL_LOG_PATHS: 'x' })).toThrow(SentinelConfigError);
  });

  it('refuses to start with no log sources', () => {
    expect(() => loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5' })).toThrow(/sources/);
  });

  it('always includes the admin IP in the never-block allowlist', () => {
    const c = loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5', SENTINEL_LOG_PATHS: '/var/log/auth.log' });
    expect(c.adminIpAllowlist).toContain('10.0.0.5');
  });

  it('defaults dry-run ON: no day-one autonomy', () => {
    const c = loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5', SENTINEL_LOG_PATHS: 'x' });
    expect(c.dryRun).toBe(true);
  });

  it('opts into live blocks only via an explicit documented env var', () => {
    const c = loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5', SENTINEL_LOG_PATHS: 'x', SENTINEL_DRYRUN: '0' });
    expect(c.dryRun).toBe(false);
  });

  it('caps block duration at 7 days: permanent blocks do not exist', () => {
    expect(() =>
      loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5', SENTINEL_LOG_PATHS: 'x', SENTINEL_BLOCK_MINUTES: '999999' }),
    ).toThrow(/permanent|10080/);
  });

  it('rejects a malformed config file', () => {
    expect(() => loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5' }, '{ not json')).toThrow(/configFile/);
  });
});

describe('describeConfig', () => {
  it('drops secret-shaped keys by name before logging', () => {
    const c = loadSentinelConfig({ SENTINEL_ADMIN_IP: '10.0.0.5', SENTINEL_LOG_PATHS: 'x' });
    const described = describeConfig({ ...c, apiKey: 'sk-secret' } as never);
    expect(described.apiKey).toBeUndefined();
    expect(JSON.stringify(described)).not.toContain('sk-secret');
  });
});
