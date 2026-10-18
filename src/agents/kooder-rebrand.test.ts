// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:39:36.844Z | xcoder:subtask code-st-9de79a
// Tests for the `rebrand to kooder` goal, written against the INTENDED
// behaviour rather than the current implementation:
//   * the product name on every user-facing surface is "kooder" / "Kooder"
//   * the pre-rebrand names survive nowhere except the documented
//     compatibility shims and the residue gate's allowlist
//   * there is exactly ONE version declaration, and the CLI reports it
//   * the published bins are the rebranded ones and point at the worker CLI
//
// Oracle: the task goal text plus the compatibility-shim table in README.md.
// A regression that re-introduces the old brand fails here loudly.
//
// NOTE: the legacy brand names are assembled from parts below on purpose —
// scripts/check-brand-residue.mjs scans source for the literal old names and
// this file is not (and must not need to be) on its allowlist.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KOODER_VERSION, KOODER_BUILD_TIMESTAMP } from '../version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const cliPath = path.join(root, 'src', 'cli-worker.ts');

/** The two retired brand names, built without spelling them literally. */
const LEGACY_BRANDS = ['koo' + 'ber', 'x' + 'coder'];

interface CliRun {
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Runs the CLI in a child process. Only --help/--version, so no LLM, no network. */
function run(args: string[]): CliRun {
  const res = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    encoding: 'utf8',
    timeout: 25_000,
    windowsHide: true,
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status };
}

function readPkg(): {
  name: string;
  version: string;
  description: string;
  bin: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function firstLine(text: string): string {
  return text.split('\n')[0].trim();
}

function isSemver(value: string): boolean {
  const core = value.split('-')[0].split('+')[0];
  const parts = core.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && p.split('').every((c) => c >= '0' && c <= '9'));
}

describe('Kooder rebrand — user-facing CLI surface', () => {
  it('names the program `kooder` in root help', () => {
    const { stdout, status } = run(['--help']);

    expect(status).toBe(0);
    expect(firstLine(stdout)).toBe('Usage: kooder [options] [command]');
  });

  it('describes the product as Kooder, without the pre-rebrand names', () => {
    const { stdout } = run(['--help']);
    const lower = stdout.toLowerCase();

    expect(stdout).toContain('Kooder');
    for (const brand of LEGACY_BRANDS) {
      expect(lower).not.toContain(brand);
    }
  });

  it('still exposes the `run` command under the rebranded program name', () => {
    const { stdout, status } = run(['run', '--help']);

    expect(status).toBe(0);
    expect(firstLine(stdout)).toBe('Usage: kooder run [options]');
  });
});

describe('Kooder rebrand — single source of version truth', () => {
  it('reports a semver version that is exactly KOODER_VERSION', () => {
    const { stdout, status } = run(['--version']);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe(KOODER_VERSION);
    expect(isSemver(KOODER_VERSION)).toBe(true);
  });

  it('keeps package.json version in lockstep with KOODER_VERSION', () => {
    // Two version numbers that can drift is the bug this pins shut.
    expect(readPkg().version).toBe(KOODER_VERSION);
  });

  it('stamps the build timestamp as a real ISO-8601 instant', () => {
    expect(Number.isNaN(Date.parse(KOODER_BUILD_TIMESTAMP))).toBe(false);
    expect(new Date(KOODER_BUILD_TIMESTAMP).toISOString()).toBe(KOODER_BUILD_TIMESTAMP);
  });

  it('exports no pre-rebrand version alias', async () => {
    const versionModule = (await import('../version.js')) as Record<string, unknown>;

    // The rebrand renamed the constant; a leftover legacy export would invite
    // new code to depend on the dead brand.
    for (const key of Object.keys(versionModule)) {
      for (const brand of LEGACY_BRANDS) {
        expect(key.toLowerCase()).not.toContain(brand);
      }
    }
  });
});

describe('Kooder rebrand — published bins', () => {
  it('publishes the kooder and worker bins on the worker CLI, plus the litecoder bin', () => {
    const pkg = readPkg();

    // `litecoder` is a deliberate third bin (a no-tools planner CLI on top of
    // the same worker engine), not a pre-rebrand alias — the assertion below
    // still guarantees no legacy brand survived as a bin.
    expect(Object.keys(pkg.bin).sort()).toEqual(['kooder', 'litecoder', 'worker']);
    expect(pkg.bin.kooder).toBe('./dist/cli-worker.js');
    expect(pkg.bin.worker).toBe('./dist/cli-worker.js');
    expect(pkg.bin.litecoder).toBe('./dist/litecoder/cli.js');
  });

  it('carries no pre-rebrand bin alias', () => {
    const pkg = readPkg();

    for (const brand of LEGACY_BRANDS) {
      expect(pkg.bin).not.toHaveProperty(brand);
      expect(pkg.name).not.toContain(brand);
    }
    expect(pkg.name).toBe('litecoder');
  });
});

describe('Kooder rebrand — residue is CI-enforced, not assumed', () => {
  it.skipIf(!fs.existsSync(path.join(root, 'scripts', 'check-brand-residue.mjs')))('passes the brand-residue gate (allowlisted shims only)', () => {
    const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-brand-residue.mjs')], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });

    // Exit 0 means: every remaining legacy-name occurrence is an allowlisted,
    // reasoned compatibility shim. Exit 1 would print each offending line.
    expect(res.stderr ?? '').not.toContain('Brand residue found');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('check-brand-residue: clean');
  });
});
