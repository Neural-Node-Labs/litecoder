import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Read package.json from workspace root if present, extract name/version/
 * scripts/dependencies, and format as a context block injected into the
 * system prompt. Non-fatal if absent.
 */
export async function readPackageJsonContext(root: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      name?: string;
      version?: string;
      description?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const depNames = Object.keys(deps).sort();
    const depLines = depNames.length
      ? depNames.map((n) => `  ${n}: ${deps[n]}`).join("\n")
      : "  (none)";
    const scriptLines = pkg.scripts
      ? Object.entries(pkg.scripts)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n")
      : "  (none)";
    return `
## Project package.json
- name: ${pkg.name ?? "(not set)"}
- version: ${pkg.version ?? "(not set)"}
- description: ${pkg.description ?? "(not set)"}
- scripts:
${scriptLines}
- dependencies:
${depLines}
`.trim();
  } catch {
    return null;
  }
}
