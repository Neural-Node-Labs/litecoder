// xcoder:version 2 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:36:14.875Z | xcoder:subtask code-st-1a0810
// User-level runtime config: <home>/.kooder/config.json
//
//   kooder run --config "provider=deepseek,key=…,model=deepseek-chat"
//
// Holds the LLM provider/key/model/base_url plus any extra environment
// variables (the old `.env` settings). Precedence at startup:
//   real shell environment  >  ~/.kooder/config.json  >  .env files
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readKooderEnv } from "./env.js";

export type UserProvider = "deepseek" | "anthropic" | "openai-compatible";

export interface UserConfig {
  provider?: UserProvider;
  key?: string;
  model?: string;
  base_url?: string;
  env?: Record<string, string>;
}

/** Variables that were really exported in the shell — config.json never overrides these. */
const shellKeys = new Set(Object.keys(process.env));

export const PROVIDER_KEY_ENV: Record<UserProvider, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "OPENAI_API_KEY",
};

const PROVIDER_ALIASES: Record<string, UserProvider> = {
  deepseek: "deepseek",
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai-compatible",
  "openai-compatible": "openai-compatible",
};

/** Env names that could redirect execution or traffic — never settable from config. */
export const BLOCKED_ENV = /^(PATH|PATHEXT|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_.*|DYLD_.*|HOME|USERPROFILE|SHELL|COMSPEC|PYTHONPATH|BUN_.*|NPM_CONFIG_.*|(HTTPS?|ALL|NO)_PROXY)$/i;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)/i;

export function userConfigPath(): string {
  return readKooderEnv("KOODER_CONFIG_FILE") ?? path.join(os.homedir(), ".kooder", "config.json");
}

export function maskSecret(value: string): string {
  return value.length > 8 ? `****${value.slice(-4)}` : "****";
}

let active: UserConfig | null = null;

/** Clears the memoised config — for tests and long-lived processes that re-read config. */
export function resetUserConfigCache(): void {
  active = null;
}

/** Read config.json. Missing file → {}. Corrupt file → throws (never silently overwritten). */
export function readUserConfig(): UserConfig {
  const file = userConfigPath();
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} must contain a JSON object`);
  return parsed as UserConfig;
}

export function getActiveUserConfig(): UserConfig {
  if (active) return active;
  try {
    active = readUserConfig();
  } catch (err) {
    process.stderr.write(`[kooder] ignoring unreadable ${userConfigPath()}: ${(err as Error).message}\n`);
    active = {};
  }
  return active;
}

/** Push config.json into process.env (without overriding variables exported in the shell). */
export function applyUserConfig(): UserConfig {
  active = null;
  const cfg = getActiveUserConfig();
  const set = (name: string, value: string | undefined): void => {
    if (value === undefined || shellKeys.has(name)) return;
    process.env[name] = value;
  };
  for (const [name, value] of Object.entries(cfg.env ?? {})) {
    if (!BLOCKED_ENV.test(name)) set(name, String(value));
  }
  if (cfg.key) {
    set("KOODER_API_KEY", cfg.key);
    set(PROVIDER_KEY_ENV[cfg.provider ?? "deepseek"], cfg.key);
  }
  if (cfg.model) set("KOODER_MODEL", cfg.model);
  return cfg;
}

// ── --config "k=v,k=v" parsing ─────────────────────────────────────────────

export interface ParsedConfigArg {
  /** Top-level fields to set ("" = remove). */
  fields: Partial<Record<"provider" | "key" | "model" | "base_url", string>>;
  /** Env vars to set ("" = remove). */
  env: Record<string, string>;
  errors: string[];
}

export function parseConfigArg(arg: string): ParsedConfigArg {
  const out: ParsedConfigArg = { fields: {}, env: {}, errors: [] };
  const tokens = arg.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_.-]*\s*=)/);
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq < 1) {
      if (token.trim()) out.errors.push(`expected name=value, got "${token.trim()}"`);
      continue;
    }
    const name = token.slice(0, eq).trim();
    const value = token.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    const lower = name.toLowerCase();
    if (lower === "provider") {
      if (value === "") out.fields.provider = "";
      else if (PROVIDER_ALIASES[value.toLowerCase()]) out.fields.provider = PROVIDER_ALIASES[value.toLowerCase()];
      else out.errors.push(`unknown provider "${value}" (use deepseek, anthropic or openai-compatible)`);
    } else if (lower === "key" || lower === "api_key" || lower === "apikey") {
      out.fields.key = value;
    } else if (lower === "model") {
      out.fields.model = value;
    } else if (lower === "base_url" || lower === "baseurl" || lower === "url") {
      if (value !== "" && !/^https?:\/\/[^\s]+$/i.test(value)) out.errors.push(`base_url must start with http:// or https:// (got "${value}")`);
      else out.fields.base_url = value;
    } else {
      const envName = lower.startsWith("env.") ? name.slice(4) : name;
      if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) out.errors.push(`unknown setting "${name}" (use provider, key, model, base_url, or an UPPER_CASE env var)`);
      else if (BLOCKED_ENV.test(envName)) out.errors.push(`${envName} cannot be set from config (security)`);
      else out.env[envName] = value;
    }
  }
  return out;
}

/** Merge parsed updates into config.json (atomic write, owner-only permissions). */
export function saveUserConfig(parsed: ParsedConfigArg): UserConfig {
  const current = readUserConfig(); // throws on corrupt JSON instead of clobbering it
  const next: UserConfig = { ...current, env: { ...(current.env ?? {}) } };
  for (const [k, v] of Object.entries(parsed.fields)) {
    if (v === "") delete (next as Record<string, unknown>)[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  for (const [k, v] of Object.entries(parsed.env)) {
    if (v === "") delete next.env![k];
    else next.env![k] = v;
  }
  if (Object.keys(next.env ?? {}).length === 0) delete next.env;

  const file = userConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort (e.g. Windows)
  }
  active = null;
  return next;
}

/** Human-readable view with secrets masked. */
export function formatUserConfig(cfg: UserConfig): string[] {
  const lines: string[] = [];
  if (cfg.provider) lines.push(`provider = ${cfg.provider}`);
  if (cfg.key) lines.push(`key      = ${maskSecret(cfg.key)}`);
  if (cfg.model) lines.push(`model    = ${cfg.model}`);
  if (cfg.base_url) lines.push(`base_url = ${cfg.base_url}`);
  for (const [k, v] of Object.entries(cfg.env ?? {})) lines.push(`${k} = ${SECRET_NAME.test(k) ? maskSecret(String(v)) : v}`);
  return lines.length ? lines : ["(empty)"];
}

/**
 * Pull `--config <value>` / `--config=<value>` out of argv so it works anywhere
 * on the command line. Returns the remaining argv.
 */
export function extractConfigArg(argv: string[]): { value?: string; argv: string[]; error?: string } {
  const rest = argv.slice(0, 2);
  let value: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return { argv, error: '--config needs a value, e.g. --config "provider=deepseek,key=sk-…" (or --config show)' };
      value = next;
      i++;
    } else if (a.startsWith("--config=")) {
      value = a.slice("--config=".length);
    } else {
      rest.push(a);
    }
  }
  return { value, argv: rest };
}
