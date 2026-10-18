// xcoder:version 6 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:31:54.775Z | xcoder:subtask code-st-1a0810
import type { FileTouchEntry, RaoStep, SubtaskNode, SubtaskResult, TokenUsage } from "../types.js";
import type { WksProtocolMap } from "../protocol/wks-protocol-manager.js";
import { LlmClient, type LlmCompletion, type LlmMessage } from "../llm/client.js";
import { buildAgentSystemPrompt, parseReactMessage, fenceToolOutput } from "../protocol/react-contract.js";
import { buildToolManifest, TOOL_MANIFEST, dispatchTool } from "../tools/tool-registry.js";
import { ROLE_DIRECTIVES, type RoleDirective } from "../skills/directives.js";
import { buildBylawContext } from "../skills/bylaw-context.js";
import { getRoutedExternalSkills } from "../skills/skillRouter.js";
import { isExternalSkillsEnabled} from "../skills/externalSkillLoader.js";
import { getOrBuildIndex } from "../tools/workspace-index.js";
import { detectProjectCommands } from "../tools/project-detect.js";
import { getEnvironmentInfo } from "../util/env-info.js";
import { appendThink, appendSys, appendLlm, appendToken } from "../util/logs.js";
import { emitKooderEvent } from "../events/bus.js";
import { DuplicateActionDetector } from "./duplicate-detector.js";
import * as term from "../util/terminal.js";
import { silentTerminal } from "../util/terminal-silent.js";
import { isProtocolErrorLoggingEnabled, logProtocolError } from "../util/protocol-error-logger.js";
import { isToolErrorLoggingEnabled, logToolError } from "../util/tool-error-logger.js";

export interface SubAgentOptions {
  taskId: string;
  workspaceRoot: string;
  llm: LlmClient;
  maxIterations?: number;
  /** Appended to the subtask goal on a healing retry — see orchestrator/healing.ts. */
  healingHint?: string;
  /** Optional per-role protocol overrides from wks_protocol.md. */
  protocolOverrides?: WksProtocolMap;
  /**
   * If set, overrides the role directive and/or skills (the system prompt's
   * "Your directive" block and "## Relevant skills" section).
   * - A plain `string` uses it as the directive text, skills fall back to
   *   ROLE_DIRECTIVES[subtask.role].skills (backward compat).
   * - A `RoleDirective` object carries both `directive` and `skills`,
   *   enabling a full override of both. If the object has no `skills`
   *   array, skills also fall back to the role defaults.
   * Allows the --ba path to inject a specialized directive without changing
   * ROLE_DIRECTIVES, which existing callers (orchestrator, healing, etc.) rely on.
   */
  directiveOverride?: string | RoleDirective;
  /** Enable diagnostic logging of protocol_error parse failures to protocol_error.log. */
  protocolErrorLog?: boolean;
  /** When true, use SilentTerminal to suppress console output. */
  quiet?: boolean;
}

/**
 * The "Instance Agent" of the design brief, mapped 1:1 onto Kooder's Sub
 * Agent: role and engine are config on the subtask node (`role`, `engine`),
 * not baked into a special-purpose class.
 *
 * Isolation contract: `run()` NEVER throws. Every failure mode inside the
 * loop — an LLM API error, a tool exception that somehow escaped
 * `dispatchTool`'s own try/catch, an unparseable response — is caught,
 * logged to `sys.log`, surfaced to the terminal, and turned into either a
 * recoverable observation (the loop continues) or, if truly fatal, a
 * `crashed: true` result the Master Orchestrator can route through its
 * normal bounded healing/escalation path. The caller in `orchestrator/
 * swarm.ts` still wraps this in its own try/catch as defense in depth, but
 * this class is designed not to need that safety net.
 */
export class SubAgent {
  constructor(private opts: SubAgentOptions) {}

  private get term() {
    return this.opts.quiet ? silentTerminal : term;
  }

  async run(subtask: SubtaskNode): Promise<SubtaskResult> {
    const { taskId, workspaceRoot } = this.opts;

    if (subtask.engine !== "react-v1") {
      return this.crashResult(
        subtask,
        `Sub Agent engine "${subtask.engine}" is not implemented yet — only "react-v1" runs today.`
      );
    }

    let systemPrompt: string;
    try {
      const index = await getOrBuildIndex(workspaceRoot);
      const detectedCommands = await detectProjectCommands(workspaceRoot, index);
      const environment = getEnvironmentInfo();
      const directive = ROLE_DIRECTIVES[subtask.role];
      const override = this.opts.directiveOverride;
      const effectiveDirective = typeof override === 'string' ? override : (override?.directive ?? directive.directive);
      let effectiveSkills =
        typeof override === 'object' && override?.skills
          ? override.skills
          : (directive.skills ?? []);
      // Append external skills relevant to this specific role (from
      // skills/<name>/SKILL.md files) when KOODER_EXTERNAL_SKILLS is on.
      // getRoutedExternalSkills() internally no-ops for 'conversation' (no
      // allowlist entry) and returns [] when the flag is off, so this call
      // is always safe to make unconditionally.
      if (subtask.role !== "conversation" && isExternalSkillsEnabled()) {
        effectiveSkills = [...effectiveSkills, ...getRoutedExternalSkills(subtask.role)];
      }
      const goal = this.opts.healingHint ? `${subtask.goal}\n\nHEALING HINT: ${this.opts.healingHint}` : subtask.goal;
      const effectiveSubtask: SubtaskNode = { ...subtask, goal };
      const protocolSection = this.opts.protocolOverrides?.[subtask.role];

      const upstreamCtx = Object.keys(effectiveSubtask.upstreamContext).length
        ? JSON.stringify(effectiveSubtask.upstreamContext, null, 2)
        : undefined;

      const goalText = [
        `- id: ${effectiveSubtask.id}`,
        `- stage: ${effectiveSubtask.stage}`,
        `- goal: ${effectiveSubtask.goal}`,
        `- what you must deliver back to the Master Orchestrator: ${effectiveSubtask.deliverableSpec}`,
        `- acceptance criteria (the Validation Gate checks these independently — you`,
        `  are not the one who decides you passed):`,
        ...effectiveSubtask.acceptanceCriteria.map((ac) => `  - [${ac.id}] (${ac.type}) ${ac.description}`),
      ].join("\n");

      const bylaw = buildBylawContext({
        stage: effectiveSubtask.stage,
        role: effectiveSubtask.role,
        goal: effectiveSubtask.goal,
      });

      systemPrompt = buildAgentSystemPrompt({
        agentName: subtask.role,
        roleDescription: effectiveDirective,
        directive: effectiveDirective,
        skills: effectiveSkills,
        tools: buildToolManifest(),
        environment,
        detectedCommands,
        goal: goalText,
        upstreamContext: upstreamCtx,
        protocolOverride: protocolSection,
        isStandalone: false,
        bylawContext: bylaw?.text,
      });
    } catch (e) {
      // Setup itself failing (e.g. can't read the workspace at all) is still
      // not allowed to crash the orchestrator — surface it as a crash result.
      return this.crashResult(subtask, `failed to prepare subtask: ${(e as Error).message}`);
    }

    const transcript: LlmMessage[] = [
      { role: "user", content: "Begin. Respond with your first contract message now." },
    ];
    const raoTrace: RaoStep[] = [];
    const filesTouched = new Set<string>();
    const filesTouchedMeta: FileTouchEntry[] = [];
    const maxIterations = this.opts.maxIterations ?? 200;
    const cumulative: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const dupDetector = new DuplicateActionDetector();
    const ctx = { taskId, subtaskId: subtask.id };
    // Fail fast on a deterministic LLM failure (same error N times in a row)
    // instead of burning every iteration on a call that can never succeed.
    const MAX_CONSECUTIVE_LLM_ERRORS = 3;
    let lastLlmError = "";
    let consecutiveLlmErrors = 0;

    for (let i = 0; i < maxIterations; i++) {
      await appendLlm(workspaceRoot, taskId, subtask.id, {
        direction: "request",
        content: transcript.at(-1)?.content ?? "",
      });

      const spinner = this.term.startThinking(subtask.id);
      emitKooderEvent({ type: "agent:thinking-start", taskId, subtaskId: subtask.id });
      let raw: string;
      let completion: LlmCompletion;
      try {
        completion = await this.opts.llm.complete(systemPrompt, transcript);
        raw = completion.text;
        cumulative.inputTokens += completion.usage.inputTokens;
        cumulative.outputTokens += completion.usage.outputTokens;
        await appendToken(workspaceRoot, taskId, subtask.id, {
          inputTokens: completion.usage.inputTokens,
          outputTokens: completion.usage.outputTokens,
          cumulativeInput: cumulative.inputTokens,
          cumulativeOutput: cumulative.outputTokens,
        });
        this.term.printTokens(subtask.id, completion.usage, cumulative);
        emitKooderEvent({
          type: "agent:tokens",
          taskId,
          subtaskId: subtask.id,
          data: { turn: completion.usage, cumulative },
        });
        await appendLlm(workspaceRoot, taskId, subtask.id, { direction: "response", content: raw, stopReason: completion.stopReason });
        consecutiveLlmErrors = 0;
        lastLlmError = "";
      } catch (e) {
        // An LLM API failure (network, rate limit, auth) is exactly the
        // kind of thing that used to take the whole process down with it.
        // It's now a recoverable observation: log it, tell the model, let
        // it try again — still bounded by maxIterations either way.
        const message = (e as Error).message;
        spinner.fail(`llm_error: ${message}`);
        emitKooderEvent({ type: "agent:crash", taskId, subtaskId: subtask.id, data: { message: `llm_error: ${message}`, recoverable: true } });
        await appendSys(workspaceRoot, taskId, `[${subtask.id}] LLM call failed: ${message}`);
        await appendThink(workspaceRoot, taskId, subtask.id, `(llm_error) ${message}`);
        raoTrace.push({ thought: "(llm call failed)", action: null, observation: `llm_error: ${message}` });
        consecutiveLlmErrors = message === lastLlmError ? consecutiveLlmErrors + 1 : 1;
        lastLlmError = message;
        if (consecutiveLlmErrors >= MAX_CONSECUTIVE_LLM_ERRORS) {
          return this.crashResult(
            subtask,
            `LLM call failed ${consecutiveLlmErrors} times in a row with the same error: ${message}`,
          );
        }
        transcript.push({ role: "user", content: `Observation: llm_error: ${message}\nTry again.` });
        continue;
      }

      transcript.push({ role: "assistant", content: raw });
      const parsed = parseReactMessage(raw);

      if (!parsed.ok) {
        spinner.stop("(unparseable response)");
        this.term.printProtocolError(subtask.id, parsed.error);
        emitKooderEvent({ type: "agent:protocol-error", taskId, subtaskId: subtask.id, data: { message: parsed.error } });
        if (this.opts.protocolErrorLog || isProtocolErrorLoggingEnabled()) {
          logProtocolError({
            ts: new Date().toISOString(),
            taskId,
            agentId: subtask.id,
            iteration: i,
            error: parsed.error,
            raw,
            model: completion.model ?? "unknown",
            stopReason: completion.stopReason,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
          });
        }
        const isTruncated = completion.stopReason === 'max_tokens' || completion.stopReason === 'length';
        const errObservation = isTruncated
          ? `protocol_error: response was not valid JSON — your output was truncated because the token limit was reached (stop_reason: ${completion.stopReason}). The JSON was cut off mid-generation. Shorten your response — use fewer tools per turn, be more concise in your thought/action, and avoid including large file contents in your output. Parse error: ${parsed.error}`
          : `protocol_error: ${parsed.error}`;
        await appendThink(workspaceRoot, taskId, subtask.id, `(unparseable) ${errObservation}`);
        raoTrace.push({ thought: "(unparseable response)", action: null, observation: errObservation });
        transcript.push({ role: "user", content: `Observation: ${errObservation}\nRe-read the contract and try again.` });
        continue;
      }

      const { thought, action, final_answer } = parsed.message;
      spinner.stop(thought);
      emitKooderEvent({ type: "agent:thought", taskId, subtaskId: subtask.id, data: { thought } });
      await appendThink(workspaceRoot, taskId, subtask.id, `Thought: ${thought}`);

      if (final_answer) {
        this.term.printFinalAnswer(subtask.id, final_answer.summary);
        emitKooderEvent({ type: "agent:final", taskId, subtaskId: subtask.id, data: { summary: final_answer.summary } });
        await appendThink(workspaceRoot, taskId, subtask.id, `final_answer: ${final_answer.summary}`);
        raoTrace.push({ thought, action: null, observation: "final_answer submitted" });
        return {
          summary: final_answer.summary,
          deliverable: final_answer.deliverable,
          filesTouched: [...filesTouched, ...final_answer.files_touched],
          _filesTouchedMeta: filesTouchedMeta.length > 0 ? [...filesTouchedMeta] : undefined,
          selfCheck: final_answer.self_check,
          raoTrace,
          tokenUsage: cumulative,
          iterations: i + 1,
        };
      }

      // Prose-only recovery: parseReactMessage's Layer 4a/4b can return
      // { action: null, final_answer: null } when the model sends pure
      // reasoning prose. Treat the thought as an observation and continue.
      if (!action) {
        const obs = `prose_recovery: no action or final_answer in response — model sent reasoning prose only. Thought: ${thought}`;
        spinner.stop(`(prose-only: ${thought.slice(0, 80)}...)`);
        emitKooderEvent({ type: "agent:observation", taskId, subtaskId: subtask.id, data: { ok: true, tool: "prose_recovery", observation: obs } });
        await appendThink(workspaceRoot, taskId, subtask.id, `Observation: ${obs}`);
        raoTrace.push({ thought, action: null, observation: obs });
        transcript.push({ role: "user", content: `Observation: ${obs}\nYou must respond with either an action or a final_answer.` });
        continue;
      }

      const { tool, input } = action;
      this.term.printAction(subtask.id, tool, input);
      emitKooderEvent({ type: "agent:action", taskId, subtaskId: subtask.id, data: { tool, input } });
      await appendThink(workspaceRoot, taskId, subtask.id, `Action: ${tool} ${JSON.stringify(input)}`);

      const dup = dupDetector.check(thought, tool, input, i + 1);
      if (dup.isDuplicate) {
        this.term.printDuplicateWarning(subtask.id, dup.warning!);
        emitKooderEvent({ type: "agent:duplicate", taskId, subtaskId: subtask.id, data: { tool, priorIterations: dup.priorIterations, stuck: dup.stuck } });
        await appendThink(workspaceRoot, taskId, subtask.id, `(duplicate) ${dup.warning}`);
      }

      if (dup.stuck) {
        const message = `stuck in a repeated action loop: ${dupDetector.duplicateCount} duplicate actions detected — aborted after ${i + 1} iterations instead of running to the full ${maxIterations}-iteration cap.`;
        await appendSys(workspaceRoot, taskId, `[${subtask.id}] ${message}`);

        return {
          summary: message,
          deliverable: null,
          filesTouched: [...filesTouched],
          _filesTouchedMeta: filesTouchedMeta.length > 0 ? [...filesTouchedMeta] : undefined,
          raoTrace,
          tokenUsage: cumulative,
          iterations: i + 1,
          stuckLoop: true,
        };
      }

      let result;
      try {
        result = await dispatchTool(workspaceRoot, tool, input, ctx);
      } catch (e) {
        // dispatchTool already catches internally — this is a second net in
        // case a future tool addition forgets to. Never let a tool crash
        // the loop.
        const message = (e as Error).message;
        await appendSys(workspaceRoot, taskId, `[${subtask.id}] tool "${tool}" threw unexpectedly: ${message}`);
        result = { tool, ok: false, output: { error: `unexpected tool failure: ${message}` } };
      }

      // log tool errors when --debug-tools is active
      if (!result.ok && isToolErrorLoggingEnabled()) {
        logToolError({
          ts: new Date().toISOString(),
          tool,
          error: (result.output as { error?: string })?.error ?? "unknown",
          ok: false,
          taskId,
          subtaskId: subtask.id,
          input: JSON.stringify(input),
          iteration: i + 1,
        });
      }

      if (tool === "write_file" && result.ok) {
        const out = result.output as { relPath: string };
        filesTouched.add(out.relPath);
        filesTouchedMeta.push({ path: out.relPath, operation: "created" });
      }
      if (tool === "edit_file" && result.ok) {
        const out = result.output as { relPath: string };
        filesTouched.add(out.relPath);
        filesTouchedMeta.push({ path: out.relPath, operation: "modified" });
      }
      if (tool === "sed_tool" && result.ok) {
        const out = result.output as { results?: Array<{ relPath: string; matched: boolean }> };
        if (out.results) {
          for (const r of out.results) {
            if (r.matched) {
              filesTouched.add(r.relPath);
              filesTouchedMeta.push({ path: r.relPath, operation: "modified" });
            }
          }
        }
      }

      let observation = JSON.stringify(result.output).slice(0, 4000); // keep the transcript bounded
      if (dup.isDuplicate) observation = `[DUPLICATE — see warning above] ${observation}`;
      this.term.printObservation(subtask.id, result.ok, observation);
      emitKooderEvent({ type: "agent:observation", taskId, subtaskId: subtask.id, data: { ok: result.ok, tool, observation } });
      await appendThink(workspaceRoot, taskId, subtask.id, `Observation: ${observation}`);
      raoTrace.push({ thought, action: { tool, input }, observation });
      transcript.push({
        role: "user",
        content: dup.warning
          ? `Observation: ${fenceToolOutput(tool, observation)}\n\n${dup.warning}`
          : `Observation: ${fenceToolOutput(tool, observation)}`,
      });
    }

    await appendSys(workspaceRoot, taskId, `[${subtask.id}] exhausted ${maxIterations} iterations without a final_answer`);
    return {
      summary: `did not reach a final_answer within ${maxIterations} iterations`,
      deliverable: null,
      filesTouched: [...filesTouched],
      _filesTouchedMeta: filesTouchedMeta.length > 0 ? [...filesTouchedMeta] : undefined,
      raoTrace,
      tokenUsage: cumulative,
      iterations: maxIterations,
      iterationsExhausted: true,
    };
  }

  private async crashResult(subtask: SubtaskNode, message: string): Promise<SubtaskResult> {
    await appendSys(this.opts.workspaceRoot, this.opts.taskId, `[${subtask.id}] ${message}`);
    this.term.printCrash(subtask.id, message);
    emitKooderEvent({ type: "agent:crash", taskId: this.opts.taskId, subtaskId: subtask.id, data: { message, recoverable: false } });
    return {
      summary: message,
      deliverable: null,
      filesTouched: [],
      raoTrace: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      iterations: 0,
      crashed: true,
    };
  }
}
