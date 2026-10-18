/** Auto-Update Module — §3.5 of design-desktop-installer.md */

import { createWriteStream, createReadStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export interface UpdaterOptions {
  currentVersion: string;
  repo: string;
  checkIntervalMs?: number;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
}

interface GitHubRelease {
  tag_name: string;
  body: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

function getPlatformExtension(): string {
  switch (process.platform) {
    case "win32": return "exe";
    case "darwin": return "dmg";
    case "linux": return "deb";
    default: return "tar.gz";
  }
}

function getPlatformSuffix(): string {
  const pmap: Record<string, string> = { win32: "win", darwin: "macos", linux: "linux" };
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${pmap[process.platform] || process.platform}-${arch}`;
}

function semverCompare(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

async function sha256stream(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as string | Buffer);
  }
  return hash.digest("hex");
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

export async function checkForUpdate(opts: UpdaterOptions): Promise<UpdateCheckResult> {
  const defaultValue: UpdateCheckResult = {
    updateAvailable: false, latestVersion: null, downloadUrl: null, releaseNotes: null,
  };

  try {
    const url = `https://api.github.com/repos/${opts.repo}/releases/latest`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `kooder-updater/${opts.currentVersion}`,
      },
    });

    if (!response.ok) return defaultValue;

    const release = (await response.json()) as GitHubRelease;
    const latestVersion = release.tag_name.replace(/^v/, "");

    if (semverCompare(latestVersion, opts.currentVersion) <= 0) {
      return { ...defaultValue, latestVersion };
    }

    const platformSuffix = getPlatformSuffix();
    const ext = getPlatformExtension();
    const assetPattern = `xcoder-${latestVersion}-${platformSuffix}.${ext}`;
    const asset = release.assets.find((a) => a.name === assetPattern);

    if (!asset) {
      return { ...defaultValue, latestVersion, releaseNotes: release.body };
    }

    return {
      updateAvailable: true,
      latestVersion,
      downloadUrl: asset.browser_download_url,
      releaseNotes: release.body,
    };
  } catch {
    return defaultValue;
  }
}

export async function downloadAndApplyUpdate(
  downloadUrl: string,
  sha256Url: string,
): Promise<void> {
  for (const u of [downloadUrl, sha256Url]) {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") throw new Error(`Refusing non-https update URL: ${u}`);
  }
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kooder-update-")); // private, unpredictable dir

  const ext = getPlatformExtension();
  const installerPath = path.join(tmpDir, `xcoder-update.${ext}`);

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    const fileStream = createWriteStream(installerPath);
    await pipeline(response.body!, fileStream);

    // Fail CLOSED: an installer that runs elevated must have a verified checksum.
    const shaResponse = await fetch(sha256Url);
    if (!shaResponse.ok) {
      throw new Error(`Checksum unavailable (${shaResponse.status}) — refusing to install an unverified update`);
    }
    const expectedHash = (await shaResponse.text()).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
      throw new Error("Checksum file is malformed — refusing to install");
    }
    const actualHash = await sha256stream(installerPath);
    if (expectedHash !== actualHash) {
      throw new Error("SHA256 mismatch");
    }

    if (process.platform === "win32") {
      await runProcess(installerPath, ["/S"]);
    } else if (process.platform === "darwin") {
      console.log(`Update downloaded to ${installerPath}`);
      console.log(`Please open the DMG and copy Xcoder SDLC.app to /Applications.`);
    } else {
      await runProcess("sudo", ["dpkg", "-i", installerPath]);
    }
  } finally {
    await unlink(installerPath).catch(() => {});
  }
}
