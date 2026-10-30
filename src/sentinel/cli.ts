// xcoder:version 1 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:32:31.605Z | xcoder:subtask code-st-8f12c6
/**
 * `litecoder sentinel` subcommand: an always-on log-monitoring daemon plus
 * the approve/deny verbs that answer its HITL gate. The planner's positional
 * goal contract is untouched.
 */
import type { Command } from 'commander';
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

export function registerSentinelCommand(program: Command): void {
  const sentinel = program
    .command('sentinel')
    .description('Run the always-on security daemon that monitors logs, or answer its approval requests.')
    .option('--no-dry-run', 'Actually apply firewall blocks (default is dry-run: log-only)')
    .option('--once', 'Run a single monitoring cycle and exit (smoke test)', false)
    .option('--approve <id>', 'Grant the pending approval for a decision id')
    .option('--deny <id>', 'Deny the pending approval for a decision id')
    .option('--config <path>', 'Path to a JSON config file (env still applies)')
    .action(async (opts: SentinelCliOptions) => {
      try {
        const config = loadSentinelConfig(process.env, undefined);
        const inboxPath = config.offsetStorePath + '.approvals.json';
        if (typeof opts.approve === 'string') {
          await recordVerdict(inboxPath, opts.approve, 'granted');
          process.stdout.write('approved ' + opts.approve + '\n');
          return;
        }
        if (typeof opts.deny === 'string') {
          await recordVerdict(inboxPath, opts.deny, 'denied');
          process.stdout.write('denied ' + opts.deny + '\n');
          return;
        }

        const controller = new AbortController();
        const stop = (): void => controller.abort();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);

        const env = { ...process.env };
        if (opts.dryRun === false) env.SENTINEL_DRYRUN = '0';
        const code = await runSentinel({ env, signal: controller.signal, once: opts.once === true });
        process.exitCode = code;
      } catch (e) {
        process.stderr.write('litecoder sentinel: ' + ((e as Error)?.message ?? String(e)) + '\n');
        process.exitCode = 2;
      }
    });

  sentinel.addHelpText('after', '\nRequires SENTINEL_ADMIN_IP and SENTINEL_LOG_PATHS (or a config file).');
}
