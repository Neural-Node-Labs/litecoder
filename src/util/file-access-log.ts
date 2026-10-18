// Describes which files / commands a tool call touches, for `files.log`.
import { appendFiles } from "./logs.js";

export type FileOp = "read" | "write" | "search" | "list" | "index" | "exec" | "git" | "skill" | "lesson";
export interface FileAccess {
  op: FileOp;
  /** Workspace-relative path / glob (as the agent supplied it), or the command line. */
  target: string;
  kind: "path" | "glob" | "dir" | "cmd";
}

const MAX_CMD = 2000;

/** Strip obvious secrets before a command line is written to disk. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED]")
    .replace(/(:\/\/[^\s:@/]+:)[^\s@/]+@/g, "$1[REDACTED]@")
    .replace(/(authorization:\s*(?:bearer|basic)\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, "$1[REDACTED]");
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Pure: map a tool name + input to the files/commands it touches. Never throws. */
export function extractFileAccess(toolName: string, input: unknown): FileAccess[] {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: FileAccess[] = [];
  const path = (op: FileOp, v: unknown, kind: FileAccess["kind"] = "path") => {
    const t = str(v);
    if (t) out.push({ op, target: t, kind });
  };
  switch (toolName) {
    case "read_file":
    case "read_outline":
    case "read_full_file":
    case "get_dependency_graph":
    case "validate_file":
      path("read", i.path);
      break;
    case "read_multiple_files":
      if (Array.isArray(i.files)) for (const f of i.files) path("read", (f as { path?: unknown })?.path);
      break;
    case "write_file":
    case "edit_file":
    case "line_patch":
    case "apply_unified_diff":
    case "update_function":
    case "rename_symbol":
      path("write", i.path);
      break;
    case "sed_tool":
      path("write", i.path);
      path("write", i.glob, "glob");
      break;
    case "list_dir":
      path("list", i.dir, "dir");
      break;
    case "glob":
      path("search", i.pattern, "glob");
      break;
    case "grep":
      path("search", i.pathGlob ?? "**/*", "glob");
      break;
    case "search_ast":
      path("search", i.pathGlob ?? "**/*", "glob");
      break;
    case "search_workspace":
    case "reindex_workspace":
      out.push({ op: "index", target: ".", kind: "dir" });
      break;
    case "git_diff":
    case "git_log":
      out.push({ op: "git", target: str(i.path) ?? ".", kind: "path" });
      break;
    case "github_clone":
      out.push({ op: "write", target: str(i.dir) ?? ".", kind: "dir" });
      break;
    case "github_commit":
    case "github_push":
      out.push({ op: "git", target: str(i.cwd) ?? ".", kind: "dir" });
      break;
    case "load_skill":
      out.push({ op: "skill", target: str(i.role) ?? str(i.keyword) ?? "*", kind: "path" });
      break;
    case "record_lesson":
      out.push({ op: "lesson", target: ".kooder/lesson.md", kind: "path" });
      break;
    case "browse":
      if (Array.isArray(i.steps)) {
        for (const st of i.steps as { op?: unknown; path?: unknown }[]) {
          if (st?.op === "screenshot") out.push({ op: "write", target: str(st.path) ?? ".kooder/screenshots", kind: str(st.path) ? "path" : "dir" });
        }
      }
      break;
    case "run_command":
      path("exec", i.command, "cmd");
      break;
    case "schedule":
      if (str(i.command)) path("exec", i.command, "cmd");
      break;
    default:
      break;
  }
  return out;
}

function oneLine(s: string): string {
  return s.replace(/\r?\n/g, "\\n");
}

/** Best-effort: write one `files.log` line per file/command the call touched. Never throws. */
export async function logFileAccess(
  root: string,
  toolName: string,
  input: unknown,
  ok: boolean,
  ctx?: { taskId: string; subtaskId: string }
): Promise<void> {
  try {
    const taskId = ctx?.taskId ?? "session";
    const subtaskId = ctx?.subtaskId ?? "-";
    for (const a of extractFileAccess(toolName, input)) {
      const field = a.kind === "cmd" ? `cmd=${oneLine(redactSecrets(a.target)).slice(0, MAX_CMD)}` : `${a.kind}=${oneLine(a.target)}`;
      await appendFiles(root, taskId, subtaskId, `tool=${toolName} op=${a.op} ok=${ok} ${field}`);
    }
  } catch {
    // logging must never affect the tool call
  }
}
