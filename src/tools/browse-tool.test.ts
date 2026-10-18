import { describe, it, expect } from 'vitest';
import { checkRequestAllowed, parseStepSpec, splitSelectorValue, runBrowse } from './browse-tool.js';

describe('checkRequestAllowed', () => {
  it('allows http(s) and localhost', () => {
    expect(checkRequestAllowed('https://example.com/x')).toBeNull();
    expect(checkRequestAllowed('http://localhost:3000')).toBeNull();
    expect(checkRequestAllowed('http://127.0.0.1:8080')).toBeNull();
    expect(checkRequestAllowed('http://[::1]:8080')).toBeNull();
  });
  it('blocks file:, chrome:, ftp: and data: navigation', () => {
    expect(checkRequestAllowed('file:///etc/passwd', { navigation: true })).toMatch(/not allowed/);
    expect(checkRequestAllowed('chrome://settings', { navigation: true })).toMatch(/not allowed/);
    expect(checkRequestAllowed('ftp://x/y', { navigation: true })).toMatch(/not allowed/);
    expect(checkRequestAllowed('data:text/html,hi', { navigation: true })).toMatch(/not allowed/);
    expect(checkRequestAllowed('not a url')).toMatch(/invalid/);
  });
  it('does not mistake domain names for IPv6 literals', () => {
    expect(checkRequestAllowed('https://fd-cdn.example.com')).toBeNull();
    expect(checkRequestAllowed('https://fe80.example.org')).toBeNull();
    expect(checkRequestAllowed('https://fc.example.com')).toBeNull();
  });
  it('allows data: sub-resources but still blocks file: sub-resources', () => {
    expect(checkRequestAllowed('data:image/png;base64,AAAA')).toBeNull();
    expect(checkRequestAllowed('file:///etc/passwd')).toMatch(/not allowed/);
  });
  it('blocks private ranges and cloud metadata unless opted in', () => {
    for (const u of ['http://169.254.169.254/latest', 'http://10.0.0.5', 'http://192.168.1.1', 'http://172.16.0.1', 'http://metadata.google.internal', 'http://[fd00::1]', 'http://[::ffff:10.0.0.1]']) {
      expect(checkRequestAllowed(u)).toBeTruthy();
    }
    process.env.XCODER_BROWSE_ALLOW_PRIVATE = '1';
    expect(checkRequestAllowed('http://192.168.1.1')).toBeNull();
    delete process.env.XCODER_BROWSE_ALLOW_PRIVATE;
  });
});

describe('parseStepSpec', () => {
  it('parses common steps', () => {
    expect(parseStepSpec('https://example.com')).toEqual({ op: 'goto', url: 'https://example.com' });
    expect(parseStepSpec('goto:http://localhost:3000/a')).toEqual({ op: 'goto', url: 'http://localhost:3000/a' });
    expect(parseStepSpec('click:#login')).toEqual({ op: 'click', selector: '#login' });
    expect(parseStepSpec('fill:#q=hello world')).toEqual({ op: 'fill', selector: '#q', value: 'hello world' });
    expect(parseStepSpec('fill:input[name=q]=hi')).toEqual({ op: 'fill', selector: 'input[name=q]', value: 'hi' });
    expect(parseStepSpec('press:Enter')).toEqual({ op: 'press', key: 'Enter' });
    expect(parseStepSpec('press:#q=Enter')).toEqual({ op: 'press', selector: '#q', key: 'Enter' });
    expect(parseStepSpec('wait:1500')).toEqual({ op: 'wait', ms: 1500 });
    expect(parseStepSpec('wait:.result')).toEqual({ op: 'wait_for', selector: '.result' });
    expect(parseStepSpec('text')).toEqual({ op: 'text' });
    expect(parseStepSpec('text:h1')).toEqual({ op: 'text', selector: 'h1' });
    expect(parseStepSpec('attr:a.next@href')).toEqual({ op: 'attr', selector: 'a.next', name: 'href' });
    expect(parseStepSpec('screenshot:out/home.png')).toEqual({ op: 'screenshot', path: 'out/home.png' });
    expect(parseStepSpec('expect_text:h1=Welcome')).toEqual({ op: 'expect_text', selector: 'h1', text: 'Welcome' });
    expect(parseStepSpec('scroll:bottom')).toEqual({ op: 'scroll', to: 'bottom' });
  });
  it('rejects malformed steps', () => {
    expect(() => parseStepSpec('fill:#q')).toThrow(/SELECTOR=VALUE/);
    expect(() => parseStepSpec('click')).toThrow(/needs/);
    expect(() => parseStepSpec('dance:now')).toThrow(/unknown step/);
  });
  it('splitSelectorValue ignores = inside brackets and quotes', () => {
    expect(splitSelectorValue('a[href="x=y"]=go')).toEqual(['a[href="x=y"]', 'go']);
    expect(splitSelectorValue('#id')).toEqual(['#id', undefined]);
  });
});

describe('runBrowse guards', () => {
  it('fails cleanly with no steps', async () => {
    const r = await runBrowse(process.cwd(), { steps: [] });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no steps/);
  });
});
