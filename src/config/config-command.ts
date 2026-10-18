// xcoder:version 3 | xcoder:task task-81af05 | xcoder:updated 2026-10-17T13:29:23.388Z | xcoder:subtask code-st-f1c53a
// `kooder --config 'k=v,...'` controller.
//
// Owns exactly one invocation: validate EVERYTHING first, then write once, then
// apply, then format. That ordering is the all-or-nothing boundary — a single
// bad token means exit 2 with zero bytes written.
//
// Exit codes: 0 persisted / shown, 2 usage or validation error, 1 I/O failure
// or a corrupt config.json that is refused to be clobbered.
import {
  applyUserConfig,
  formatUserConfig,
  parseConfigArg,
  readUserConfig,
  saveUserConfig,
  userConfigPath,
  type ParsedConfigArg,
  type UserConfig,
} from "./user-config.js";
import { findShellShadows, resolveSettings, type ResolvedField } from "./settings-schema.js";

export interface ConfigCommandOptions {
  /** Raw value after `--config`. `show` is the read-only form; "-" reads stdin. */
  arg: string;
  /** Emit the machine-readable document on stdout. */
  json: boolean;
  /** Suppress non-fatal notices. */
  quiet: boolean;
  /** stdout writer, injected for tests. Defaults to process.stdout. */
  out?: NodeJS.WritableStream;
  /** stderr writer, injected for tests. Defaults to process.stderr. */
  err?: NodeJS.WritableStream;
  /**
   * Environment used for the shell-shadow check. Defaults to process.env;
   * injectable so the check is assertable without depending on whichever
   * variables the developer's own shell happens to export.
   */
  env?: NodeJS.ProcessEnv;
}

/** Human-facing result; also the --json payload, secrets already masked. */
export interface ConfigCommandResult {
  ok: boolean;
  /** Absolute path of the file written (or read, for show). */
  path: string;
  /** written | shown — nothing is persisted for shown. */
  action: "written" | "shown";
  /** One line per setting, secrets passed through maskSecret(). */
  effective: string[];
  /** Names shadowed by a shell export; empty when none. */
  shadowed: string[];
  errors: string[];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (buf += chunk));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

/** Turn resolved fields + env back into the storage layer's parsed shape. */
function toParsed(fields: ResolvedField[], env: Record<string, string>): ParsedConfigArg {
  const parsed: ParsedConfigArg = { fields: {}, env: {}, errors: [] };
  for (const f of fields) parsed.fields[f.field] = f.value;
  parsed.env = { ...env };
  return parsed;
}

function emit(opts: ConfigCommandOptions, result: ConfigCommandResult, warnings: string[]): void {
  const out = opts.out ?? process.stdout;
  const err = opts.err ?? process.stderr;
  for (const w of warnings) if (!opts.quiet) err.write(`config: ${w}\n`);
  for (const name of result.shadowed) {
    if (!opts.quiet) {
      err.write(`config: ${name} is exported in this shell and overrides the stored value\n`);
    }
  }
  if (opts.json) {
    out.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result.ok) {
    for (const line of result.effective) out.write(line + "\n");
    const verb = result.action === "written" ? "written to" : "read from";
    out.write(`(${verb} ${result.path})\n`);
  } else {
    for (const e of result.errors) err.write(`config: ${e}\n`);
    err.write("config: nothing was written\n");
  }
}

/** One `--config` invocation. Returns the process exit code. */
export async function runConfigCommand(opts: ConfigCommandOptions): Promise<number> {
  const file = userConfigPath();
  const base: ConfigCommandResult = {
    ok: false,
    path: file,
    action: "written",
    effective: [],
    shadowed: [],
    errors: [],
  };

  // ---- read-only form -----------------------------------------------------
  if (opts.arg.trim().toLowerCase() === "show") {
    let cfg: UserConfig;
    try {
      cfg = readUserConfig();
    } catch (e) {
      base.errors = [`cannot read ${file}: ${(e as Error).message}`];
      emit(opts, base, []);
      return 1;
    }
    const shown: ConfigCommandResult = { ...base, ok: true, action: "shown", effective: formatUserConfig(cfg) };
    emit(opts, shown, []);
    return 0;
  }

  // ---- write form ---------------------------------------------------------
  let arg = opts.arg;
  if (arg === "-") {
    try {
      arg = (await readStdin()).trim();
    } catch (e) {
      base.errors = [`could not read settings from stdin: ${(e as Error).message}`];
      emit(opts, base, []);
      return 1;
    }
  }

  const resolved = resolveSettings(parseConfigArg(arg), arg === "-" ? "-" : opts.arg);
  if (resolved.errors.length) {
    base.errors = resolved.errors;
    emit(opts, base, resolved.warnings);
    return 2;
  }

  // Single write, after every token validated. A corrupt existing file makes
  // readUserConfig() throw here, so it is reported instead of clobbered.
  let saved: UserConfig;
  try {
    saved = saveUserConfig(toParsed(resolved.fields, resolved.env));
  } catch (e) {
    base.errors = [`could not write ${file}: ${(e as Error).message}`];
    emit(opts, base, resolved.warnings);
    return 1;
  }

  // Re-apply in-process: loadConfig() already ran at import time, so without
  // this a `run --config ...` would ignore the values it just persisted.
  applyUserConfig();

  const result: ConfigCommandResult = {
    ...base,
    ok: true,
    action: "written",
    effective: formatUserConfig(saved),
    shadowed: findShellShadows(resolved.fields, resolved.env, opts.env ?? process.env),
  };
  emit(opts, result, resolved.warnings);
  return 0;
}
