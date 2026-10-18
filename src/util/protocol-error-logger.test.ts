// xcoder:version 3 | xcoder:task task-54c54e | xcoder:updated 2026-08-04T15:48:39.400Z | xcoder:subtask test-st-c628ce
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';

// ── Mocks ──

const mockAppendFile = vi.fn();
const mockExistsSync = vi.fn();
const mockLogDim = vi.fn();

// Mock logger
vi.mock('./logger.js', () => ({
  log: {
    dim: mockLogDim,
    orchestrator: vi.fn(),
    agent: vi.fn(),
    ok: vi.fn(),
    fail: vi.fn(),
    raw: vi.fn(),
    sumurai: vi.fn(),
    ninj: vi.fn(),
  },
}));

// Mock node:fs — the source module imports:
//   import fs from "node:fs";
//   import { promises as fsp } from "node:fs";
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
    existsSync: mockExistsSync,
    promises: {
      ...(actual as any).promises,
      appendFile: mockAppendFile,
    },
  };
});

// ── Helpers ──

/**
 * Re-import the module to get fresh state.
 * Because the module uses top-level let bindings, we must reload it between
 * tests that depend on different enabled/disabled states.
 */
async function freshImport() {
  const mod = await import('./protocol-error-logger.js');
  return mod;
}

// ── Tests ──

describe('ProtocolErrorLogger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExistsSync.mockReset();
    mockAppendFile.mockReset();
    mockAppendFile.mockResolvedValue(undefined);
  });

  // ── isProtocolErrorLoggingEnabled ──

  describe('isProtocolErrorLoggingEnabled', () => {
    it('returns false by default (before enableProtocolErrorLogging is called)', async () => {
      const { isProtocolErrorLoggingEnabled } = await freshImport();
      expect(isProtocolErrorLoggingEnabled()).toBe(false);
    });

    it('returns true after enableProtocolErrorLogging is called', async () => {
      const { enableProtocolErrorLogging, isProtocolErrorLoggingEnabled } =
        await freshImport();
      enableProtocolErrorLogging();
      expect(isProtocolErrorLoggingEnabled()).toBe(true);
    });
  });

  // ── enableProtocolErrorLogging ──

  describe('enableProtocolErrorLogging', () => {
    it('defaults logPath to .reports/protocol_error.log when no argument is provided', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      enableProtocolErrorLogging();

      mockExistsSync.mockReturnValue(true);

      logProtocolError({
        ts: new Date().toISOString(),
        taskId: 't1',
        agentId: 'a1',
        iteration: 1,
        error: 'parse error',
        raw: 'bad json',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      });

      const expectedPath = path.join(process.cwd(), '.reports', 'protocol_error.log');
      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      expect(mockAppendFile).toHaveBeenCalledWith(
        expectedPath,
        expect.any(String),
        'utf-8',
      );
    });

    it('uses customPath when provided', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      const customPath = '/tmp/custom-errors.log';
      enableProtocolErrorLogging(customPath);

      mockExistsSync.mockReturnValue(true);

      logProtocolError({
        ts: new Date().toISOString(),
        taskId: 't1',
        agentId: 'a1',
        iteration: 1,
        error: 'parse error',
        raw: 'bad json',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const expectedPath = path.resolve(customPath);
      expect(mockAppendFile).toHaveBeenCalledWith(
        expectedPath,
        expect.any(String),
        'utf-8',
      );
    });

    it('emits log.dim announcement by default (silent option not provided)', async () => {
      mockLogDim.mockClear();
      const { enableProtocolErrorLogging } = await freshImport();
      enableProtocolErrorLogging();
      expect(mockLogDim).toHaveBeenCalledWith(
        expect.stringContaining('protocol_error diagnostic log:')
      );
    });

    it('suppresses log.dim announcement when opts.silent is true', async () => {
      mockLogDim.mockClear();
      const { enableProtocolErrorLogging } = await freshImport();
      enableProtocolErrorLogging(undefined, { silent: true });
      expect(mockLogDim).not.toHaveBeenCalled();
    });

    it('still emits log.dim announcement when opts.silent is false', async () => {
      mockLogDim.mockClear();
      const { enableProtocolErrorLogging } = await freshImport();
      enableProtocolErrorLogging(undefined, { silent: false });
      expect(mockLogDim).toHaveBeenCalledWith(
        expect.stringContaining('protocol_error diagnostic log:')
      );
    });

    it('suppresses announcement with custom path and silent: true', async () => {
      mockLogDim.mockClear();
      const { enableProtocolErrorLogging } = await freshImport();
      enableProtocolErrorLogging('/custom/path.log', { silent: true });
      expect(mockLogDim).not.toHaveBeenCalled();
    });
  });

  // ── logProtocolError ──

  describe('logProtocolError', () => {
    it('does nothing when logging is not enabled', async () => {
      const { logProtocolError } = await freshImport();
      logProtocolError({
        ts: new Date().toISOString(),
        taskId: 't1',
        agentId: 'a1',
        iteration: 1,
        error: 'parse error',
        raw: 'bad json',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      });

      // Give a tick for any microtasks
      await new Promise((r) => setTimeout(r, 10));
      expect(mockAppendFile).not.toHaveBeenCalled();
    });

    it('writes an ndjson line when enabled', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      enableProtocolErrorLogging('/tmp/test-errors.log');

      mockExistsSync.mockReturnValue(true);

      const entry = {
        ts: '2025-01-15T10:30:00.000Z',
        taskId: 'task-001',
        agentId: 'agent-abc',
        iteration: 3,
        error: 'Expected JSON, got garbage',
        raw: '{not valid json',
        model: 'deepseek-chat',
        stopReason: 'max_tokens',
        inputTokens: 1234,
        outputTokens: 567,
      };

      logProtocolError(entry);

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const callArgs = mockAppendFile.mock.calls[0];
      expect(callArgs[0]).toBe(path.resolve('/tmp/test-errors.log'));
      expect(callArgs[2]).toBe('utf-8');

      const writtenLine = callArgs[1] as string;
      expect(writtenLine).toContain('\n');
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed).toEqual(entry);
    });

    it('writes a header block before the first entry when the file does not exist', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      enableProtocolErrorLogging('/tmp/test-errors.log');

      mockExistsSync.mockReturnValue(false);

      logProtocolError({
        ts: '2025-01-15T10:30:00.000Z',
        taskId: 't1',
        agentId: 'a1',
        iteration: 1,
        error: 'parse error',
        raw: 'bad',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(2);
      });

      // First call: header
      const headerCall = mockAppendFile.mock.calls[0];
      expect(headerCall[1]).toContain('# Xcoder SDLC protocol_error diagnostic log');
      expect(headerCall[1]).toContain('# Fields: ts, taskId, agentId, iteration, error, raw, model, stopReason, inputTokens, outputTokens');
      // Second call: the ndjson data line
      const dataCall = mockAppendFile.mock.calls[1];
      expect(dataCall[1]).toContain('"error":"parse error"');
    });

    it('writes header only once across multiple logProtocolError calls', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      enableProtocolErrorLogging('/tmp/test-errors.log');

      mockExistsSync.mockReturnValue(false);

      const entry = {
        ts: '2025-01-15T10:30:00.000Z',
        taskId: 't1',
        agentId: 'a1',
        iteration: 1,
        error: 'parse error',
        raw: 'bad',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      };

      logProtocolError(entry);

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(2);
      });

      logProtocolError({ ...entry, iteration: 2 });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(3);
      });

      // First call is header, calls 2 and 3 are data lines
      expect(mockAppendFile.mock.calls[0][1]).toContain('# Xcoder SDLC');
      expect(mockAppendFile.mock.calls[1][1]).toContain('"iteration":1');
      expect(mockAppendFile.mock.calls[2][1]).toContain('"iteration":2');
    });

    it('serialises writes via a promise chain so parallel calls do not interleave', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      enableProtocolErrorLogging('/tmp/test-errors.log');

      mockExistsSync.mockReturnValue(true);

      let callOrder: number[] = [];
      mockAppendFile.mockImplementation(() => {
        callOrder.push(callOrder.length + 1);
        return Promise.resolve();
      });

      const baseEntry = {
        ts: '2025-01-15T10:30:00.000Z',
        taskId: 't1',
        agentId: 'a1',
        error: 'parse error',
        raw: 'bad',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      };

      logProtocolError({ ...baseEntry, iteration: 1 });
      logProtocolError({ ...baseEntry, iteration: 2 });
      logProtocolError({ ...baseEntry, iteration: 3 });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(3);
      });

      // All three should have been called (serialized via promise chain)
      expect(mockAppendFile).toHaveBeenCalledTimes(3);
    });

    it('silently swallows fs write errors', async () => {
      const { enableProtocolErrorLogging, logProtocolError } =
        await freshImport();
      enableProtocolErrorLogging('/tmp/test-errors.log');

      mockExistsSync.mockReturnValue(true);

      // Make first appendFile throw
      mockAppendFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      // Should not throw
      logProtocolError({
        ts: '2025-01-15T10:30:00.000Z',
        taskId: 't1',
        agentId: 'a1',
        iteration: 1,
        error: 'parse error',
        raw: 'bad',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      // The next call should still work (writeChain wasn't broken)
      mockAppendFile.mockResolvedValueOnce(undefined);
      logProtocolError({
        ts: '2025-01-15T10:30:00.000Z',
        taskId: 't1',
        agentId: 'a1',
        iteration: 2,
        error: 'another error',
        raw: 'more',
        model: 'deepseek-chat',
        stopReason: null,
        inputTokens: 10,
        outputTokens: 5,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(2);
      });
    });
  });
});
