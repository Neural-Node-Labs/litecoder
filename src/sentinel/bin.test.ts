// xcoder:version 1 | xcoder:task litecoder-1793381927596 | xcoder:updated 2026-10-30T17:42:57.663Z | xcoder:subtask implement-sentinel-cli
// Smoke tests for the standalone `sentinel` bin (design: CHANGE_MAP.md §4/§F).
// Only --help / --version: the child process never reaches the daemon action,
// so there is no network access, no LLM call and no log tailing.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KOODER_VERSION } from '../version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const binPath = path.join(root, 'src', 'sentinel', 'bin.ts');

interface CliRun {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(args: string[]): CliRun {
  const res = spawnSync(process.execPath, ['--import', 'tsx', binPath, ...args], {
    encoding: 'utf8',
    timeout: 25_000,
    windowsHide: true,
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status };
}

describe('standalone sentinel bin', () => {
  it('presents itself as `sentinel`, not `litecoder sentinel`', () => {
    const { stdout, status } = run(['--help']);

    expect(status).toBe(0);
    expect(stdout).toContain('Usage: sentinel [options]');
    expect(stdout).not.toContain('Usage: litecoder');
  });

  it('documents every option the shared command definition registers', () => {
    const { stdout } = run(['--help']);

    for (const flag of ['--no-dry-run', '--once', '--approve <id>', '--deny <id>', '--config <path>']) {
      expect(stdout).toContain(flag);
    }
  });

  it('owns --version and reports the single declared version', () => {
    const { stdout, status } = run(['--version']);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe(KOODER_VERSION);
  });
});
