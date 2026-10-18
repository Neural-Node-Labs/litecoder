/**
 * The one rule this file exists to enforce: a raw credential must never
 * cross back into the LLM's context, a tool-call log, or the RAO trace.
 *
 * The Sub Agent only ever holds a `credentialRef` — the NAME of an
 * environment variable, not a value. Resolution happens here, at the last
 * possible moment, inside the tool execution that actually needs the
 * secret (the Playwright tool), and the resolved value never gets returned
 * to the caller. If you're tempted to add a `getCredentialValue` export
 * that hands the string back to a caller outside `tools/`, don't — that's
 * the exact mistake this module is here to prevent.
 */

export class CredentialResolutionError extends Error {}

/** LLM provider keys: no tool ever has a reason to send these anywhere as a credential. */
const LLM_KEY_REFS =
  /^((KOODER|XCODER|RONIN|DEEPSEEK|ANTHROPIC|OPENAI|OPENROUTER|GROQ|OLLAMA|GEMINI|MISTRAL|AZURE_OPENAI)_API_KEY)$/i;
/** Source-host tokens: only the GitHub tools may use these (and they pin the destination host). */
const GITHUB_REFS = /^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT)$/i;
const VALID_REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ResolveCredentialOptions {
  /** Set by the GitHub tools only — they never send the token to a host other than the allowlisted git hosts. */
  allowGithub?: boolean;
}

/**
 * The model chooses `credentialRef`, so the NAME is untrusted input. Refuse
 * names that would turn a tool call into a secret-exfiltration primitive
 * (e.g. api_test with credentialRef=DEEPSEEK_API_KEY against an attacker URL).
 */
export function assertCredentialRefAllowed(ref: string, opts: ResolveCredentialOptions = {}): void {
  if (!VALID_REF_NAME.test(ref)) {
    throw new CredentialResolutionError(`credential ref "${ref}" is not a valid environment variable name.`);
  }
  if (LLM_KEY_REFS.test(ref)) {
    throw new CredentialResolutionError(`credential ref "${ref}" is an LLM provider key and cannot be used as a credentialRef.`);
  }
  if (GITHUB_REFS.test(ref) && !opts.allowGithub) {
    throw new CredentialResolutionError(`credential ref "${ref}" is only usable by the github_* tools.`);
  }
}

export function resolveCredential(ref: string, opts: ResolveCredentialOptions = {}): string {
  assertCredentialRefAllowed(ref, opts);
  const value = process.env[ref];
  if (!value) {
    throw new CredentialResolutionError(
      `credential ref "${ref}" is not set in the environment. Set it before running, e.g. ` +
        `\`${ref}=... kooder run ...\`. Kooder never accepts a raw secret as a CLI argument ` +
        `or task input — only a reference to where it lives.`
    );
  }
  return value;
}

/** For anything that might echo a string containing a resolved secret (logs, RAO trace, errors). */
export function redact(text: string, ref?: string): string {
  if (!ref) return text;
  const value = process.env[ref];
  if (!value) return text;
  return text.split(value).join(`«redacted:${ref}»`);
}
