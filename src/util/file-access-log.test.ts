import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractFileAccess, logFileAccess, redactSecrets } from './file-access-log.js';
import { taskLogDir } from './logs.js';

function tmpRoot(): string {
  return path.join(os.tmpdir(), `xcoder-files-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

describe('extractFileAccess', () => {
  it('maps file tools to read/write targets', () => {
    expect(extractFileAccess('read_file', { path: 'a.ts' })).toEqual([{ op: 'read', target: 'a.ts', kind: 'path' }]);
    expect(extractFileAccess('write_file', { path: 'b.ts' })[0].op).toBe('write');
    expect(extractFileAccess('read_multiple_files', { files: [{ path: 'x' }, { path: 'y' }] }).map((a) => a.target)).toEqual(['x', 'y']);
    expect(extractFileAccess('sed_tool', { glob: 'src/**/*.ts' })[0]).toMatchObject({ op: 'write', kind: 'glob' });
    expect(extractFileAccess('grep', { pattern: 'x' })[0].target).toBe('**/*');
  });

  it('records the command for run_command and schedule', () => {
    expect(extractFileAccess('run_command', { command: 'npm test' })).toEqual([{ op: 'exec', target: 'npm test', kind: 'cmd' }]);
    expect(extractFileAccess('schedule', { operation: 'create_once', command: 'ls' })[0].op).toBe('exec');
    expect(extractFileAccess('schedule', { operation: 'list' })).toEqual([]);
  });

  it('never throws on junk input and ignores network-only tools', () => {
    expect(extractFileAccess('read_file', null)).toEqual([]);
    expect(extractFileAccess('api_test', { url: 'http://x' })).toEqual([]);
  });
});

describe('redactSecrets', () => {
  it('masks tokens, URL passwords and auth headers', () => {
    const out = redactSecrets('curl -H "Authorization: Bearer abc123" https://u:pw@h.com GITHUB_TOKEN=ghp_' + 'a'.repeat(30));
    expect(out).not.toContain('abc123');
    expect(out).not.toContain(':pw@');
    expect(out).not.toContain('ghp_aaaa');
  });
});

describe('files.log', () => {
  it('writes one line per touched file/command', async () => {
    const root = tmpRoot();
    await logFileAccess(root, 'read_file', { path: 'src/a.ts' }, true, { taskId: 't1', subtaskId: 's1' });
    await logFileAccess(root, 'run_command', { command: 'echo hi\nls' }, false, { taskId: 't1', subtaskId: 's1' });
    const text = await fs.readFile(path.join(taskLogDir(root, 't1'), 'files.log'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/\[s1\] tool=read_file op=read ok=true path=src\/a\.ts$/);
    expect(lines[1]).toMatch(/tool=run_command op=exec ok=false cmd=echo hi\\nls$/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rolls over to files.1.log past 1MB', async () => {
    const root = tmpRoot();
    const big = 'x'.repeat(4000); // command is capped at 2000 chars in the log
    for (let n = 0; n < 700; n++) {
      await logFileAccess(root, 'run_command', { command: big }, true, { taskId: 't2', subtaskId: 's' });
    }
    const dir = taskLogDir(root, 't2');
    const names = await fs.readdir(dir);
    expect(names).toContain('files.log');
    expect(names).toContain('files.1.log');
    expect((await fs.stat(path.join(dir, 'files.log'))).size).toBeLessThanOrEqual(1_000_000);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('uses the "session" log when no task context is given', async () => {
    const root = tmpRoot();
    await logFileAccess(root, 'read_file', { path: 'a' }, true);
    const text = await fs.readFile(path.join(taskLogDir(root, 'session'), 'files.log'), 'utf8');
    expect(text).toContain('tool=read_file');
    await fs.rm(root, { recursive: true, force: true });
  });
});
