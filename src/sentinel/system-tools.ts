// xcoder:version 4 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:29:23.635Z | xcoder:subtask code-st-8f12c6
/**
 * The only module that knows iptables vs netsh. Every block/unblock path is
 * re-validated here - inside the tool too, not only in the policy engine - so
 * any future caller is still safe.
 */
import { parseIpLiteral } from './ip.js';
import type { CommandRunner } from './command-runner.js';
import type { ActionOutcome } from './schema.js';

export interface Firewall {
  blockIp(ip: string, durationMinutes: number): Promise<ActionOutcome>;
  unblockIp(ip: string): Promise<ActionOutcome>;
  isBlocked(ip: string): Promise<boolean>;
}

export interface FirewallDeps {
  runner: CommandRunner;
  platform: NodeJS.Platform;
  allowlist: ReadonlySet<string>;
}

export function createFirewall(deps: FirewallDeps): Firewall {
  if (deps.platform === 'win32') return new WindowsFirewall(deps);
  return new LinuxFirewall(deps);
}

/** Dry-run and tests: records what would happen, touches nothing. */
export class NoopFirewall implements Firewall {
  readonly wouldBlock: string[] = [];

  async blockIp(ip: string, durationMinutes: number): Promise<ActionOutcome> {
    const started = Date.now();
    const valid = parseIpLiteral(ip);
    if (valid === null) {
      return { status: 'error', reason: 'invalid IP literal', durationMs: Date.now() - started };
    }
    this.wouldBlock.push(valid);
    return {
      status: 'skipped',
      reason: 'dry-run: would block ' + valid + ' for ' + durationMinutes + 'm',
      targetIp: valid,
      durationMinutes,
      durationMs: Date.now() - started,
    };
  }

  async unblockIp(ip: string): Promise<ActionOutcome> {
    return { status: 'skipped', reason: 'dry-run: would unblock ' + ip, durationMs: 0 };
  }

  async isBlocked(): Promise<boolean> {
    return false;
  }
}

export class LinuxFirewall implements Firewall {
  constructor(private readonly deps: FirewallDeps) {}

  private bin(ip: string): string {
    return ip.includes(':') ? 'ip6tables' : 'iptables';
  }

  async isBlocked(ip: string): Promise<boolean> {
    const valid = parseIpLiteral(ip);
    if (valid === null) return false;
    const bin = this.bin(valid);
    const result = await this.deps.runner.run({
      file: bin,
      args: ['-C', 'INPUT', '-s', valid, '-j', 'DROP', '-w'],
      timeoutMs: 10000,
      requiresElevation: true,
    });
    return result.code === 0;
  }

  async blockIp(ip: string, durationMinutes: number): Promise<ActionOutcome> {
    const started = Date.now();
    const done = (status: ActionOutcome['status'], reason: string, targetIp?: string): ActionOutcome =>
      ({ status, reason, targetIp, durationMinutes, durationMs: Date.now() - started });
    // 1. Re-validate (belt and braces before any argv is built).
    const valid = parseIpLiteral(ip);
    if (valid === null) return done('error', 'invalid IP literal');
    // 2. ADMIN_IP / allowlist guard, inside the tool too.
    if (this.deps.allowlist.has(valid)) return done('denied', 'ADMIN_IP protected', valid);
    // 3. Idempotency is a real OS check (T9), not bookkeeping.
    if (await this.isBlocked(valid)) return done('skipped', 'already blocked', valid);
    // 4. Bounded temporary block via a fixed argv shape.
    const bin = this.bin(valid);
    const result = await this.deps.runner.run({
      file: bin,
      args: ['-I', 'INPUT', '-s', valid, '-j', 'DROP'],
      timeoutMs: 10000,
      requiresElevation: true,
    });
    if (result.timedOut) return done('error', bin + ' timed out', valid);
    if (result.code === 0) return done('success', bin + ' inserted DROP for ' + durationMinutes + 'm', valid);
    const permission = /permission|operation not permitted|EPERM/i.test(result.stderr);
    const hint = permission ? ' (needs CAP_NET_ADMIN or a service account with it)' : '';
    return done('error', bin + ' failed: ' + (result.stderr.trim() || 'exit ' + result.code) + hint, valid);
  }

  async unblockIp(ip: string): Promise<ActionOutcome> {
    const started = Date.now();
    const valid = parseIpLiteral(ip);
    if (valid === null) return { status: 'error', reason: 'invalid IP literal', durationMs: Date.now() - started };
    const bin = this.bin(valid);
    const result = await this.deps.runner.run({
      file: bin,
      args: ['-D', 'INPUT', '-s', valid, '-j', 'DROP'],
      timeoutMs: 10000,
      requiresElevation: true,
    });
    const status: ActionOutcome['status'] = result.code === 0 ? 'success' : 'error';
    return {
      status,
      reason: status === 'success' ? 'rule removed' : bin + ' failed: ' + result.stderr.trim(),
      targetIp: valid,
      durationMs: Date.now() - started,
    };
  }
}

export class WindowsFirewall implements Firewall {
  constructor(private readonly deps: FirewallDeps) {}

  private ruleName(ip: string): string {
    return 'sentinel-block-' + ip;
  }

  async isBlocked(ip: string): Promise<boolean> {
    const valid = parseIpLiteral(ip);
    if (valid === null) return false;
    // netsh has no dry check; a deleted rule is the only not-blocked signal,
    // so we treat 'show rule' presence as authoritative via a -C-like probe.
    const result = await this.deps.runner.run({
      file: 'netsh',
      args: ['advfirewall', 'firewall', 'show', 'rule', 'name=' + this.ruleName(valid)],
      timeoutMs: 10000,
      requiresElevation: true,
    });
    return result.code === 0 && result.stdout.includes(this.ruleName(valid));
  }

  async blockIp(ip: string, durationMinutes: number): Promise<ActionOutcome> {
    const started = Date.now();
    const valid = parseIpLiteral(ip);
    if (valid === null) return { status: 'error', reason: 'invalid IP literal', durationMs: Date.now() - started };
    if (this.deps.allowlist.has(valid)) {
      return { status: 'denied', reason: 'ADMIN_IP protected', targetIp: valid, durationMs: Date.now() - started };
    }
    if (await this.isBlocked(valid)) {
      return { status: 'skipped', reason: 'already blocked', targetIp: valid, durationMinutes, durationMs: Date.now() - started };
    }
    const result = await this.deps.runner.run({
      file: 'netsh',
      args: [
        'advfirewall', 'firewall', 'add', 'rule',
        'name=' + this.ruleName(valid), 'dir=in', 'action=block', 'remoteip=' + valid,
      ],
      timeoutMs: 10000,
      requiresElevation: true,
    });
    const ok = result.code === 0;
    return {
      status: ok ? 'success' : 'error',
      reason: ok ? 'rule added for ' + durationMinutes + 'm' : 'netsh failed: ' + result.stderr.trim(),
      targetIp: valid,
      durationMinutes,
      durationMs: Date.now() - started,
    };
  }

  async unblockIp(ip: string): Promise<ActionOutcome> {
    const started = Date.now();
    const valid = parseIpLiteral(ip);
    if (valid === null) return { status: 'error', reason: 'invalid IP literal', durationMs: Date.now() - started };
    const result = await this.deps.runner.run({
      file: 'netsh',
      args: ['advfirewall', 'firewall', 'delete', 'rule', 'name=' + this.ruleName(valid)],
      timeoutMs: 10000,
      requiresElevation: true,
    });
    return {
      status: result.code === 0 ? 'success' : 'error',
      reason: result.code === 0 ? 'rule removed' : 'netsh failed: ' + result.stderr.trim(),
      targetIp: valid,
      durationMs: Date.now() - started,
    };
  }
}
