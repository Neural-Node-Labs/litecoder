// xcoder:version 5 | xcoder:task task-a3052a | xcoder:updated 2026-10-17T12:59:22.951Z | xcoder:subtask code-st-b3a0c8
/**
 * The ONLY module that reads a Kooder-branded environment variable.
 *
 * The rebrand renamed `XCODER_*` to `KOOBER_*` and then `KOOBER_*` to
 * `KOODER_*`. Both older names are still honoured as deprecated aliases with
 * a one-time stderr warning, so an existing setup keeps working across the
 * rename instead of silently falling back to defaults. Values are never
 * logged — only key names appear in diagnostics.
 */

export type KooderEnvKey =
  | "KOODER_DIR"
  | "KOODER_HOME"
  | "KOODER_MODEL"
  | "KOODER_CONFIG_FILE"
  | "KOODER_DEBUG_CONFIG_PATH"
  | "KOODER_EXTERNAL_SKILLS";

/** Which historical prefix an alias belongs to. */
export type AliasTier = "koober" | "xcoder";

export interface LegacyEnvAlias {
  readonly key: string;
  readonly tier: AliasTier;
}

/** Keys already warned about, so the notice appears at most once per process. */
const warned = new Set<KooderEnvKey>();

/**
 * PURE and TOTAL. Canonical key -> its two legacy names, in precedence order.
 *
 * Whole-prefix substitution only: never `slice`/`substring`, which is what
 * turned `KOOBER_MODEL` into the nonsense `XOOBER_MODEL` (defect0001).
 */
export function deriveLegacyAliases(
  key: KooderEnvKey,
): readonly [LegacyEnvAlias, LegacyEnvAlias] {
  const koober = key.replace(/^KOODER_/, "KOOBER_");
  const xcoder = koober.replace(/^KOOBER_/, "XCODER_");
  return [
    { key: koober, tier: "koober" },
    { key: xcoder, tier: "xcoder" },
  ];
}

/**
 * Returns the effective value for `key`.
 *
 * Precedence: `KOODER_*` (no notice) > `KOOBER_*` (notice) > `XCODER_*
 * (notice)`. An empty string at ANY tier counts as unset. Reads are lazy on
 * purpose: the environment may change between calls (tests rely on that).
 * At most one notice per process per canonical key, naming the key the user
 * actually set — never both, never a synthesized name.
 */
export function readKooderEnv(key: KooderEnvKey): string | undefined {
  const modern = process.env[key];
  if (modern !== undefined && modern !== "") return modern;

  for (const alias of deriveLegacyAliases(key)) {
    const value = process.env[alias.key];
    if (value === undefined || value === "") continue;

    if (!warned.has(key)) {
      warned.add(key);
      process.stderr.write(
        `kooder: ${alias.key} is deprecated — use ${key} instead\n`,
      );
    }
    return value;
  }

  return undefined;
}

/** Test seam: clears the one-time deprecation-warning latch. */
export function resetDeprecationWarnings(): void {
  warned.clear();
}
