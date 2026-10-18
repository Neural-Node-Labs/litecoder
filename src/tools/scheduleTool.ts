import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MARKER_PREFIX = "# xcoder-schedule:";
const WIN_TASK_PREFIX = "xcoder_"; // schtasks task names: keep it simple/safe, no spaces or special chars

export interface ScheduledJob {
  id: string;
  cronExpr: string;
  command: string;
}

const isWindows = process.platform === "win32";

// ─── POSIX (cron) implementation ────────────────────────────────────────────

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execFileP("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // no crontab yet for this user
  }
}

async function writeCrontab(content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("crontab", ["-"]);
    child.stdin.write(content);
    child.stdin.end();
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`crontab write failed (exit ${code})`))));
  });
}

async function scheduleCronPosix(id: string, cronExpr: string, command: string): Promise<{ id: string; cronExpr: string }> {
  const current = await readCrontab();
  const line = `${MARKER_PREFIX}${id}\n${cronExpr} ${command}\n`;
  await writeCrontab(current + (current.endsWith("\n") || current === "" ? "" : "\n") + line);
  return { id, cronExpr };
}

async function listScheduledPosix(): Promise<ScheduledJob[]> {
  const content = await readCrontab();
  const lines = content.split("\n");
  const jobs: ScheduledJob[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(MARKER_PREFIX)) {
      const id = lines[i].slice(MARKER_PREFIX.length);
      const jobLine = lines[i + 1] ?? "";
      const match = jobLine.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/);
      if (match) jobs.push({ id, cronExpr: match[1], command: match[2] });
    }
  }
  return jobs;
}

async function removeScheduledPosix(id: string): Promise<{ removed: boolean }> {
  const content = await readCrontab();
  const lines = content.split("\n");
  const out: string[] = [];
  let skipNext = false;
  let removed = false;
  for (const line of lines) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (line === `${MARKER_PREFIX}${id}`) {
      skipNext = true;
      removed = true;
      continue;
    }
    out.push(line);
  }
  await writeCrontab(out.join("\n"));
  return { removed };
}

// ─── Windows (Task Scheduler / schtasks) implementation ─────────────────────
//
// crontab doesn't exist on Windows at all (readCrontab/writeCrontab above fail with a plain
// ENOENT), so recurring schedules previously just didn't work there. schtasks.exe is the
// native equivalent, but it doesn't understand cron expressions directly — it has its own
// schedule types (MINUTE, HOURLY, DAILY, WEEKLY, MONTHLY). We translate the common cron
// patterns an agent is realistically going to generate; anything more exotic (step values on
// day-of-month, comma lists mixing types, etc.) gets a clear error instead of silently doing
// the wrong thing.

interface WinSchedule {
  sc: string; // /SC value
  extraArgs: string[];
}

function cronToSchtasks(cronExpr: string): WinSchedule {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression "${cronExpr}" doesn't have 5 fields — can't translate to Windows Task Scheduler.`);
  }
  const [min, hour, dom, month, dow] = parts;

  // Every N minutes: "*/N * * * *"
  const everyNMinutes = min.match(/^\*\/(\d+)$/);
  if (everyNMinutes && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return { sc: "MINUTE", extraArgs: ["/MO", everyNMinutes[1]] };
  }

  // Every N hours at minute M: "M */N * * *"
  const everyNHours = hour.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(min) && everyNHours && dom === "*" && month === "*" && dow === "*") {
    return { sc: "HOURLY", extraArgs: ["/MO", everyNHours[1]] };
  }

  // Daily at a fixed time: "M H * * *"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*") {
    return { sc: "DAILY", extraArgs: ["/ST", `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`] };
  }

  // Weekly on a specific day at a fixed time: "M H * * D" (D = 0-6, Sun-Sat)
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && month === "*" && /^[0-6]$/.test(dow)) {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    return {
      sc: "WEEKLY",
      extraArgs: ["/D", days[Number(dow)], "/ST", `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`],
    };
  }

  // Monthly on a specific day-of-month at a fixed time: "M H D * *"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === "*" && dow === "*") {
    return {
      sc: "MONTHLY",
      extraArgs: ["/D", dom, "/ST", `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`],
    };
  }

  throw new Error(
    `Cron expression "${cronExpr}" isn't one of the patterns translated to Windows Task Scheduler ` +
      `(supported: "*/N * * * *", "M */N * * *", "M H * * *", "M H * * D", "M H D * *"). ` +
      `Run this under WSL for full cron syntax support instead.`
  );
}

function winTaskName(id: string): string {
  return `${WIN_TASK_PREFIX}${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function scheduleCronWin(id: string, cronExpr: string, command: string): Promise<{ id: string; cronExpr: string }> {
  const { sc, extraArgs } = cronToSchtasks(cronExpr);
  const taskName = winTaskName(id);
  // /TR wraps the command in a PowerShell invocation so the same command strings work as they
  // would under `run_command_tool` on this same host.
  const tr = `powershell.exe -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`;
  await execFileP("schtasks", ["/Create", "/F", "/TN", taskName, "/SC", sc, ...extraArgs, "/TR", tr]);
  return { id, cronExpr };
}

async function listScheduledWin(): Promise<ScheduledJob[]> {
  try {
    const { stdout } = await execFileP("schtasks", ["/Query", "/FO", "CSV", "/V"]);
    const lines = stdout.split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]);
    const taskNameIdx = header.indexOf("TaskName");
    const scheduleIdx = header.indexOf("Schedule Type");
    const nextRunIdx = header.indexOf("Next Run Time");
    const jobs: ScheduledJob[] = [];
    for (const line of lines.slice(1)) {
      const cols = parseCsvLine(line);
      const taskPath = cols[taskNameIdx] ?? "";
      const shortName = taskPath.split("\\").pop() ?? "";
      if (!shortName.startsWith(WIN_TASK_PREFIX)) continue;
      const id = shortName.slice(WIN_TASK_PREFIX.length);
      jobs.push({
        id,
        cronExpr: cols[scheduleIdx] ?? "unknown",
        command: `(see: schtasks /Query /TN "${taskPath}" /V /FO LIST — next run: ${cols[nextRunIdx] ?? "unknown"})`,
      });
    }
    return jobs;
  } catch {
    return [];
  }
}

function parseCsvLine(line: string): string[] {
  // schtasks' CSV output is simple enough (no embedded commas within quoted values we care
  // about parsing) that a basic quoted-field split covers it.
  return line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
}

async function removeScheduledWin(id: string): Promise<{ removed: boolean }> {
  try {
    await execFileP("schtasks", ["/Delete", "/F", "/TN", winTaskName(id)]);
    return { removed: true };
  } catch {
    return { removed: false };
  }
}

// ─── Public API (dispatches to the right platform implementation) ──────────

/** Registers a recurring job: cron on POSIX, a translated Windows Task Scheduler task on
 *  win32, tagged with an id for later listing/removal. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_CRON = /^[0-9*/,\-]+(?: +[0-9*/,\-]+){4}$/;

/** id/cron/command end up on crontab lines — a newline in any of them would inject extra jobs. */
function assertSafeScheduleInput(id: string | undefined, cronExpr: string | undefined, command: string): void {
  if (id !== undefined && !SAFE_ID.test(id)) throw new Error(`invalid schedule id "${id}" (use letters, digits, '_' or '-')`);
  if (cronExpr !== undefined && !SAFE_CRON.test(cronExpr.trim())) throw new Error(`invalid cron expression "${cronExpr}"`);
  if (/[\r\n\0]/.test(command)) throw new Error("command must be a single line");
}

export async function scheduleCron(id: string, cronExpr: string, command: string): Promise<{ id: string; cronExpr: string }> {
  assertSafeScheduleInput(id, cronExpr, command);
  return isWindows ? scheduleCronWin(id, cronExpr, command) : scheduleCronPosix(id, cronExpr, command);
}

/** Schedules a one-off command to run after `delaySeconds`, surviving beyond the current process. */
export async function scheduleOnce(delaySeconds: number, command: string): Promise<{ scheduledFor: string }> {
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 31_536_000) {
    throw new Error(`invalid delaySeconds "${delaySeconds}" (integer 0..31536000)`);
  }
  assertSafeScheduleInput(undefined, undefined, command);
  const child = isWindows
    ? spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `Start-Sleep -Seconds ${delaySeconds}; ${command}`],
        { detached: true, stdio: "ignore", windowsHide: true }
      )
    : spawn("bash", ["-c", `sleep ${delaySeconds} && ${command}`], { detached: true, stdio: "ignore" });
  child.unref();
  return { scheduledFor: new Date(Date.now() + delaySeconds * 1000).toISOString() };
}

export async function listScheduled(): Promise<ScheduledJob[]> {
  return isWindows ? listScheduledWin() : listScheduledPosix();
}

export async function removeScheduled(id: string): Promise<{ removed: boolean }> {
  return isWindows ? removeScheduledWin(id) : removeScheduledPosix(id);
}



