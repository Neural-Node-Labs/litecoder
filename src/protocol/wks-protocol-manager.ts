import type { Role } from "../types.js";

/**
 * The set of keys that can appear as a top-level section heading in
 * `wks_protocol.md`. Every known `Role` is valid, plus `master-orchestrator`
 * for the orchestrator's own protocol section.
 */
export type WksProtocolKey = Role | "master-orchestrator";

/**
 * A map from protocol key to its section body text. Keys not present in the
 * file are undefined; keys with an empty section produce an empty string.
 */
export type WksProtocolMap = Partial<Record<WksProtocolKey, string>>;

/**
 * Parses the full text of `wks_protocol.md` and returns a map from
 * section heading (Role name or `master-orchestrator`) to that section's
 * verbatim body. Headings are identified by lines that match
 * `# role_name:` (hash, space, identifier, colon). Everything between one
 * heading and the next (or EOF) is the section body. Unknown headings are
 * silently skipped. Trailing blank lines in each body are trimmed.
 * An empty file or one with no recognised headings returns an empty map.
 */
export function parseWksProtocol(markdown: string): WksProtocolMap {
  const map: WksProtocolMap = {};
  if (!markdown) return map;

  const lines = markdown.split("\n");
  // Only lines matching exactly "# <key>:" are section boundaries.
  const headingRegex = /^#\s+([a-z][a-z-]*):\s*$/;

  let currentKey: WksProtocolKey | null = null;
  let currentBody: string[] = [];

  function flushSection(): void {
    if (currentKey) {
      // Trim trailing blank lines.
      while (currentBody.length && currentBody[currentBody.length - 1].trim() === "") {
        currentBody.pop();
      }
      map[currentKey] = currentBody.join("\n");
    }
    currentBody = [];
  }

  for (const line of lines) {
    const match = headingRegex.exec(line);
    if (match) {
      flushSection();
      const key = match[1];
      // Only accept recognised Role names or 'master-orchestrator'.
      if (isRecognisedKey(key)) {
        currentKey = key;
      } else {
        // Unknown heading — skip until the next recognised heading.
        currentKey = null;
      }
    } else if (currentKey) {
      currentBody.push(line);
    }
    // If we don't have a currentKey, we skip the line (between unknown headings).
  }

  flushSection();
  return map;
}

/**
 * All known Role values plus `master-orchestrator`. We inline this list
 * rather than importing every directive so the protocol manager stays
 * decoupled from the role registry — it just validates against a fixed
 * set of strings that happen to match the Role union.
 */
const RECOGNISED_KEYS = new Set<string>([
  "requirements-analyst",
  "architect",
  "programmer",
  "refactorer",
  "tester",
  "ui-api-tester",
  "technical-writer",
  "devops",
  "conversation",
  "business-analyst",
  "master-orchestrator",
]);

function isRecognisedKey(key: string): key is WksProtocolKey {
  return RECOGNISED_KEYS.has(key);
}
