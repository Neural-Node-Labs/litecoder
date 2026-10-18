// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:35:31.425Z | xcoder:subtask code-st-9de79a
/**
 * The trust boundary between the model and the dispatcher (PRM-07).
 *
 * Model output is hostile input: it is never trusted to be well-formed, to
 * name a real role, to fit in a budget, or to describe an acyclic DAG. The
 * schema below is strict (unknown keys are rejected, not ignored) and
 * bounded (sizes, counts, id charset), so a malformed plan fails closed and
 * dispatches nothing.
 *
 * Every rule whose violation would produce a *nondeterministic* run —
 * duplicate ids, dangling dependencies, self-references, cycles — is checked
 * here rather than downstream, because the dispatcher's topological wave
 * walk would otherwise have to guess.
 */
import { z } from "zod";
import { ROLES } from "../types.js";

/** Hard ceiling on plan size, independent of any user flag (AI-09). */
export const MAX_SUBTASKS_HARD_CAP = 16;

/** Per-field ceilings. Generous enough for a real work order, bounded enough to cap prompt/cost blowup. */
export const MAX_SUBTASK_GOAL_CHARS = 4000;
export const MAX_RATIONALE_CHARS = 4000;
export const MAX_DELIVERABLE_SPEC_CHARS = 2000;
export const MAX_SUBTASK_ID_CHARS = 64;

export const RoleSchema = z.enum(ROLES);

/**
 * One planned unit of work. Field-by-field rationale:
 *
 * - `id` — restricted to `[a-zA-Z0-9_-]` so it is safe to print, to key a
 *   report by, and to interpolate into a log line without escaping.
 * - `goal` — the self-contained work order the sub agent receives. Capped
 *   because it is the model's main lever on token spend.
 * - `role` — enum-constrained. A free string here would let the model pick
 *   a role that indexes no directive.
 * - `dependsOn` — ids only, never inline content; resolved and validated by
 *   the `superRefine` below.
 */
export const PlannedSubtaskSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(MAX_SUBTASK_ID_CHARS)
    .regex(/^[a-zA-Z0-9_-]+$/, "id must match [a-zA-Z0-9_-]+"),
  goal: z.string().min(1).max(MAX_SUBTASK_GOAL_CHARS),
  role: RoleSchema,
  deliverableSpec: z.string().min(1).max(MAX_DELIVERABLE_SPEC_CHARS).optional(),
  dependsOn: z.array(z.string()).max(MAX_SUBTASKS_HARD_CAP).default([]),
});

/** Depth-first cycle check over the (already existentially validated) dependency edges. */
function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of edges.keys()) colour.set(id, WHITE);

  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const state = colour.get(id) ?? WHITE;
    if (state === GREY) {
      const from = stack.indexOf(id);
      return [...(from >= 0 ? stack.slice(from) : stack), id];
    }
    if (state === BLACK) return null;
    colour.set(id, GREY);
    stack.push(id);
    for (const dep of edges.get(id) ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    colour.set(id, BLACK);
    return null;
  };

  for (const id of edges.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

const PlanBodySchema = z.strictObject({
  rationale: z.string().min(1).max(MAX_RATIONALE_CHARS),
  subtasks: z.array(PlannedSubtaskSchema).min(1).max(MAX_SUBTASKS_HARD_CAP),
});

/**
 * A whole plan. Strict, bounded, and acyclic — or it does not exist.
 *
 * Passing this parse is the *only* way to obtain a `Plan`, so a `Plan`
 * value is a proof of validity for every consumer downstream.
 */
export const PlanSchema = PlanBodySchema.superRefine((plan, ctx) => {
  const seen = new Set<string>();
  for (const [index, sub] of plan.subtasks.entries()) {
    if (seen.has(sub.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["subtasks", index, "id"],
        message: `duplicate subtask id '${sub.id}'`,
      });
    }
    seen.add(sub.id);
  }

  const ids = new Set(plan.subtasks.map((s) => s.id));
  for (const [index, sub] of plan.subtasks.entries()) {
    for (const dep of sub.dependsOn) {
      if (dep === sub.id) {
        ctx.addIssue({
          code: "custom",
          path: ["subtasks", index, "dependsOn"],
          message: `subtask '${sub.id}' cannot depend on itself`,
        });
        continue;
      }
      if (!ids.has(dep)) {
        ctx.addIssue({
          code: "custom",
          path: ["subtasks", index, "dependsOn"],
          message: `subtask '${sub.id}' depends on unknown subtask '${dep}'`,
        });
      }
    }
  }

  const cycle = findCycle(new Map(plan.subtasks.map((s) => [s.id, s.dependsOn] as const)));
  if (cycle) {
    ctx.addIssue({
      code: "custom",
      path: ["subtasks"],
      message: `dependency cycle: ${cycle.join(" -> ")}`,
    });
  }
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlannedSubtask = z.infer<typeof PlannedSubtaskSchema>;
export type PlanRole = z.infer<typeof RoleSchema>;

/**
 * Parses untrusted model output. Returns the plan or a flat list of readable
 * issues — never throws, never partially applies.
 */
export function parsePlan(
  raw: unknown,
): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  const parsed = PlanSchema.safeParse(raw);
  if (parsed.success) return { ok: true, plan: parsed.data };

  const errors = parsed.error.issues.map((issue) => {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
  return { ok: false, errors: errors.length ? errors : ["plan failed validation"] };
}
