// xcoder:version 4 | xcoder:task task-ae8e62 | xcoder:updated 2026-10-30T18:03:23.956Z | xcoder:subtask code-st-f128c5
/**
 * `sentinel` command definition: an always-on log-monitoring daemon plus the
 * approve/deny verbs that answer its HITL gate.
 *
 * Single source of truth. `createSentinelCommand()` builds the `Command`; the
 * standalone bin (`src/sentinel/bin.ts`) parses it directly, and the
 * `litecoder` root program mounts the very same definition through
 * `registerSentinelCommand(program)`. One option list, one `.action()`, so the
 * two surfaces cannot drift. The planner's positional goal contract is
 * untouched.
 */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { KOODER_VERSION } from '../version.js';
import { recordVerdict } from './approval-inbox.js';
import { loadSentinelConfig } from './config.js';
import { runSentinel } from './run.js';

export interface SentinelCliOptions {
  dryRun?: boolean;
  once?: boolean;
  approve?: string;
  deny?: string;
  config?: string;
}

export interface CreateSentinelCommandOptions {
  /** Own the `--version` flag. Only the standalone bin does. */
  standalone?: boolean;
  /** Prefix for error output; defaults to `'litecoder sentinel'`. */
  programLabel?: string;
}

const DESCRIPTION =
  'Run the always-on security daemon that monitors logs, or answer its approval requests.';

/** Build the `sentinel` command. Exported so both entry points share it. */
export function createSentinelCommand(opts: CreateSentinelCommandOptions = {}): Command {
  // A label parameter is uglier than deriving the prefix from `cmd.parent`,
  // but it keeps the long-standing `litecoder sentinel:` string stable for
  // anyone scraping logs while the standalone bin prints plain `sentinel:`.
  const label = opts.programLabel ?? 'litecoder sentinel';

  const sentinel = new Command('sentinel')
    .description(DESCRIPTION)
    .option('--no-dry-run', 'Actually apply firewall blocks (default is dry-run: log-only)')
    .option('--once', 'Run a single monitoring cycle and exit (smoke test)', false)
    .option('--approve <id>', 'Grant the pending approval for a decision id')
    .option('--deny <id>', 'Deny the pending approval for a decision id')
    .option('--config <path>', 'Path to a JSON config file (env still applies)')
    .action(async (o: SentinelCliOptions) => {
      try {
        const fileText =
          typeof o.config === 'string' && o.config !== ''
            ? readFileSync(o.config, 'utf8')
            : undefined;
        const config = loadSentinelConfig(process.env, fileText);
        const inboxPath = config.offsetStorePath + '.approvals.json';
        if (typeof o.approve === 'string') {
          await recordVerdict(inboxPath, o.approve, 'granted');
          process.stdout.write('approved ' + o.approve + '\n');
          return;
        }
        if (typeof o.deny === 'string') {
          await recordVerdict(inboxPath, o.deny, 'denied');
          process.stdout.write('denied ' + o.deny + '\n');
          return;
        }

        const controller = new AbortController();
        const stop = (): void => controller.abort();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);

        const env = { ...process.env };
        if (o.dryRun === false) env.SENTINEL_DRYRUN = '0';
        const code = await runSentinel({ env, signal: controller.signal, once: o.once === true });
        process.exitCode = code;
      } catch (e) {
        process.stderr.write(label + ': ' + ((e as Error)?.message ?? String(e)) + '\n');
        process.exitCode = 2;
      }
    });

  if (opts.standalone) sentinel.version(KOODER_VERSION);

  sentinel.addHelpText('after', '\nRequires SENTINEL_ADMIN_IP and SENTINEL_LOG_PATHS (or a config file).');
  return sentinel;
}

/**
 * Back-compat mount: `litecoder sentinel …` keeps working unchanged. Attaching
 * the already-built `Command` keeps the option list and handler in one place.
 */
export function registerSentinelCommand(program: Command): void {
  program.addCommand(createSentinelCommand());
}
