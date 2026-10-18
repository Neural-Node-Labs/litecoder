/**
 * Unit tests for the Auto-Update Module — src/updater/index.ts
 * Part of the desktop installer pipeline (§3.5 of design).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdate, downloadAndApplyUpdate } from './index.js';
import type { UpdaterOptions, UpdateCheckResult } from './index.js';

// ---------------------------------------------------------------------------
// Mock helpers for fetch
// ---------------------------------------------------------------------------

function mockFetchResponse(status: number, body: unknown, headers?: Record<string, string>) {
  const responseHeaders = new Headers(headers);
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    headers: responseHeaders,
  });
}

// ---------------------------------------------------------------------------
// Type contract for globalThis.fetch replacement in tests
// ---------------------------------------------------------------------------

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

// ---------------------------------------------------------------------------
// checkForUpdate tests
// ---------------------------------------------------------------------------

describe('checkForUpdate', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: FetchMock;
  
  const mockOptions: UpdaterOptions = {
    currentVersion: '0.1.0',
    repo: 'xcoder/xcoder-sdlc-cli',
  };

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- Happy path: update available ----

  it('returns updateAvailable=true when a newer version with matching asset exists', async () => {
    const release = {
      tag_name: 'v0.2.0',
      body: 'Release notes here',
      assets: [
        {
          name: `xcoder-0.2.0-${getExpectedPlatformSuffix()}.${getExpectedExtension()}`,
          browser_download_url: 'https://github.com/xcoder/xcoder-sdlc-cli/releases/download/v0.2.0/xcoder-setup.exe',
          size: 50_000_000,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(mockOptions);

    expect(result).toEqual({
      updateAvailable: true,
      latestVersion: '0.2.0',
      downloadUrl: 'https://github.com/xcoder/xcoder-sdlc-cli/releases/download/v0.2.0/xcoder-setup.exe',
      releaseNotes: 'Release notes here',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/xcoder/xcoder-sdlc-cli/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      }),
    );
  });

  // ---- No update: same version ----

  it('returns updateAvailable=false when current version equals latest', async () => {
    const release = {
      tag_name: 'v0.1.0',
      body: '',
      assets: [],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(mockOptions);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.1.0');
    expect(result.downloadUrl).toBeNull();
    expect(result.releaseNotes).toBeNull();
  });

  // ---- No update: tag without v-prefix ----

  it('returns updateAvailable=false when current version equals latest (no v-prefix)', async () => {
    const release = {
      tag_name: '0.1.0',
      body: '',
      assets: [],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(mockOptions);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.1.0');
  });

  // ---- No update: current > latest ----

  it('returns updateAvailable=false when current version is newer than latest', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.2.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v0.1.0',
      body: '',
      assets: [],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.1.0');
  });

  // ---- Happy path: major version bump ----

  it('detects major version bump as update available', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.1.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v1.0.0',
      body: 'Major release',
      assets: [
        {
          name: `xcoder-1.0.0-${getExpectedPlatformSuffix()}.${getExpectedExtension()}`,
          browser_download_url: 'https://example.com/xcoder-1.0.0.exe',
          size: 50_000_000,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('1.0.0');
  });

  // ---- Happy path: minor version bump ----

  it('detects minor version bump as update available', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.1.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v0.2.0',
      body: 'New features',
      assets: [
        {
          name: `xcoder-0.2.0-${getExpectedPlatformSuffix()}.${getExpectedExtension()}`,
          browser_download_url: 'https://example.com/xcoder-0.2.0.exe',
          size: 50_000_000,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);

    expect(result.updateAvailable).toBe(true);
  });

  // ---- Happy path: patch version bump ----

  it('detects patch version bump as update available', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.1.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v0.1.1',
      body: 'Bug fixes',
      assets: [
        {
          name: `xcoder-0.1.1-${getExpectedPlatformSuffix()}.${getExpectedExtension()}`,
          browser_download_url: 'https://example.com/xcoder-0.1.1.exe',
          size: 50_000_000,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('0.1.1');
  });

  // ---- No matching asset ----

  it('returns updateAvailable=false with releaseNotes when no matching asset found', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.1.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v0.2.0',
      body: 'Some release notes',
      assets: [
        {
          name: 'xcoder-0.2.0-some-other-platform.deb',
          browser_download_url: 'https://example.com/wrong',
          size: 100,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.2.0');
    expect(result.downloadUrl).toBeNull();
    expect(result.releaseNotes).toBe('Some release notes');
  });

  // ---- Empty assets ----

  it('returns updateAvailable=false when assets array is empty', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.1.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v0.2.0',
      body: 'Pre-release without binaries',
      assets: [],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.2.0');
    expect(result.releaseNotes).toBe('Pre-release without binaries');
  });

  // ---- GitHub API error ----

  it('returns defaultValue when GitHub API returns non-200', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(404, { message: 'Not Found' }));

    const result = await checkForUpdate(mockOptions);

    expect(result).toEqual({
      updateAvailable: false,
      latestVersion: null,
      downloadUrl: null,
      releaseNotes: null,
    });
  });

  it('returns defaultValue when GitHub API returns 500', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(500, { error: 'Internal Server Error' }));

    const result = await checkForUpdate(mockOptions);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });

  it('returns defaultValue when GitHub API returns 403 (rate limited)', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(403, { message: 'API rate limit exceeded' }));

    const result = await checkForUpdate(mockOptions);

    expect(result.updateAvailable).toBe(false);
  });

  // ---- Network errors ----

  it('returns defaultValue when fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await checkForUpdate(mockOptions);

    expect(result).toEqual({
      updateAvailable: false,
      latestVersion: null,
      downloadUrl: null,
      releaseNotes: null,
    });
  });

  it('returns defaultValue when fetch times out', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

    const result = await checkForUpdate(mockOptions);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });

  // ---- Malformed response ----

  it('returns defaultValue when release JSON is not a valid GitHubRelease', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { unexpected: 'shape' }));

    // Should not throw, should return defaultValue
    await expect(checkForUpdate(mockOptions)).resolves.toEqual({
      updateAvailable: false,
      latestVersion: null,
      downloadUrl: null,
      releaseNotes: null,
    });
  });

  // ---- JSON parse failure ----

  it('returns defaultValue when response.json() throws', async () => {
    const badResponse = new Response('<html>Not JSON</html>', { status: 200, statusText: 'OK' });
    mockFetch.mockResolvedValueOnce(badResponse);

    const result = await checkForUpdate(mockOptions);

    expect(result.updateAvailable).toBe(false);
  });

  // ---- Custom repo ----

  it('uses the provided repo to construct the GitHub API URL', async () => {
    const opts: UpdaterOptions = {
      currentVersion: '1.0.0',
      repo: 'my-org/my-tool',
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { tag_name: 'v1.0.0', body: '', assets: [] }));

    await checkForUpdate(opts);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/my-org/my-tool/releases/latest',
      expect.anything(),
    );
  });

  // ---- User-Agent header ----

  it('includes currentVersion in the User-Agent header', async () => {
    const opts: UpdaterOptions = { currentVersion: '2.5.3', repo: 'xcoder/xcoder-sdlc-cli' };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { tag_name: 'v2.5.3', body: '', assets: [] }));

    await checkForUpdate(opts);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'xcoder-updater/2.5.3',
        }),
      }),
    );
  });

  // ---- Semver edge cases ----

  it('correctly compares multi-digit version numbers', async () => {
    const opts: UpdaterOptions = { currentVersion: '0.9.0', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v0.10.0',
      body: 'Double-digit minor',
      assets: [
        {
          name: `xcoder-0.10.0-${getExpectedPlatformSuffix()}.${getExpectedExtension()}`,
          browser_download_url: 'https://example.com/xcoder-0.10.0.exe',
          size: 10,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('0.10.0');
  });

  it('correctly compares single-component version with multi-component', async () => {
    const opts: UpdaterOptions = { currentVersion: '1', repo: 'xcoder/xcoder-sdlc-cli' };
    const release = {
      tag_name: 'v1.1',
      body: 'Simple versions',
      assets: [
        {
          name: `xcoder-1.1-${getExpectedPlatformSuffix()}.${getExpectedExtension()}`,
          browser_download_url: 'https://example.com/xcoder-1.1.exe',
          size: 10,
        },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate(opts);
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('1.1');
  });
});

// ---------------------------------------------------------------------------
// Asset pattern matching — platform-specific behaviour
// ---------------------------------------------------------------------------

describe('checkForUpdate — platform asset matching', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('finds asset with correct platform suffix', async () => {
    const suffix = getExpectedPlatformSuffix();
    const ext = getExpectedExtension();
    const release = {
      tag_name: 'v0.3.0',
      body: '',
      assets: [
        { name: `xcoder-0.3.0-linux-x64.deb`, browser_download_url: 'https://x.com/linux', size: 1 },
        { name: `xcoder-0.3.0-${suffix}.${ext}`, browser_download_url: 'https://x.com/match', size: 2 },
        { name: `xcoder-0.3.0-macos-arm64.dmg`, browser_download_url: 'https://x.com/mac', size: 3 },
      ],
    };

    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate({ currentVersion: '0.2.0', repo: 'xcoder/xcoder-sdlc-cli' });

    expect(result.updateAvailable).toBe(true);
    expect(result.downloadUrl).toBe('https://x.com/match');
  });

  it('does NOT match assets with wrong platform suffix', async () => {
    const release = {
      tag_name: 'v0.3.0',
      body: '',
      assets: [
        { name: 'xcoder-0.3.0-linux-x64.deb', browser_download_url: 'https://x.com/linux', size: 1 },
      ],
    };

    // On a non-linux machine, this should not match
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, release));

    const result = await checkForUpdate({ currentVersion: '0.2.0', repo: 'xcoder/xcoder-sdlc-cli' });

    if (process.platform === 'linux') {
      // On linux the asset will match
      expect(result.updateAvailable).toBe(true);
    } else {
      expect(result.updateAvailable).toBe(false);
      expect(result.latestVersion).toBe('0.3.0');
      expect(result.releaseNotes).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// downloadAndApplyUpdate tests (limited — spawns real processes)
// ---------------------------------------------------------------------------

describe('downloadAndApplyUpdate', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when download fails with non-200', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(404, 'Not Found'));

    await expect(
      downloadAndApplyUpdate('https://example.com/bad.exe', 'https://example.com/bad.exe.sha256'),
    ).rejects.toThrow('Download failed: 404');
  });

  it('throws when download response is not ok (500)', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(500, 'Error'));

    await expect(
      downloadAndApplyUpdate('https://example.com/error.exe', 'https://example.com/error.exe.sha256'),
    ).rejects.toThrow('Download failed: 500');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the expected platform suffix the same way the module does.
 * Mirrors getPlatformSuffix() from src/updater/index.ts
 */
function getExpectedPlatformSuffix(): string {
  const pmap: Record<string, string> = { win32: 'win', darwin: 'macos', linux: 'linux' };
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${pmap[process.platform] || process.platform}-${arch}`;
}

/**
 * Compute the expected extension the same way the module does.
 * Mirrors getPlatformExtension() from src/updater/index.ts
 */
function getExpectedExtension(): string {
  switch (process.platform) {
    case 'win32': return 'exe';
    case 'darwin': return 'dmg';
    case 'linux': return 'deb';
    default: return 'tar.gz';
  }
}
