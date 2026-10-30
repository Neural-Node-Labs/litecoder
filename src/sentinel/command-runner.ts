// xcoder:version 9 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:29:26.555Z | xcoder:subtask code-st-8f12c6
/**
 * The only way to reach the OS. Executes a fixed argv shape for a fixed
 * executable - never a shell string. shell:false is the structural guarantee
 * that model text can never become shell syntax.
 */
import { spawn } from 'node:child_process';

export interface CommandSpec {
  file: string;
  args: readonly string[];
  timeoutMs: number;
  requiresElevation: boolean;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

/** Every element allowed in an argv list. No space, no ';', no '. */
const SAFE_ARG = /^[A-Za-z0-9:._\-=/]+$/;

/** The entire attack surface: these files and these argv shapes only. */
export const ALLOWED_BINARIES = ['iptables', 'ip6tables', 'netsh'] as const;
export type AllowedBinary = (typeof ALLOWED_BINARIES)[number];

function isIpArg(s: string): boolean {
  return /^[0-9A-Fa-f:.]+$/.test(s);
}

/** Validate one argv list against the closed grammar for its binary. */
export function argvShapeAllowed(file: string, args: readonly string[]): boolean {
  if (!ALLOWED_BINARIES.includes(file as AllowedBinary)) return false;
  if (args.length === 0) return false;
  for (const a of args) {
    if (!SAFE_ARG.test(a)) return false;
  }
  if (file === 'iptables' || file === 'ip6tables') return iptablesShape(args);
  return netshShape(args);
}

/** -I/-D INPUT -s <ip> -j DROP ; or -C INPUT -s <ip> -j DROP -w */
function iptablesShape(args: readonly string[]): boolean {
  const op = args[0];
  if (op === '-I' || op === '-D') {
    return (
      args.length === 6 &&
      args[1] === 'INPUT' &&
      args[2] === '-s' &&
      isIpArg(args[3]) &&
      args[4] === '-j' &&
      args[5] === 'DROP'
    );
  }
  if (op === '-C') {
    return (
      args.length === 7 &&
      args[1] === 'INPUT' &&
      args[2] === '-s' &&
      isIpArg(args[3]) &&
      args[4] === '-j' &&
      args[5] === 'DROP' &&
      args[6] === '-w'
    );
  }
  return false;
}

/** advfirewall firewall add|delete rule name=sentinel-block-<ip> ... */
function netshShape(args: readonly string[]): boolean {
  if (args[0] !== 'advfirewall' || args[1] !== 'firewall') return false;
  const verb = args[2];
  if (verb === 'add') {
    return (
      args.length === 8 &&
      args[3] === 'rule' &&
      /^name=sentinel-block-[0-9A-Fa-f:.]+$/.test(args[4]) &&
      args[5] === 'dir=in' &&
      args[6] === 'action=block' &&
      /^remoteip=[0-9A-Fa-f:.]+$/.test(args[7])
    );
  }
  if (verb === 'delete') {
    return (
      args.length === 5 &&
      args[3] === 'rule' &&
      /^name=sentinel-block-[0-9A-Fa-f:.]+$/.test(args[4])
    );
  }
  if (verb === 'show') {
    return (
      args.length === 5 &&
      args[3] === 'rule' &&
      /^name=sentinel-block-[0-9A-Fa-f:.]+$/.test(args[4])
    );
  }
  return false;
}

export class NodeCommandRunner implements CommandRunner {
  async run(spec: CommandSpec): Promise<CommandResult> {
    if (!argvShapeAllowed(spec.file, spec.args)) {
      return {
        code: null,
        stdout: '',
        stderr: 'refused: argv shape not on the allowlist for ' + spec.file,
        timedOut: false,
      };
    }
    const timeoutMs = Math.max(1000, Math.min(spec.timeoutMs || 10000, 60000));
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(spec.file, spec.args as string[], { shell: false });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout?.on('data', (d: Buffer) => {
        if (stdout.length < 65536) stdout += d.toString('utf8');
      });
      child.stderr?.on('data', (d: Buffer) => {
        if (stderr.length < 65536) stderr += d.toString('utf8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: stderr + err.message, timedOut });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }
}
