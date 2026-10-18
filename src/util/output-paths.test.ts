// xcoder:version 3 | xcoder:task task-b190f1 | xcoder:updated 2026-08-03T10:47:34.303Z | xcoder:subtask test-st-a22194
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getOutputPaths, resetOutputPaths } from './output-paths.js';
import type { OutputPathsConfig } from './output-paths.js';

describe('OutputPaths', () => {
  let tmpRoot: string;

  beforeEach(() => {
    resetOutputPaths();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xcoder-op-test-'));
  });

  afterEach(() => {
    resetOutputPaths();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('getOutputPaths', () => {
    it('returns default reportsDir as .reports relative to cwd', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.reportsDir).toBe(path.join(tmpRoot, '.reports'));
    });

    it('returns default tmpDir as .tmp relative to cwd', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.tmpDir).toBe(path.join(tmpRoot, '.tmp'));
    });

    it('allows custom reportsDir', () => {
      const opts = getOutputPaths({ cwd: tmpRoot, reportsDir: 'custom-reports' });
      expect(opts.reportsDir).toBe(path.join(tmpRoot, 'custom-reports'));
    });

    it('allows custom tmpDir', () => {
      const opts = getOutputPaths({ cwd: tmpRoot, tmpDir: 'custom-tmp' });
      expect(opts.tmpDir).toBe(path.join(tmpRoot, 'custom-tmp'));
    });

    it('is a singleton — second call returns same instance', () => {
      const a = getOutputPaths({ cwd: tmpRoot });
      const b = getOutputPaths({ cwd: '/some/other/path' });
      expect(a).toBe(b);
      expect(a.reportsDir).toBe(b.reportsDir);
    });

    it('resetOutputPaths allows fresh instance creation', () => {
      const a = getOutputPaths({ cwd: tmpRoot });
      resetOutputPaths();
      const b = getOutputPaths({
        cwd: path.join(tmpRoot, 'nested'),
      });
      expect(a).not.toBe(b);
      expect(b.reportsDir).toBe(
        path.join(tmpRoot, 'nested', '.reports'),
      );
    });
  });

  describe('sprintReportsDir', () => {
    it('returns .reports/sprint', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.sprintReportsDir()).toBe(
        path.join(tmpRoot, '.reports', 'sprint'),
      );
    });
  });

  describe('aiChatReportsDir', () => {
    it('returns .reports/ai-chat', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.aiChatReportsDir()).toBe(
        path.join(tmpRoot, '.reports', 'ai-chat'),
      );
    });
  });

  describe('benchReportsDir', () => {
    it('returns .reports/bench', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.benchReportsDir()).toBe(
        path.join(tmpRoot, '.reports', 'bench'),
      );
    });
  });

  describe('regressionDir', () => {
    it('returns .reports/regression', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.regressionDir()).toBe(
        path.join(tmpRoot, '.reports', 'regression'),
      );
    });
  });

  describe('instanceSwarmDir', () => {
    it('returns .reports/instance-swarms/<id>', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.instanceSwarmDir('swarm-abc')).toBe(
        path.join(tmpRoot, '.reports', 'instance-swarms', 'swarm-abc'),
      );
    });
  });

  describe('atomicDir', () => {
    it('returns .tmp/atomic', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.atomicDir()).toBe(
        path.join(tmpRoot, '.tmp', 'atomic'),
      );
    });
  });

  describe('protocolErrorLogPath', () => {
    it('returns .reports/protocol_error.log', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      expect(opts.protocolErrorLogPath()).toBe(
        path.join(tmpRoot, '.reports', 'protocol_error.log'),
      );
    });
  });

  describe('benchReportPath', () => {
    it('returns .reports/bench/report-<ts>.json with provided timestamp', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      const result = opts.benchReportPath('2026-01-01T00-00-00-000Z');
      expect(result).toBe(
        path.join(tmpRoot, '.reports', 'bench', 'report-2026-01-01T00-00-00-000Z.json'),
      );
    });

    it('returns a timestamped filename when ts is omitted (not empty)', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      const result = opts.benchReportPath();
      expect(result).toContain(path.join('.reports', 'bench', 'report-'));
      expect(result).toMatch(/\.json$/);
      expect(result.startsWith(tmpRoot)).toBe(true);
    });

    it('respects the reportsDir of the instance', () => {
      const opts = getOutputPaths({ cwd: tmpRoot, reportsDir: 'custom-out' });
      const result = opts.benchReportPath('ts');
      expect(result).toBe(
        path.join(tmpRoot, 'custom-out', 'bench', 'report-ts.json'),
      );
    });
  });

  describe('ensureGitignore', () => {
    it('creates .gitignore if it does not exist', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      opts.ensureGitignore();

      const giPath = path.join(tmpRoot, '.gitignore');
      expect(fs.existsSync(giPath)).toBe(true);

      const content = fs.readFileSync(giPath, 'utf-8');
      expect(content).toContain('.reports/');
      expect(content).toContain('.tmp/');
    });

    it('appends to existing .gitignore without duplicating entries', () => {
      const giPath = path.join(tmpRoot, '.gitignore');
      fs.writeFileSync(giPath, '.DS_Store\n', 'utf-8');

      const opts = getOutputPaths({ cwd: tmpRoot });
      opts.ensureGitignore();

      const content = fs.readFileSync(giPath, 'utf-8');
      expect(content).toContain('.DS_Store');
      // Should contain the xcoder entries only once
      const firstIdx = content.indexOf('.reports/');
      const lastIdx = content.lastIndexOf('.reports/');
      expect(firstIdx).toBe(lastIdx);
      expect(firstIdx).not.toBe(-1);
    });

    it('is idempotent — calling twice does not duplicate', () => {
      const opts = getOutputPaths({ cwd: tmpRoot });
      opts.ensureGitignore();
      opts.ensureGitignore();

      const giPath = path.join(tmpRoot, '.gitignore');
      const content = fs.readFileSync(giPath, 'utf-8');
      const count = (content.match(/\.reports\//g) || []).length;
      expect(count).toBe(1);
    });

    it('does not throw when fs ops fail', () => {
      // Use a path that's impossible to write to — but since we're in a
      // tmp directory we own, simulate by making the cwd a file instead.
      const filePath = path.join(tmpRoot, 'not-a-dir');
      fs.writeFileSync(filePath, 'blah', 'utf-8');

      // ensureGitignore tries to append to a .gitignore whose parent is
      // a file — that'll throw, and it should swallow it.
      const opts = getOutputPaths({ cwd: filePath });
      expect(() => opts.ensureGitignore()).not.toThrow();
    });
  });
});
