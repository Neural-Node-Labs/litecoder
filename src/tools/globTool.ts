import fg from "fast-glob";
import { loadIgnoreRules } from "../indexing/ignoreRules.js";

export async function globTool(pattern: string, cwd: string = process.cwd()): Promise<string[]> {
  const ignore = loadIgnoreRules(cwd);
  return fg(pattern, { cwd, ignore, dot: false, onlyFiles: true });
}


