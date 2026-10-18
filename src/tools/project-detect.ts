import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceIndex } from "./workspace-index.js";

export interface DetectedCommands {
  stack: string;
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
  reproduceHint: string;
}

/**
 * A guessed set of commands, not a guaranteed one — surfaced to the model
 * as a strong hint so it calls `run_command` with something that actually
 * exists in this project instead of assuming `npm test` everywhere (or
 * `pytest` in a Node project, etc.). This is what "inform the LLM ... run
 * tests / linter / type-checker / reproduce the bug" means in practice:
 * give it the real command names up front rather than making it discover
 * them by trial and error.
 */
export async function detectProjectCommands(root: string, index: WorkspaceIndex): Promise<DetectedCommands> {
  const has = (p: string) => index.entries.some((e) => e.relPath === p);

  if (has("package.json")) {
    try {
      const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      return {
        stack: "node",
        build: scripts.build ? "npm run build" : undefined,
        test: scripts.test ? "npm test" : undefined,
        lint: scripts.lint ? "npm run lint" : undefined,
        typecheck: scripts.typecheck ?? scripts["type-check"] ? "npm run typecheck" : (has("tsconfig.json") ? "npx tsc --noEmit" : undefined),
        reproduceHint: "Reproduce a reported bug with the narrowest test file/command you can, before writing a fix.",
      };
    } catch {
      return { stack: "node", reproduceHint: "package.json exists but couldn't be parsed — read it directly first." };
    }
  }
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
    return {
      stack: "python",
      test: "pytest",
      lint: "ruff check .",
      typecheck: "mypy .",
      reproduceHint: "Reproduce with a minimal pytest case before patching.",
    };
  }
  if (has("go.mod")) {
    return {
      stack: "go",
      build: "go build ./...",
      test: "go test ./...",
      lint: "go vet ./...",
      reproduceHint: "Reproduce with a targeted `go test -run <TestName>` before patching.",
    };
  }
  if (index.entries.some((e) => e.relPath.endsWith("pom.xml"))) {
    return {
      stack: "java-maven",
      build: "mvn compile",
      test: "mvn test",
      reproduceHint: "Reproduce with a targeted `mvn test -Dtest=<TestClass>` before patching.",
    };
  }
  if (index.entries.some((e) => e.relPath.endsWith("build.gradle") || e.relPath.endsWith("build.gradle.kts"))) {
    return {
      stack: "java-gradle",
      build: "./gradlew build",
      test: "./gradlew test",
      reproduceHint: "Reproduce with a targeted `./gradlew test --tests <TestClass>` before patching.",
    };
  }

  return {
    stack: "unknown",
    reproduceHint:
      "No recognized project manifest found in the workspace index. Use `search_workspace`/`glob` to look for a " +
      "manifest before guessing a build/test command.",
  };
}

export function detectedCommandsPromptBlock(cmds: DetectedCommands): string {
  const lines = [`## Detected project tooling (stack: ${cmds.stack})`];
  if (cmds.build) lines.push(`- build: \`${cmds.build}\``);
  if (cmds.test) lines.push(`- test: \`${cmds.test}\``);
  if (cmds.lint) lines.push(`- lint: \`${cmds.lint}\``);
  if (cmds.typecheck) lines.push(`- typecheck: \`${cmds.typecheck}\``);
  if (!cmds.build && !cmds.test && !cmds.lint && !cmds.typecheck) {
    lines.push("- (none detected — verify with `search_workspace`/`glob` before assuming a command exists)");
  }
  lines.push(cmds.reproduceHint);
  return lines.join("\n");
}
