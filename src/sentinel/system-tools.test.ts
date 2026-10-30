// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:33:26.142Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { createFirewall, NoopFirewall } from './system-tools.js';
import type { CommandResult, CommandRunner, CommandSpec } from './command-runner.js';

const ADMIN = '10.0.0.5';
const ATTACKER = '203.0.113.9';

class FakeRunner implements CommandRunner {
  readonly calls: CommandSpec[] = [];
  constructor(private readonly blocked = false) {}

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec);
    if (spec.args.includes('-C')) {
      return { code: this.blocked ? 0 : 1, stdout: '', stderr: '', timedOut: false };
    }
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  }
}

describe('firewall', () => {
  it('refuses to block the admin IP even when called directly', async () => {
    const runner = new FakeRunner();
    const fw = createFirewall({ runner, platform: 'linux', allowlist: new Set([ADMIN]) });
    const out = await fw.blockIp(ADMIN, 60);
    expect(out.status).toBe('denied');
    expect(out.reason).toContain('ADMIN_IP');
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects an invalid IP literal before building any argv', async () => {
    const runner = new FakeRunner();
    const fw = createFirewall({ runner, platform: 'linux', allowlist: new Set([ADMIN]) });
    const out = await fw.blockIp('1.2.3.4; rm -rf /', 60);
    expect(out.status).toBe('error');
    expect(runner.calls).toHaveLength(0);
  });

  it('skips a duplicate block after a real OS check', async () => {
    const runner = new FakeRunner(true);
    const fw = createFirewall({ runner, platform: 'linux', allowlist: new Set([ADMIN]) });
    const out = await fw.blockIp(ATTACKER, 60);
    expect(out.status).toBe('skipped');
    expect(runner.calls.some((c) => c.args.includes('-I'))).toBe(false);
  });

  it('inserts a temporary DROP rule for a fresh attacker IP', async () => {
    const runner = new FakeRunner(false);
    const fw = createFirewall({ runner, platform: 'linux', allowlist: new Set([ADMIN]) });
    const out = await fw.blockIp(ATTACKER, 60);
    expect(out.status).toBe('success');
    expect(out.durationMinutes).toBe(60);
    expect(runner.calls.some((c) => c.args.includes('-I'))).toBe(true);
  });

  it('uses ip6tables for an IPv6 target', async () => {
    const runner = new FakeRunner(false);
    const fw = createFirewall({ runner, platform: 'linux', allowlist: new Set([ADMIN]) });
    await fw.blockIp('2001:db8::1', 60);
    expect(runner.calls.every((c) => c.file === 'ip6tables')).toBe(true);
  });

  it('dry-run records intent and touches nothing', async () => {
    const fw = new NoopFirewall();
    const out = await fw.blockIp(ATTACKER, 60);
    expect(out.status).toBe('skipped');
    expect(fw.wouldBlock).toContain(ATTACKER);
  });
});
