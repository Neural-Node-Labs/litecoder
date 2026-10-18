// xcoder:version 1 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:26:35.148Z | xcoder:subtask code-st-f1c53a
// Settings schema for `kooder --config 'k=v,...'` — PURE, no I/O.
//
// `parseConfigArg` in user-config.ts is lexical: it splits tokens and rejects
// unknown names. This module gives the request's extra vocabulary (`mode` as a
// provider alias, `ollama` expanding to an openai-compatible endpoint) defined
// meaning, plus duplicate/conflict detection and the shell-shadow warning. It
// never touches the filesystem and never mutates process.env, which is what
// makes it table-testable.
import type { ParsedConfigArg, UserProvider } from "./user-config.js";
import { PROVIDER_KEY_ENV, parseConfigArg } from "./user-config.js";

/** A single resolved top-level assignment, after alias/expansion. */
export interface ResolvedField {
  field: "provider" | "key" | "model" | "base_url";
  /** Empty string means delete the field. */
  value: string;
  /** Which token produced it, for error messages. */
  source: string;
  /** True when C1 synthesised this (ollama base_url), not the user. */
  implied?: boolean;
}

export interface ResolveResult {
  fields: ResolvedField[];
  env: Record<string, string>;
  errors: string[];
  /** Non-fatal notices for stderr. */
  warnings: string[];
}

/** Default OpenAI-compatible endpoint for a local Ollama daemon. */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Same split rule as parseConfigArg: a comma only starts a token before `name=`. */
const SPLIT = /,(?=\s*[A-Za-z_][A-Za-z0-9_.-]*\s*=)/;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)/i;
const FIELDS = ["provider", "key", "model", "base_url"] as const;

export interface Token {
  name: string;
  value: string;
  raw: string;
}

/** Lexical tokenisation, quote-stripped exactly like parseConfigArg. */
export function tokenizeConfigArg(arg: string): Token[] {
  const out: Token[] = [];
  for (const chunk of arg.split(SPLIT)) {
    const eq = chunk.indexOf("=");
    if (eq < 1) continue; // parseConfigArg reports the "expected name=value" error
    const name = chunk.slice(0, eq).trim();
    if (!name) continue;
    const value = chunk.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    out.push({ name, value, raw: chunk.trim() });
  }
  return out;
}

/** Canonical slot a token writes to. `mode` shares `provider`'s slot. */
export function slotOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "provider" || lower === "mode") return "provider";
  if (lower === "key" || lower === "api_key" || lower === "apikey") return "key";
  if (lower === "model") return "model";
  if (lower === "base_url" || lower === "baseurl" || lower === "url") return "base_url";
  const envName = lower.startsWith("env.") ? name.slice(4) : name;
  return `env:${envName}`;
}

/** Rewrite `mode=` to `provider=` and `ollama` to the openai-compatible value. */
function normalise(tokens: Token[]): { rewritten: Token[]; ollama: boolean } {
  const rewritten: Token[] = [];
  let ollama = false;
  for (const t of tokens) {
    const lower = t.name.toLowerCase();
    if (lower !== "provider" && lower !== "mode") {
      rewritten.push(t);
    } else if (t.value.toLowerCase() === "ollama") {
      ollama = true;
      rewritten.push({ name: "provider", value: "openai-compatible", raw: t.raw });
    } else {
      rewritten.push({ name: "provider", value: t.value, raw: t.raw });
    }
  }
  return { rewritten, ollama };
}

/** Duplicate/conflict detection, one message per contradictory slot. */
function detectConflicts(tokens: Token[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, Token>();
  for (const t of tokens) {
    const slot = slotOf(t.name);
    const prev = seen.get(slot);
    if (!prev) {
      seen.set(slot, t);
    } else if (prev.value !== t.value) {
      if (slot === "provider") {
        errors.push(
          "`mode` and `provider` are the same setting and were given different values " +
            `(${prev.raw}, ${t.raw}); keep one of them.`,
        );
      } else if (slot === "key") {
        // Never echo secret values, even though they came from argv.
        errors.push("`key` was given two different values; keep exactly one of them.");
      } else {
        const label = slot.startsWith("env:") ? slot.slice(4) : slot;
        errors.push(`\`${label}\` was given two different values; keep one of them.`);
      }
    }
  }
  return errors;
}

/**
 * Resolve one `--config` string into fields + env, with every error collected.
 *
 * `parsed` is the caller's `parseConfigArg(arg)` result; token rewriting happens
 * first and the existing lexical parser is re-run on the rewritten string, so
 * provider/base_url/BLOCKED_ENV validation stays in exactly one place.
 */
export function resolveSettings(parsed: ParsedConfigArg, rawArg: string): ResolveResult {
  const result: ResolveResult = { fields: [], env: {}, errors: [], warnings: [] };
  if (!rawArg.trim()) {
    result.errors.push('expected name=value settings, e.g. --config "provider=deepseek,key=sk-…"');
    return result;
  }

  const { rewritten, ollama } = normalise(tokenizeConfigArg(rawArg));
  const lexical = rewritten.length
    ? parseConfigArg(rewritten.map((t) => `${t.name}=${t.value}`).join(","))
    : parsed;
  result.errors.push(...lexical.errors, ...detectConflicts(rewritten));

  const sources = new Map<string, string>();
  for (const t of rewritten) if (!sources.has(slotOf(t.name))) sources.set(slotOf(t.name), t.raw);
  for (const field of FIELDS) {
    const value = lexical.fields[field];
    if (value !== undefined) result.fields.push({ field, value, source: sources.get(field) ?? field });
  }
  result.env = { ...lexical.env };

  // Ollama expansion: only synthesise base_url when the user did not give one.
  if (ollama && !result.fields.some((f) => f.field === "base_url")) {
    result.fields.push({ field: "base_url", value: OLLAMA_BASE_URL, source: "mode=ollama", implied: true });
  }
  if (ollama) {
    if (!result.fields.some((f) => f.field === "model" && f.value !== "")) {
      result.warnings.push(
        "ollama selected without a model; pass model=<name> (no default is assumed, because a " +
          "guessed model fails later at the first token request)",
      );
    }
    result.warnings.push(
      `ollama endpoint assumed to be ${OLLAMA_BASE_URL}; pass base_url=<url> for a remote daemon`,
    );
  }

  // argv is the requested secret channel but it is observable in shell history
  // and the process table. Warn once, without ever echoing a value.
  if (rawArg !== "-" && rewritten.some((t) => SECRET_NAME.test(t.name))) {
    result.warnings.push(
      "a secret was passed on the command line and may be stored in shell history. " +
        "Prefer: --config - (read settings from stdin)",
    );
  }
  return result;
}

/**
 * Env names currently exported in the shell that will shadow the written file.
 * Real shell exports beat ~/.kooder/config.json under the frozen precedence
 * rule, so a written value silently loses until that export is removed.
 */
export function findShellShadows(
  fields: ResolvedField[],
  env: Record<string, string>,
  lookup: NodeJS.ProcessEnv = process.env,
): string[] {
  const names = new Set<string>();
  const provider = fields.find((f) => f.field === "provider" && f.value !== "")?.value;
  for (const f of fields) {
    if (f.value === "") continue;
    if (f.field === "provider") names.add(PROVIDER_KEY_ENV[f.value as UserProvider]);
    else if (f.field === "key") {
      names.add("KOODER_API_KEY");
      names.add(PROVIDER_KEY_ENV[(provider ?? "deepseek") as UserProvider]);
    } else if (f.field === "model") names.add("KOODER_MODEL");
    else if (f.field === "base_url") names.add("KOODER_BASE_URL");
  }
  for (const [name, value] of Object.entries(env)) if (value !== "") names.add(name);
  return [...names].filter((n) => lookup[n] !== undefined && lookup[n] !== "").sort();
}
