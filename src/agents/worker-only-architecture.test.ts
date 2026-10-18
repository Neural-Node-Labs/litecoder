// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:35:18.633Z | xcoder:subtask code-st-9de79a
// Tests for the intended post-cleanup Kooder architecture.
//
// Oracle for these assertions is the task goal, not the current code:
//   * the only agent that remains is worker-agent; every other agent removed
//   * clean unused code
//   * rebrand to Kooder
//
// These are structural/intent tests: they pin the SHAPE the refactor was
// supposed to leave behind, so a regression that re-introduces a second agent
// tree, the pre-rebrand state directory, or the old brand name fails loudly.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KOODER_VERSION } from '../version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const srcDir = path.join(root, 'src');

function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function readPkg(): {
  name: string;
  version: string;
  description: string;
  bin: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

describe('worker-only agent architecture', () => {
  it('keeps exactly one agent: the worker agent', () => {
    // The worker agent is the sole surviving agent tree.
    expect(exists('src/worker-agent/worker-orchestrator.ts')).toBe(true);

    // The SDLC orchestrator tree and the specialised agent swarms were
    // removed by the cleanup and must not come back.
    expect(exists('src/sdlc-agent')).toBe(false);
    expect(exists('src/instance-swarm')).toBe(false);
    expect(exists('src/backlog')).toBe(false);
  });

  it('does not regrow the deleted role-specific agents', () => {
    const agentsDir = path.join(srcDir, 'agents');
    if (!fs.existsSync(agentsDir)) return;

    const removedAgents = [
      'genesis-agent.ts',
      'samurai-agent.ts',
      'ai-chat-debate.ts',
      'ai-chat-report-writer.ts',
    ];
    for (const name of removedAgents) {
      expect(fs.existsSync(path.join(agentsDir, name))).toBe(false);
    }
  });

  it('keeps the worker CLI as the single executable entrypoint', () => {
    expect(exists('src/cli-worker.ts')).toBe(true);
    // The SDLC CLI entrypoints were deleted along with the SDLC stages.
    expect(exists('src/sdlc-cli.ts')).toBe(false);
    expect(exists('src/cli/swarm.ts')).toBe(false);
  });
});

describe('Kooder rebrand', () => {
  it('publishes the package as litecoder (Kooder engine inside)', () => {
    const pkg = readPkg();

    // Deliberate rename: the public npm package is `litecoder`; Kooder is the engine.
    expect(pkg.name).toBe('litecoder');
    expect(pkg.name).not.toContain('koober');
    expect(pkg.name).not.toContain('xcoder');
    expect(pkg.description).toContain('Kooder');
    expect(pkg.description).not.toContain('Koober');
    expect(pkg.description).not.toContain('Xcoder');
  });

  it('ships kooder and worker bins pointing at the worker CLI entrypoint', () => {
    const pkg = readPkg();

    expect(pkg.bin.kooder).toBe('./dist/cli-worker.js');
    expect(pkg.bin.worker).toBe('./dist/cli-worker.js');
    // `litecoder` is a deliberate third bin: a thin, no-tools planner CLI on
    // top of the same worker engine. It is NOT a pre-rebrand alias, so the
    // intent this assertion protects (no `koober` bin surviving) is unchanged
    // — see .xcoder/backlog/litecoder-design.md §0.
    expect(pkg.bin.litecoder).toBe('./dist/litecoder/cli.js');
    expect(Object.keys(pkg.bin).sort()).toEqual(['kooder', 'litecoder', 'worker']);
    expect(pkg.bin).not.toHaveProperty('koober');
  });

  it('declares one version: package.json agrees with KOODER_VERSION', () => {
    const pkg = readPkg();

    expect(pkg.version).toBe(KOODER_VERSION);
  });

  it('defaults the state directory to .kooder, keeping .koober/.xcoder as read-fallbacks', () => {
    const src = fs.readFileSync(path.join(srcDir, 'util', 'kooder-paths.ts'), 'utf8');

    expect(src).toContain('DEFAULT_KOODER_DIR = ".kooder"');
    // Both legacy tiers survive only so existing installs keep reading their
    // state; neither must ever be the default again.
    expect(src).toContain('LEGACY_KOOBER_DIR');
    expect(src).toContain('LEGACY_XCODER_DIR');
  });

  it('has exactly one configurable state-directory factory', () => {
    // Scoped to files that actually export a state `create*Paths` factory, so
    // output-paths.ts (.reports/.tmp, exporting getOutputPaths) neither
    // satisfies nor breaks this by accident.
    const utilDir = path.join(srcDir, 'util');
    const stateFactories = fs
      .readdirSync(utilDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) =>
        /export function create\w*Paths\s*\(/.test(
          fs.readFileSync(path.join(utilDir, f), 'utf8'),
        ),
      );

    expect(stateFactories).toEqual(['kooder-paths.ts']);
    // The pre-rebrand factory must not survive alongside it.
    expect(fs.existsSync(path.join(utilDir, 'koober-paths.ts'))).toBe(false);
    expect(fs.existsSync(path.join(utilDir, 'koober-paths.test.ts'))).toBe(false);
  });
});
