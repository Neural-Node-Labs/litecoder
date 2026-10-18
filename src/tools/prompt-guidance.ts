// xcoder:version 1 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:17:53.138Z | xcoder:subtask code-st-cd4444
/**
 * Shared cheapest-first guidance fragments, embedded into the manifest
 * descriptions of the efficient-filesystem toolset so every agent that
 * renders `buildToolManifest` output (Sub/Samurai/Genesis agents, the
 * conversation runner, debate, the Samurai CLI, and therefore the SDLC
 * orchestrator, swarm, healing, and validation-gate paths) automatically
 * sees the efficiency hierarchy next to each tool.
 *
 * The fragments are deliberately plain-language and action-oriented:
 * they tell the model which cheaper alternative exists for a given tool
 * BEFORE it spends tokens on the expensive one.
 */
export const PROMPT_GUIDANCE = {
  /** Guidance for read-side tools: prefer the cheapest structural read. */
  readFirst:
    "Cheapest read first: read_outline for a structural skeleton, or read_multiple_files for batched sections — before read_file/read_full_file.",
  /** Guidance for write-side tools: prefer surgical edits over full rewrites. */
  editFirst:
    "Cheapest edit first: line_patch / edit_file / sed_tool for surgical changes; write_file only for new files or genuine full rewrites (add force: true above 200 lines).",
  /** Guidance after any edit: validate just the patched file. */
  validateAfterEdit:
    "After any edit, call validate_file to syntax/type-check the patched file before moving on.",
  /** Guidance for source-control reads: prefer summaries over raw output. */
  gitFirst:
    "Prefer git_diff / git_log (low-token summaries) over raw run_command git invocations — cheaper and workspace-pinned.",
};
