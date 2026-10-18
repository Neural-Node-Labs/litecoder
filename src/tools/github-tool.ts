import { execFile } from "node:child_process";
import { resolveInWorkspaceSafe } from "./workspace-path.js";
import path from "node:path";
import { resolveCredential, redact } from "./credential.js";

function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr });
    });
  });
}

function resolveInWorkspace(root: string, relDir: string | undefined): string {
  return resolveInWorkspaceSafe(root, relDir, (m) => new Error(m));
}

/** Embeds a token into an https remote URL only for the duration of one git invocation. */
function tokenHosts(): Set<string> {
  const extra = (process.env.KOODER_GIT_TOKEN_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return new Set(["github.com", ...extra]);
}

/**
 * The model supplies the URL, so the token must only ever be embedded for an
 * allowlisted git host (github.com, plus KOODER_GIT_TOKEN_HOSTS for GHE). Anything
 * else would hand the token to an arbitrary server.
 */
export function withEmbeddedToken(url: string, token: string): string {
  if (!url.startsWith("https://")) return url; // ssh remotes use the user's own key, nothing to embed
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`invalid remote URL "${url}"`);
  }
  if (!tokenHosts().has(host)) {
    throw new Error(`refusing to send a token to "${host}" (allowed: ${[...tokenHosts()].join(", ")}; extend with KOODER_GIT_TOKEN_HOSTS)`);
  }
  return url.replace("https://", `https://x-access-token:${token}@`);
}

/** Reject anything git could parse as an option or a transport helper (ext::, file:, ...). */
function validateRemoteUrl(url: string): string | null {
  if (url.startsWith("-")) return "remote URL must not start with '-'";
  if (/^(https:\/\/|ssh:\/\/|git@[\w.-]+:)/.test(url)) return null;
  return "only https://, ssh:// and git@host:path remotes are allowed";
}

function validateRefName(name: string): string | null {
  return name.startsWith("-") || /[\s\0]/.test(name) ? `invalid ref "${name}"` : null;
}

// ---------------------------------------------------------------------------
// github_create_repo
// ---------------------------------------------------------------------------

export interface GithubCreateRepoInput {
  name: string;
  description?: string;
  private?: boolean;
  org?: string;
  credentialRef?: string; // defaults to GITHUB_TOKEN — never a raw token
}

export interface GithubCreateRepoResult {
  ok: boolean;
  detail: string;
  cloneUrl?: string;
  htmlUrl?: string;
}

export async function githubCreateRepo(input: GithubCreateRepoInput): Promise<GithubCreateRepoResult> {
  const ref = input.credentialRef ?? "GITHUB_TOKEN";
  let token: string;
  try {
    token = resolveCredential(ref, { allowGithub: true });
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }

  const endpoint = input.org
    ? `https://api.github.com/orgs/${input.org}/repos`
    : `https://api.github.com/user/repos`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "xcoder-sdlc-cli",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        private: input.private ?? true,
      }),
    });
    const body = (await res.json()) as { clone_url?: string; html_url?: string; message?: string };
    if (!res.ok) {
      return { ok: false, detail: redact(`GitHub API ${res.status}: ${body.message ?? "unknown error"}`, ref) };
    }
    return {
      ok: true,
      detail: `created ${body.html_url}`,
      cloneUrl: body.clone_url,
      htmlUrl: body.html_url,
    };
  } catch (e) {
    return { ok: false, detail: redact(`request failed: ${(e as Error).message}`, ref) };
  }
}

// ---------------------------------------------------------------------------
// github_clone
// ---------------------------------------------------------------------------

export interface GithubCloneInput {
  url: string;
  dir: string; // relative to workspace root
  credentialRef?: string; // only needed for a private repo
}

export async function githubClone(root: string, input: GithubCloneInput): Promise<{ ok: boolean; detail: string }> {
  let full: string;
  try {
    full = resolveInWorkspace(root, input.dir);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }

  const badUrl = validateRemoteUrl(input.url);
  if (badUrl) return { ok: false, detail: badUrl };

  let cloneUrl = input.url;
  const ref = input.credentialRef;
  if (ref) {
    try {
      cloneUrl = withEmbeddedToken(input.url, resolveCredential(ref, { allowGithub: true }));
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  const result = await run("git", ["-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", "clone", "--", cloneUrl, full], path.dirname(full));
  return {
    ok: result.ok,
    detail: redact(result.ok ? `cloned into ${input.dir}` : result.stderr.trim(), ref),
  };
}

// ---------------------------------------------------------------------------
// github_commit
// ---------------------------------------------------------------------------

export interface GithubCommitInput {
  cwd?: string; // relative to workspace root, defaults to root
  message: string;
  addAll?: boolean;
}

export async function githubCommit(root: string, input: GithubCommitInput): Promise<{ ok: boolean; detail: string }> {
  let full: string;
  try {
    full = resolveInWorkspace(root, input.cwd);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }

  if (input.addAll ?? true) {
    const add = await run("git", ["add", "-A"], full);
    if (!add.ok) return { ok: false, detail: `git add failed: ${add.stderr.trim()}` };
  }
  const commit = await run("git", ["commit", "-m", input.message], full);
  return { ok: commit.ok, detail: commit.ok ? commit.stdout.trim() : commit.stderr.trim() };
}

// ---------------------------------------------------------------------------
// github_push
// ---------------------------------------------------------------------------

export interface GithubPushInput {
  cwd?: string;
  remote?: string;
  branch?: string;
  credentialRef?: string; // defaults to GITHUB_TOKEN
}

/**
 * The token is embedded into the remote URL only for the duration of this
 * one push, then the original URL is restored — it is never left sitting
 * in `.git/config`, and it's redacted out of any error text before this
 * function returns.
 */
export async function githubPush(root: string, input: GithubPushInput): Promise<{ ok: boolean; detail: string }> {
  let full: string;
  try {
    full = resolveInWorkspace(root, input.cwd);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }

  const remote = input.remote ?? "origin";
  const ref = input.credentialRef ?? "GITHUB_TOKEN";

  const getUrl = await run("git", ["remote", "get-url", remote], full);
  if (!getUrl.ok) return { ok: false, detail: `could not resolve remote "${remote}": ${getUrl.stderr.trim()}` };
  const originalUrl = getUrl.stdout.trim();

  let token: string;
  try {
    token = resolveCredential(ref, { allowGithub: true });
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  let authedUrl: string;
  try {
    authedUrl = withEmbeddedToken(originalUrl, token);
  } catch (e) {
    return { ok: false, detail: redact((e as Error).message, ref) };
  }
  const badRef = (input.branch && validateRefName(input.branch)) || validateRefName(remote);
  if (badRef) return { ok: false, detail: badRef };

  try {
    await run("git", ["remote", "set-url", remote, authedUrl], full);
    const args = ["push", remote];
    if (input.branch) args.push(input.branch);
    const push = await run("git", args, full);
    return { ok: push.ok, detail: redact(push.ok ? push.stdout.trim() || "pushed" : push.stderr.trim(), ref) };
  } finally {
    await run("git", ["remote", "set-url", remote, originalUrl], full); // always restore, even on failure
  }
}
