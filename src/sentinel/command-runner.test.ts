// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:33:21.868Z | xcoder:subtask code-st-8f12c6
import { describe, it, expect } from 'vitest';
import { argvShapeAllowed, NodeCommandRunner } from './command-runner.js';

describe('argvShapeAllowed', () => {
  it('accepts the exact iptables insert shape', () => {
    expect(argvShapeAllowed('iptables', ['-I', 'INPUT', '-s', '203.0.113.9', '-j', 'DROP'])).toBe(true);
  });

  it('accepts the exact iptables check shape', () => {
    expect(argvShapeAllowed('iptables', ['-C', 'INPUT', '-s', '203.0.113.9', '-j', 'DROP', '-w'])).toBe(true);
  });

  it('accepts the exact netsh add shape', () => {
    expect(
      argvShapeAllowed('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        'name=sentinel-block-203.0.113.9', 'dir=in', 'action=block', 'remoteip=203.0.113.9',
      ]),
    ).toBe(true);
  });

  it('refuses any binary outside the allowlist', () => {
    expect(argvShapeAllowed('sh', ['-c', 'curl evil'])).toBe(false);
    expect(argvShapeAllowed('bash', ['-c', 'id'])).toBe(false);
    expect(argvShapeAllowed('sudo', ['iptables'])).toBe(false);
  });

  it('refuses shell metacharacters smuggled into an argument', () => {
    expect(argvShapeAllowed('iptables', ['-I', 'INPUT', '-s', '1.2.3.4; rm -rf /', '-j', 'DROP'])).toBe(false);
    expect(argvShapeAllowed('iptables', ['-I', 'INPUT', '-s', '$(id)', '-j', 'DROP'])).toBe(false);
  });

  it('refuses a valid binary with a mangled argv', () => {
    expect(argvShapeAllowed('iptables', ['-F'])).toBe(false);
    expect(argvShapeAllowed('netsh', ['advfirewall', 'reset'])).toBe(false);
  });
});

describe('NodeCommandRunner', () => {
  it('refuses to spawn a non-allowlisted binary without executing it', async () => {
    const runner = new NodeCommandRunner();
    const result = await runner.run({ file: 'bash', args: ['-c', 'echo pwned'], timeoutMs: 5000, requiresElevation: false });
    expect(result.code).toBeNull();
    expect(result.stderr).toContain('refused');
    expect(result.stdout).toBe('');
  });
});
