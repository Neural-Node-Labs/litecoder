import os from "node:os";

export interface EnvironmentInfo {
  platform: NodeJS.Platform;
  isWindows: boolean;
  shellHint: string;
  pathSep: string;
  release: string;
}

export function getEnvironmentInfo(): EnvironmentInfo {
  const platform = process.platform;
  const isWindows = platform === "win32";
  return {
    platform,
    isWindows,
    pathSep: isWindows ? "\\" : "/",
    release: os.release(),
    shellHint: isWindows
      ? "PowerShell or cmd.exe (unless run under WSL/Git Bash, in which case a real unix shell is available)"
      : "a POSIX shell (bash/zsh/sh)",
  };
}

/**
 * Injected into every Sub Agent's system prompt. This exists because a
 * model that assumes `ls`, `grep`, `rm -rf`, `cat`, or unix path
 * separators will happily emit a `run_command` action that fails outright
 * on native Windows — and with no isolation around that failure, it looked
 * like the agent "couldn't refactor" when it was actually just running the
 * wrong shell dialect. Telling it up front, plus giving it glob/grep/edit
 * tools that work identically on every platform, closes that gap.
 */
export function environmentPromptBlock(env: EnvironmentInfo): string {
  const warning = env.isWindows
    ? `You are running on Windows (${env.release}), most likely under ${env.shellHint}. ` +
      `Unix-only commands (\`ls\`, \`grep\`, \`cat\`, \`rm -rf\`, \`&&\` chaining in cmd.exe, \`/\`-only paths) ` +
      `may not exist or may behave differently here. Prefer the \`glob\`, \`grep\`, \`read_file\`, \`edit_file\`, ` +
      `and \`write_file\` tools over shell equivalents for anything file-related — they work identically on every ` +
      `platform. Only reach for \`run_command\` for things that genuinely need a real process (build/test/lint/` +
      `type-check commands, git, package managers), and use PowerShell-compatible syntax when you do.`
    : `You are running on ${env.platform} under ${env.shellHint}. Standard unix commands are available via ` +
      `\`run_command\`, but still prefer \`glob\`/\`grep\`/\`read_file\`/\`edit_file\` over shelling out to ` +
      `\`find\`/\`grep\`/\`cat\`/\`sed\` for file operations — they're faster, and their output is structured ` +
      `instead of raw text you'd have to re-parse.`;
  return `## Runtime environment\n${warning}`;
}
