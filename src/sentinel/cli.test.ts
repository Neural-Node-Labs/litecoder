// xcoder:version 5 | xcoder:task task-ae8e62 | xcoder:updated 2026-10-30T18:07:26.286Z | xcoder:subtask test-st-4a46f6
// xcoder:task task-ae8e62 | xcoder:subtask test-st-4a46f6
/**
 * Contract tests for the `sentinel` command definition (src/sentinel/cli.ts).
 *
 * These assert the INTENDED surface described by the 3.1.1 docs/design, not
 * merely whatever the current code happens to do:
 *  - `sentinel` is its own CLI, owns `--version`, and reports 3.1.1.
 *  - `litecoder sentinel` mounts the exact same definition (no drift).
 *  - every advertised flag (--once, --approve, --deny, --config, --no-dry-run)
 *    is documented in help and actually reaches the code that acts on it.
 *  - --config <path> is read from disk and its settings apply to the run.
 *  - failures are reported on stderr with the correct program label and set
 *    a non-zero exit code rather than throwing out of the action.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';

vi.mock('./run.js', () => ({ runSentinel: vi.fn(async () => 0) }));
vi.mock('./approval-inbox.js', () => ({ recordVerdict: vi.fn(async () => undefined) }));

import { createSentinelCommand, registerSentinelCommand } from './cli.js';
import { runSentinel } from './run.js';
import { recordVerdict } from './approval-inbox.js';
import { loadSentinelConfig } from './config.js';
import { KOODER_VERSION } from '../version.js';

const ENV_KEYS = [
  'SENTINEL_ADMIN_IP',
  'SENTINEL_LOG_PATHS',
  'SENTINEL_ALLOWLIST',
  'SENTINEL_DRYRUN',
  'SENTINEL_HITL_MODE',
] as const;

let dir: string;
let savedEnv: Record<string, string | undefined>;
let savedExitCode: typeof process.exitCode;
let out: string;
let err: string;

interface ExitInfo {
  exitCode?: number;
  code?: string;
}

/** Parse argv against a fresh command; return the CommanderError, if any. */
async function invoke(
  argv: string[],
  opts: { standalone?: boolean; programLabel?: string } = {},
): Promise<ExitInfo | null> {
  const cmd = createSentinelCommand(opts);
  cmd.exitOverride();
  try {
    await cmd.parseAsync(['node', 'sentinel', ...argv]);
    return null;
  } catch (e) {
    return e as ExitInfo;
  }
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sentinel-cli-'));
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  savedExitCode = process.exitCode;

  process.env.SENTINEL_ADMIN_IP = '10.0.0.5';
  process.env.SENTINEL_LOG_PATHS = '/var/log/auth.log';
  delete process.env.SENTINEL_ALLOWLIST;
  delete process.env.SENTINEL_DRYRUN;
  delete process.env.SENTINEL_HITL_MODE;

  vi.mocked(runSentinel).mockClear();
  vi.mocked(runSentinel).mockResolvedValue(0);
  vi.mocked(recordVerdict).mockClear();

  out = '';
  err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  process.exitCode = savedExitCode;
  await rm(dir, { recursive: true, force: true });
});

describe('sentinel as its own CLI', () => {
  it('reports version 3.1.1 and exits 0 for `sentinel --version`', async () => {
    expect(KOODER_VERSION).toBe('3.1.1');
    const info = await invoke(['--version'], { standalone: true });
    expect(info?.exitCode).toBe(0);
    expect(out.trim()).toBe(KOODER_VERSION);
  });

  it('presents itself as `sentinel [options]`, not as a litecoder subcommand', () => {
    const help = createSentinelCommand({ standalone: true }).helpInformation();
    expect(help).toMatch(/Usage: sentinel \[options\]/);
    expect(help).not.toMatch(/litecoder/);
  });

  it('does not register --version on the litecoder-mounted copy', async () => {
    const help = createSentinelCommand().helpInformation();
    expect(help).not.toMatch(/-V, --version/);
    const info = await invoke(['--version']);
    expect(info?.exitCode).toBe(1);
  });

  it('documents every option it advertises', async () => {
    // --help goes through addHelpText, so assert on what the user actually sees.
    await invoke(['--help']);
    for (const flag of ['--no-dry-run', '--once', '--approve <id>', '--deny <id>', '--config <path>']) {
      expect(out).toContain(flag);
    }
    // The env contract the daemon refuses to start without is surfaced in help.
    expect(out).toContain('SENTINEL_ADMIN_IP');
    expect(out).toContain('SENTINEL_LOG_PATHS');
  });
});

describe('shared definition between `sentinel` and `litecoder sentinel`', () => {
  it('mounts an identical option list and description under litecoder', () => {
    const program = new Command('litecoder');
    registerSentinelCommand(program);
    const mounted = program.commands.find((c) => c.name() === 'sentinel');
    expect(mounted).toBeDefined();

    const standalone = createSentinelCommand({ standalone: true });
    expect(mounted!.description()).toBe(standalone.description());
    // --version is deliberately owned by the standalone bin only, so compare
    // everything else: the shared surface must not drift.
    const flags = (c: Command) =>
      c.options
        .filter((o) => o.long !== '--version')
        .map((o) => `${o.short ?? ''}|${o.long}|${o.required}`)
        .sort();
    expect(flags(mounted!)).toEqual(flags(standalone));
  });

  it('routes `litecoder sentinel --once` into the same handler', async () => {
    const program = new Command('litecoder');
    program.exitOverride();
    registerSentinelCommand(program);
    await program.parseAsync(['node', 'litecoder', 'sentinel', '--once']);
    expect(runSentinel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runSentinel).mock.calls[0][0].once).toBe(true);
  });
});

describe('running a monitoring cycle', () => {
  it('defaults to dry-run: SENTINEL_DRYRUN is left untouched', async () => {
    await invoke(['--once']);
    const args = vi.mocked(runSentinel).mock.calls[0][0];
    expect(args.once).toBe(true);
    expect(args.env?.SENTINEL_DRYRUN).toBeUndefined();
    expect(args.signal).toBeInstanceOf(AbortSignal);
  });

  it('--no-dry-run opts the daemon into applying blocks', async () => {
    await invoke(['--no-dry-run', '--once']);
    expect(vi.mocked(runSentinel).mock.calls[0][0].env?.SENTINEL_DRYRUN).toBe('0');
  });

  it('propagates the daemon exit code to process.exitCode', async () => {
    vi.mocked(runSentinel).mockResolvedValue(3);
    await invoke(['--once']);
    expect(process.exitCode).toBe(3);
  });
});

describe('answering the HITL gate', () => {
  it('--approve records a granted verdict in the configured inbox and does not start the daemon', async () => {
    const expectedInbox = loadSentinelConfig(process.env).offsetStorePath + '.approvals.json';
    await invoke(['--approve', 'dec-1']);
    expect(recordVerdict).toHaveBeenCalledWith(expectedInbox, 'dec-1', 'granted');
    expect(out).toBe('approved dec-1\n');
    expect(runSentinel).not.toHaveBeenCalled();
  });

  it('--deny records a denied verdict and does not start the daemon', async () => {
    const expectedInbox = loadSentinelConfig(process.env).offsetStorePath + '.approvals.json';
    await invoke(['--deny', 'dec-2']);
    expect(recordVerdict).toHaveBeenCalledWith(expectedInbox, 'dec-2', 'denied');
    expect(out).toBe('denied dec-2\n');
    expect(runSentinel).not.toHaveBeenCalled();
  });
});

describe('--config <path>', () => {
  it('reads the JSON file and applies its settings to the inbox path', async () => {
    const file = path.join(dir, 'sentinel.json');
    const body = JSON.stringify({ adminIpAllowlist: ['10.0.0.9'] });
    await writeFile(file, body, 'utf8');

    await invoke(['--config', file, '--approve', 'dec-9']);

    const config = loadSentinelConfig(process.env, body);
    expect(recordVerdict).toHaveBeenCalledWith(
      config.offsetStorePath + '.approvals.json',
      'dec-9',
      'granted',
    );
  });

  it('surfaces an invalid JSON config on stderr with exit code 2 instead of starting', async () => {
    const file = path.join(dir, 'broken.json');
    await writeFile(file, '{ not json', 'utf8');
    await invoke(['--config', file, '--once'], { standalone: true, programLabel: 'sentinel' });
    expect(err).toMatch(/^sentinel: /);
    expect(err).toContain('configFile');
    expect(runSentinel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('fails cleanly when the config path does not exist', async () => {
    const missing = path.join(dir, 'nope.json');
    await invoke(['--config', missing, '--once'], { standalone: true });
    expect(err).toMatch(/sentinel: .*(ENOENT|no such file)/i);
    expect(runSentinel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  // Intended: "Path to a JSON config file (env still applies)" means the file's
  // settings must govern the daemon run. Today cli.ts parses the file only to derive
  // the approvals-inbox path and calls runSentinel({env, signal, once}) without the
  // file text, so run.ts re-loads config from the environment alone and the file is
  // silently ignored by the monitoring cycle. Tracked as .xcoder/defects/defect0001.md
  // — flip this to it() once fixed.
  it.fails('forwards the config file to the daemon run', async () => {
    const file = path.join(dir, 'sentinel.json');
    const body = JSON.stringify({ blockDurationMinutes: 5, hitl: { mode: 'prompt' } });
    await writeFile(file, body, 'utf8');

    await invoke(['--config', file, '--once']);
    const args = vi.mocked(runSentinel).mock.calls[0][0] as { fileText?: string };
    expect(args.fileText).toBe(body);
  });
});

describe('error reporting', () => {
  it('prefixes standalone failures with `sentinel:` and exits 2', async () => {
    vi.mocked(runSentinel).mockRejectedValue(new Error('adminIp: SENTINEL_ADMIN_IP is required'));
    // bin.ts always supplies programLabel: 'sentinel' alongside standalone: true.
    await invoke(['--once'], { standalone: true, programLabel: 'sentinel' });
    expect(err).toBe('sentinel: adminIp: SENTINEL_ADMIN_IP is required\n');
    expect(process.exitCode).toBe(2);
  });

  it('keeps the stable `litecoder sentinel:` prefix for the mounted surface', async () => {
    vi.mocked(runSentinel).mockRejectedValue(new Error('boom'));
    await invoke(['--once']);
    expect(err).toBe('litecoder sentinel: boom\n');
    expect(process.exitCode).toBe(2);
  });
});
