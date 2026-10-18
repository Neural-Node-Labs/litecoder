// xcoder:version 1 | xcoder:task task-edfac1 | xcoder:updated 2026-08-04T09:23:09.377Z | xcoder:subtask code-st-21c578
/**
 * Cross-platform process tree killer.
 *
 * On Windows: uses `taskkill /F /T /PID <pid>`
 * On Unix: uses `kill(-pid)` to signal the entire process group;
 *   falls back to recursive pgrep-based killing for resilience.
 */
import { execSync, spawn } from "node:child_process";

/**
 * Kill a process and all of its descendants.
 *
 * @param rootPid - The PID of the root process to kill.
 * @param signal - 'SIGTERM' for graceful, 'SIGKILL' for force.
 * @returns Promise that resolves when all descendants are confirmed dead or after 3s timeout.
 */
export function killProcessTree(
  rootPid: number,
  signal: "SIGTERM" | "SIGKILL" = "SIGKILL"
): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      killWindowsTree(rootPid, signal, resolve);
    } else {
      killUnixTree(rootPid, signal, resolve);
    }
  });
}

function killWindowsTree(
  rootPid: number,
  signal: "SIGTERM" | "SIGKILL",
  resolve: () => void
): void {
  const forceFlag = signal === "SIGKILL" ? " /F" : "";
  try {
    execSync(`taskkill${forceFlag} /T /PID ${rootPid}`, {
      timeout: 3000,
      stdio: "pipe",
    });
  } catch {
    // taskkill may fail if process already exited — that's fine.
  }
  resolve();
}

function killUnixTree(
  rootPid: number,
  signal: "SIGTERM" | "SIGKILL",
  resolve: () => void
): void {
  const sigNum = signal === "SIGKILL" ? 9 : 15;

  // Try process-group kill first (cleanest).
  try {
    process.kill(-rootPid, sigNum);
  } catch {
    // Process group may not exist; fall through to recursive kill.
  }

  // Recursive pgrep kill as a fallback to ensure all children are dead.
  try {
    const descendants = getUnixDescendants(rootPid);
    for (const pid of descendants) {
      try {
        process.kill(pid, sigNum);
      } catch {
        // process already dead.
      }
    }
  } catch {
    // pgrep may not be available — process-group kill is best-effort.
  }

  // Give a short grace period, then resolve.
  setTimeout(resolve, 500);
}

/**
 * Recursively collect all child PIDs under rootPid using `pgrep -P`.
 */
function getUnixDescendants(rootPid: number): number[] {
  const pids: number[] = [];
  try {
    const raw = execSync(`pgrep -P ${rootPid}`, {
      timeout: 2000,
      stdio: "pipe",
      encoding: "utf8",
    });

    const children = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));

    for (const child of children) {
      pids.push(child);
      // Recurse into grandchildren.
      pids.push(...getUnixDescendants(child));
    }
  } catch {
    // pgrep may not be available or already exited.
  }
  return pids;
}

// ── Global tracked PIDs ──

/**
 * A Set of tracked child process PIDs. Used by the signal handler to
 * kill any surviving child processes on forced exit.
 */
export const trackedPids: Set<number> = new Set();

/**
 * Register a pid for cleanup tracking. Safe to call multiple times
 * (Set deduplicates).
 */
export function trackPid(pid: number): void {
  trackedPids.add(pid);
}

/**
 * Remove a pid from tracking (called when process exits normally).
 */
export function untrackPid(pid: number): void {
  trackedPids.delete(pid);
}

/**
 * Kill all tracked PIDs and clear the set. Used in process 'exit'
 * handler as a safety net to prevent orphaned processes.
 */
export async function killTrackedPids(): Promise<void> {
  const pids = Array.from(trackedPids);
  trackedPids.clear();

  for (const pid of pids) {
    await killProcessTree(pid, "SIGKILL");
  }
}

// Register an exit handler that kills any remaining tracked PIDs.
process.on("exit", () => {
  // Synchronous cleanup on exit: spawn taskkill/kill synchronously.
  const pids = Array.from(trackedPids);
  trackedPids.clear();
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { timeout: 2000, stdio: "ignore" });
      } else {
        try {
          process.kill(-pid, 9);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore — process already dead.
    }
  }
});
