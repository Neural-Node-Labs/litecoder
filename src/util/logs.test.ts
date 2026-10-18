import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendLlm,
  appendThink,
  appendSys,
  appendToken,
  appendScore,
  taskLogDir,
} from './logs.js';

// ── Helpers ──

function tmpRoot(): string {
  return path.join(os.tmpdir(), `xcoder-logs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function readLog(root: string, taskId: string, name: string): Promise<string> {
  const dir = taskLogDir(root, taskId);
  const filePath = path.join(dir, name);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

// ── appendLlm stopReason behavior ──

describe('appendLlm', () => {
  let root: string;
  const taskId = 'task-test-001';
  const subtaskId = 'sub-test-001';

  beforeEach(async () => {
    root = tmpRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('includes [stop=<reason>] in the llm.log line when stopReason is provided', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: '{"thought":"test"}',
      stopReason: 'max_tokens',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).toContain('[stop=max_tokens]');
    expect(log).toContain('[response]');
    expect(log).toContain('{"thought":"test"}');
  });

  it('omits [stop=...] segment when stopReason is null', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: '{"thought":"test"}',
      stopReason: null,
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).not.toContain('[stop=');
    expect(log).toContain('[response]');
  });

  it('omits [stop=...] segment when stopReason is undefined', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: '{"thought":"test"}',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).not.toContain('[stop=');
    expect(log).toContain('[response]');
  });

  it('handles stopReason "length" (DeepSeek synonym)', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: 'truncated',
      stopReason: 'length',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).toContain('[stop=length]');
  });

  it('handles stopReason "end_turn"', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: 'done',
      stopReason: 'end_turn',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).toContain('[stop=end_turn]');
  });

  it('handles stopReason "stop_sequence"', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: 'stopped',
      stopReason: 'stop_sequence',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).toContain('[stop=stop_sequence]');
  });

  it('escapes newlines in content', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: 'line1\nline2\nline3',
      stopReason: 'end_turn',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).toContain('line1\\nline2\\nline3');
    // Should NOT contain raw newlines in the logged line
    const lines = log.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it('handles request direction (no stopReason typically)', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'request',
      content: 'Begin.',
    });

    const log = await readLog(root, taskId, 'llm.log');
    expect(log).toContain('[request]');
    expect(log).toContain('Begin.');
  });

  it('includes timestamp, subtaskId, direction, and stopReason in correct order', async () => {
    await appendLlm(root, taskId, subtaskId, {
      direction: 'response',
      content: 'ok',
      stopReason: 'max_tokens',
    });

    const log = await readLog(root, taskId, 'llm.log');
    // Pattern: [ts] [subtaskId] [stop=reason] [direction] content
    expect(log).toMatch(/^\[.*\] \[sub-test-001\] \[stop=max_tokens\] \[response\] ok$/m);
  });

  it('appends multiple entries correctly', async () => {
    await appendLlm(root, taskId, 'sub-a', { direction: 'request', content: 'q1' });
    await appendLlm(root, taskId, 'sub-a', { direction: 'response', content: 'r1', stopReason: 'end_turn' });
    await appendLlm(root, taskId, 'sub-b', { direction: 'request', content: 'q2' });
    await appendLlm(root, taskId, 'sub-b', { direction: 'response', content: 'r2', stopReason: 'max_tokens' });

    const log = await readLog(root, taskId, 'llm.log');
    const lines = log.trim().split('\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('[sub-a]');
    expect(lines[0]).toContain('[request]');
    expect(lines[1]).toContain('[sub-a]');
    expect(lines[1]).toContain('[stop=end_turn]');
    expect(lines[2]).toContain('[sub-b]');
    expect(lines[2]).toContain('[request]');
    expect(lines[3]).toContain('[sub-b]');
    expect(lines[3]).toContain('[stop=max_tokens]');
  });
});

// ── appendThink uses think.log ──

describe('appendThink', () => {
  let root: string;
  const taskId = 'task-think-001';

  beforeEach(async () => {
    root = tmpRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes to think.log (not thining.log)', async () => {
    await appendThink(root, taskId, 'sub-x', 'Thought: test');

    const log = await readLog(root, taskId, 'think.log');
    expect(log).toContain('Thought: test');
    expect(log).toContain('[sub-x]');

    // Verify no "thining.log" typo
    const dir = taskLogDir(root, taskId);
    const files = await fs.readdir(dir);
    expect(files).toContain('think.log');
    expect(files).not.toContain('thining.log');
  });
});

// ── appendSys ──

describe('appendSys', () => {
  let root: string;
  const taskId = 'task-sys-001';

  beforeEach(async () => {
    root = tmpRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes to sys.log', async () => {
    await appendSys(root, taskId, 'error: something broke');

    const log = await readLog(root, taskId, 'sys.log');
    expect(log).toContain('error: something broke');
  });
});

// ── appendToken ──

describe('appendToken', () => {
  let root: string;
  const taskId = 'task-tok-001';

  beforeEach(async () => {
    root = tmpRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes token usage to token.log', async () => {
    await appendToken(root, taskId, 'sub-t', {
      inputTokens: 100,
      outputTokens: 50,
      cumulativeInput: 500,
      cumulativeOutput: 250,
    });

    const log = await readLog(root, taskId, 'token.log');
    expect(log).toContain('in=100 out=50');
    expect(log).toContain('task-cumulative in=500 out=250');
  });
});

// ── appendScore ──

describe('appendScore', () => {
  let root: string;
  const taskId = 'task-score-001';

  beforeEach(async () => {
    root = tmpRoot();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes score to score.log', async () => {
    await appendScore(root, taskId, 'sub-s', {
      score: 85,
      breakdown: ['item 1', 'item 2'],
    });

    const log = await readLog(root, taskId, 'score.log');
    expect(log).toContain('score=85/100');
    expect(log).toContain('item 1');
    expect(log).toContain('item 2');
  });
});

// ── taskLogDir ──

describe('taskLogDir', () => {
  it('returns the correct log directory path', () => {
    const dir = taskLogDir('/workspace', 'task-123');
    expect(dir).toContain('.kooder');
    expect(dir).toContain('logs');
    expect(dir).toContain('task-123');
  });
});
