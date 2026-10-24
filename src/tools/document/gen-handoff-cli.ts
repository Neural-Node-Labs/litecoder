// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:28:30.083Z | xcoder:subtask code-st-39dbde
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateHandoffFiles, HANDOFF_ROOT } from "./handoff-generator.js";

/**
 * `npm run handoff:gen` — write the porting handoff to ./new_tools_handoff/.
 *
 * The generator is pure (no clock, no environment), so this command is
 * idempotent: running it twice leaves the tree byte-identical, which is what
 * lets CI enforce `git diff --exit-code new_tools_handoff/` after regenerating.
 */

export async function writeHandoff(repoRoot: string): Promise<{ written: string[]; root: string }> {
  const target = path.join(repoRoot, HANDOFF_ROOT);
  const files = generateHandoffFiles();
  const written: string[] = [];

  for (const [relPath, content] of files) {
    const full = path.join(target, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    written.push(`${HANDOFF_ROOT}/${relPath.replace(/\\/g, "/")}`);
  }

  return { written: written.sort(), root: target };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const { written } = await writeHandoff(repoRoot);
  process.stdout.write(`handoff: wrote ${written.length} file(s) to ${HANDOFF_ROOT}/\n`);
  for (const file of written) process.stdout.write(`  ${file}\n`);
}

const invokedDirectly = process.argv[1]
  ? process.argv[1].replace(/\\/g, "/").endsWith("gen-handoff-cli.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("gen-handoff-cli.js")
  : false;

if (invokedDirectly) {
  main().catch((e: unknown) => {
    process.stderr.write(`handoff generation failed: ${(e as Error).message}\n`);
    process.exitCode = 1;
  });
}
