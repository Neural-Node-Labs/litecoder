import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseConfigArg,
  saveUserConfig,
  readUserConfig,
  extractConfigArg,
  formatUserConfig,
  maskSecret,
} from './user-config.js';

let dir: string;
let prev: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcoder-cfg-'));
  prev = process.env.KOODER_CONFIG_FILE;
  process.env.KOODER_CONFIG_FILE = path.join(dir, '.kooder', 'config.json');
});
afterEach(() => {
  if (prev === undefined) delete process.env.KOODER_CONFIG_FILE;
  else process.env.KOODER_CONFIG_FILE = prev;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseConfigArg', () => {
  it('parses provider and key', () => {
    const p = parseConfigArg('provider=deepseek,key=356887421');
    expect(p.errors).toEqual([]);
    expect(p.fields).toEqual({ provider: 'deepseek', key: '356887421' });
  });
  it('accepts aliases, base_url, model and env vars', () => {
    const p = parseConfigArg('provider=openai, model=gpt-x, base_url=https://api.example.com/v1, XCODER_LESSON_LEARNED=1, env.FOO_BAR=baz');
    expect(p.errors).toEqual([]);
    expect(p.fields).toMatchObject({ provider: 'openai-compatible', model: 'gpt-x', base_url: 'https://api.example.com/v1' });
    expect(p.env).toEqual({ XCODER_LESSON_LEARNED: '1', FOO_BAR: 'baz' });
  });
  it('rejects bad provider, bad url, unknown names and blocked env vars', () => {
    expect(parseConfigArg('provider=nope').errors).toHaveLength(1);
    expect(parseConfigArg('base_url=ftp://x').errors).toHaveLength(1);
    expect(parseConfigArg('colour=red').errors).toHaveLength(1);
    expect(parseConfigArg('NODE_OPTIONS=--require=x').errors[0]).toMatch(/cannot be set/);
    expect(parseConfigArg('PATH=/evil').errors).toHaveLength(1);
    expect(parseConfigArg('HTTPS_PROXY=http://evil').errors).toHaveLength(1);
  });
});

describe('saveUserConfig', () => {
  it('creates config.json, merges and removes keys', () => {
    saveUserConfig(parseConfigArg('provider=deepseek,key=abcdefghij'));
    saveUserConfig(parseConfigArg('model=deepseek-chat,MY_VAR=1'));
    let cfg = readUserConfig();
    expect(cfg).toEqual({ provider: 'deepseek', key: 'abcdefghij', model: 'deepseek-chat', env: { MY_VAR: '1' } });
    saveUserConfig(parseConfigArg('key=,MY_VAR='));
    cfg = readUserConfig();
    expect(cfg.key).toBeUndefined();
    expect(cfg.env).toBeUndefined();
    expect(cfg.provider).toBe('deepseek');
  });
  it('writes owner-only permissions on POSIX', () => {
    saveUserConfig(parseConfigArg('key=abcdefghij'));
    if (process.platform !== 'win32') {
      expect(fs.statSync(process.env.KOODER_CONFIG_FILE!).mode & 0o777).toBe(0o600);
    }
  });
  it('refuses to overwrite a corrupt file', () => {
    fs.mkdirSync(path.dirname(process.env.KOODER_CONFIG_FILE!), { recursive: true });
    fs.writeFileSync(process.env.KOODER_CONFIG_FILE!, '{not json');
    expect(() => saveUserConfig(parseConfigArg('key=abcdefghij'))).toThrow();
    expect(fs.readFileSync(process.env.KOODER_CONFIG_FILE!, 'utf8')).toBe('{not json');
  });
});

describe('formatUserConfig / maskSecret', () => {
  it('never prints the full key', () => {
    expect(maskSecret('356887421')).toBe('****7421');
    const out = formatUserConfig({ provider: 'deepseek', key: '356887421', env: { MY_TOKEN: 'supersecretvalue' } }).join('\n');
    expect(out).not.toContain('356887421');
    expect(out).not.toContain('supersecretvalue');
  });
});

describe('extractConfigArg', () => {
  const base = ['node', 'xcoder'];
  it('handles both forms anywhere on the line and strips them', () => {
    expect(extractConfigArg([...base, '--config', 'a=b'])).toEqual({ value: 'a=b', argv: base });
    expect(extractConfigArg([...base, 'status', '--config=a=b'])).toEqual({ value: 'a=b', argv: [...base, 'status'] });
    expect(extractConfigArg([...base, 'status']).value).toBeUndefined();
  });
  it('errors when the value is missing', () => {
    expect(extractConfigArg([...base, '--config']).error).toBeTruthy();
    expect(extractConfigArg([...base, '--config', '--other']).error).toBeTruthy();
  });
});
