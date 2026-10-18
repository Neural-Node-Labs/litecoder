// xcoder:version 3 | xcoder:task task-54c54e | xcoder:updated 2026-08-04T15:49:06.333Z | xcoder:subtask test-st-c628ce
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
  const mod = await import('./tool-error-logger.js');
  return mod;
}

// ── Tests ──

describe('ToolErrorLogger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExistsSync.mockReset();
    mockAppendFile.mockReset();
    mockAppendFile.mockResolvedValue(undefined);
  });

  // ── isToolErrorLoggingEnabled ──

  describe('isToolErrorLoggingEnabled', () => {
    it('returns false by default (before enableToolErrorLogging is called)', async () => {
      const { isToolErrorLoggingEnabled } = await freshImport();
      expect(isToolErrorLoggingEnabled()).toBe(false);
    });

    it('returns true after enableToolErrorLogging is called', async () => {
      const { enableToolErrorLogging, isToolErrorLoggingEnabled } =
        await freshImport();
      enableToolErrorLogging();
      expect(isToolErrorLoggingEnabled()).toBe(true);
    });
  });

  // ── enableToolErrorLogging ──

  describe('enableToolErrorLogging', () => {
    it('defaults logPath to <cwd>/tools.log when no argument is provided', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging();

      mockExistsSync.mockReturnValue(true);

      logToolError({
        ts: new Date().toISOString(),
        tool: 'run_command',
        error: 'command failed',
        ok: false,
        taskId: 't1',
        subtaskId: 'st1',
        input: '{"command":"npm test"}',
        iteration: 3,
      });

      const expectedPath = path.join(process.cwd(), 'tools.log');
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
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      const customPath = '/tmp/custom-tools.log';
      enableToolErrorLogging(customPath);

      mockExistsSync.mockReturnValue(true);

      logToolError({
        ts: new Date().toISOString(),
        tool: 'grep',
        error: 'no matches',
        ok: false,
        input: '{}',
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
      const { enableToolErrorLogging } = await freshImport();
      enableToolErrorLogging();
      expect(mockLogDim).toHaveBeenCalledWith(
        expect.stringContaining('tool_error diagnostic log:')
      );
    });

    it('suppresses log.dim announcement when opts.silent is true', async () => {
      mockLogDim.mockClear();
      const { enableToolErrorLogging } = await freshImport();
      enableToolErrorLogging(undefined, { silent: true });
      expect(mockLogDim).not.toHaveBeenCalled();
    });

    it('still emits log.dim announcement when opts.silent is false', async () => {
      mockLogDim.mockClear();
      const { enableToolErrorLogging } = await freshImport();
      enableToolErrorLogging(undefined, { silent: false });
      expect(mockLogDim).toHaveBeenCalledWith(
        expect.stringContaining('tool_error diagnostic log:')
      );
    });

    it('suppresses announcement with custom path and silent: true', async () => {
      mockLogDim.mockClear();
      const { enableToolErrorLogging } = await freshImport();
      enableToolErrorLogging('/custom/tools.log', { silent: true });
      expect(mockLogDim).not.toHaveBeenCalled();
    });
  });

  // ── logToolError ──

  describe('logToolError', () => {
    it('does nothing when logging is not enabled', async () => {
      const { logToolError } = await freshImport();
      logToolError({
        ts: new Date().toISOString(),
        tool: 'run_command',
        error: 'command failed',
        ok: false,
        taskId: 't1',
      });

      // Give a tick for any microtasks
      await new Promise((r) => setTimeout(r, 10));
      expect(mockAppendFile).not.toHaveBeenCalled();
    });

    it('writes an ndjson line when enabled', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      const entry = {
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: 'command exited with code 1',
        ok: false as const,
        taskId: 'task-001',
        subtaskId: 'architect-1',
        input: '{"command":"npm test","timeoutMs":60000}',
        iteration: 3,
      };

      logToolError(entry);

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const callArgs = mockAppendFile.mock.calls[0];
      expect(callArgs[0]).toBe(path.resolve('/tmp/test-tools.log'));
      expect(callArgs[2]).toBe('utf-8');

      const writtenLine = callArgs[1] as string;
      expect(writtenLine).toContain('\n');
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed).toEqual(entry);
    });

    it('writes a header block before the first entry when the file does not exist', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(false);

      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'grep',
        error: 'no matches',
        ok: false,
        taskId: 't1',
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(2);
      });

      // First call: header
      const headerCall = mockAppendFile.mock.calls[0];
      expect(headerCall[1]).toContain('# Xcoder SDLC tool_error diagnostic log');
      expect(headerCall[1]).toContain('# Fields: ts, tool, error, ok, taskId, subtaskId, input, iteration');
      // Second call: the ndjson data line
      const dataCall = mockAppendFile.mock.calls[1];
      expect(dataCall[1]).toContain('"error":"no matches"');
    });

    it('writes header only once across multiple logToolError calls', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(false);

      const entry = {
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'grep',
        error: 'error1',
        ok: false as const,
        taskId: 't1',
      };

      logToolError(entry);
      logToolError({ ...entry, error: 'error2' });

      await vi.waitFor(() => {
        // header + 2 data lines = 3 calls
        expect(mockAppendFile).toHaveBeenCalledTimes(3);
      });

      // First call is still the header
      expect(mockAppendFile.mock.calls[0][1]).toContain('# Xcoder SDLC tool_error diagnostic log');
      // Second and third are data
      expect(mockAppendFile.mock.calls[1][1]).toContain('"error":"error1"');
      expect(mockAppendFile.mock.calls[2][1]).toContain('"error":"error2"');
    });

    it('does not write header if file already exists', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'grep',
        error: 'no matches',
        ok: false,
        taskId: 't1',
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(1);
      });

      // The single call should be data, not a header
      const callArgs = mockAppendFile.mock.calls[0];
      expect(callArgs[1]).toContain('"error":"no matches"');
    });

    it('truncates input field at 2000 characters with ...[truncated] suffix', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      const longInput = 'x'.repeat(2500);
      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: 'timeout',
        ok: false,
        input: longInput,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.input).toContain('...[truncated]');
      expect(parsed.input.length).toBe(2000 + '...[truncated]'.length);
      expect(parsed.input).toBe('x'.repeat(2000) + '...[truncated]');
    });

    it('does not truncate input at exactly 2000 characters', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      const exactInput = 'y'.repeat(2000);
      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: 'timeout',
        ok: false,
        input: exactInput,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.input).toBe(exactInput);
      expect(parsed.input).not.toContain('[truncated]');
    });

    it('does not truncate input under 2000 characters', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      const shortInput = '{"command":"npm test"}';
      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: 'command failed',
        ok: false,
        input: shortInput,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.input).toBe(shortInput);
    });

    it('silently swallows fs errors and does not throw', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);
      mockAppendFile.mockRejectedValue(new Error('disk full'));

      // This must not throw
      let threw = false;
      try {
        logToolError({
          ts: '2025-01-15T10:30:00.000Z',
          tool: 'run_command',
          error: 'command failed',
          ok: false,
        });
        // Wait for the promise chain to resolve
        await vi.waitFor(() => {
          expect(mockAppendFile).toHaveBeenCalled();
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
    });

    it('serialises concurrent writes through the promise-chain mutex', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      const callOrder: number[] = [];

      mockAppendFile.mockImplementation(
        (_path: string, line: string, _enc: string) => {
          const parsed = JSON.parse(line.trim());
          callOrder.push(Number(parsed.error));
          return Promise.resolve();
        },
      );

      // Fire 3 calls synchronously
      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'grep',
        error: '1',
        ok: false,
      });
      logToolError({
        ts: '2025-01-15T10:30:00.001Z',
        tool: 'grep',
        error: '2',
        ok: false,
      });
      logToolError({
        ts: '2025-01-15T10:30:00.002Z',
        tool: 'grep',
        error: '3',
        ok: false,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(3);
      });

      // Order must be preserved: 1 -> 2 -> 3
      expect(callOrder).toEqual([1, 2, 3]);
    });

    it('allows omitting optional fields (taskId, subtaskId, input, iteration)', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: 'command failed',
        ok: false as const,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.ts).toBe('2025-01-15T10:30:00.000Z');
      expect(parsed.tool).toBe('run_command');
      expect(parsed.error).toBe('command failed');
      expect(parsed.ok).toBe(false);
      // Optional fields should be undefined or absent
      expect(parsed.taskId).toBeUndefined();
      expect(parsed.subtaskId).toBeUndefined();
      expect(parsed.input).toBeUndefined();
      expect(parsed.iteration).toBeUndefined();
    });

    it('only writes one header when concurrent first writes race', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(false);

      // Defer resolution so both calls queue up before the first write completes
      let resolveAppend: (() => void) | undefined;
      const appendDeferred = new Promise<void>((resolve) => {
        resolveAppend = resolve;
      });

      let callCount = 0;
      mockAppendFile.mockImplementation(
        (_path: string, _line: string, _enc: string) => {
          callCount++;
          if (callCount === 1) {
            // First call (header) — defer
            return appendDeferred;
          }
          return Promise.resolve();
        },
      );

      // Fire two error logs synchronously
      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'grep',
        error: 'error1',
        ok: false,
      });
      logToolError({
        ts: '2025-01-15T10:30:00.001Z',
        tool: 'read_file',
        error: 'error2',
        ok: false,
      });

      // Now let the first write resolve
      resolveAppend!();

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalledTimes(3);
      });

      // Count headers: only one call should contain the header
      const headers = mockAppendFile.mock.calls.filter((call: any[]) =>
        (call[1] as string).includes('# Xcoder SDLC tool_error diagnostic log'),
      );
      expect(headers.length).toBe(1);

      // Count data lines: 2
      const dataLines = mockAppendFile.mock.calls.filter((call: any[]) =>
        (call[1] as string).includes('"error"'),
      );
      expect(dataLines.length).toBe(2);
    });

    it('handles undefined input gracefully', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: 'timeout',
        ok: false,
        input: undefined as unknown as string,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      // Should not throw — if undefined input doesn't exist on the object,
      // it won't be stringified; if it does as undefined, JSON.stringify drops it
      expect(() => JSON.parse(writtenLine.trim())).not.toThrow();
      const parsed = JSON.parse(writtenLine.trim());
      expect(parsed.ok).toBe(false);
    });

    it('handles error field with special characters (newlines, quotes)', async () => {
      const { enableToolErrorLogging, logToolError } =
        await freshImport();
      enableToolErrorLogging('/tmp/test-tools.log');

      mockExistsSync.mockReturnValue(true);

      const specialError = 'error with "quotes" and \n newlines \t tabs';
      logToolError({
        ts: '2025-01-15T10:30:00.000Z',
        tool: 'run_command',
        error: specialError,
        ok: false,
      });

      await vi.waitFor(() => {
        expect(mockAppendFile).toHaveBeenCalled();
      });

      const writtenLine = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());
      // JSON round-trip should preserve the error string
      expect(parsed.error).toBe(specialError);
    });
  });
});
