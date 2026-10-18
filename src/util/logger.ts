// xcoder:version 2 | xcoder:task task-e23ea7 | xcoder:updated 2026-08-05T09:43:25.115Z | xcoder:subtask code-st-a00941
const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  amber: "\x1b[38;5;214m",
  cyan: "\x1b[38;5;80m",
  green: "\x1b[38;5;78m",
  coral: "\x1b[38;5;203m",
};

function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

function paint(code: string, text: string): string {
  return useColor() ? `${code}${text}${COLOR.reset}` : text;
}

export const log = {
  orchestrator(msg: string) {
    console.log(paint(COLOR.amber, "[orchestrator]"), msg);
  },
  agent(id: string, msg: string) {
    console.log(paint(COLOR.cyan, `[${id}]`), msg);
  },
  ok(msg: string) {
    console.log(paint(COLOR.green, "✓"), msg);
  },
  fail(msg: string) {
    console.log(paint(COLOR.coral, "✗"), msg);
  },
  dim(msg: string) {
    console.log(paint(COLOR.dim, msg));
  },
  raw(msg: string) {
    console.log(msg);
  },
  sumurai(msg: string) {
    console.log(paint(COLOR.amber, "[Sumurai]"), msg);
  },
  ninj(msg: string) {
    console.log(paint(COLOR.cyan, "[Ninj]"), msg);
  },
};
