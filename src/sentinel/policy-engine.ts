// xcoder:version 8 | xcoder:task task-239998 | xcoder:updated 2026-10-30T16:26:52.426Z | xcoder:subtask code-st-8f12c6
/**
 * The deterministic decision point. Every path from 'model says' to 'OS does'
 * crosses here. Pure: all state arrives via PolicyContext.
 */
import { randomUUID } from 'node:crypto';
import { RULES, type PolicyContext, type PolicyRule } from './policy/rules.js';
import { SEVERITY_RANK, type SentinelAction, type SecurityDecision } from './schema.js';

const ACTION_IMPACT: Readonly<Record<SentinelAction, number>> = {
  no_action: 0,
  alert: 1,
  block_ip: 2,
  unblock_ip: 3,
};

function deny(ctx: PolicyContext, reason: string, ruleId: string | null, severity: SecurityDecision['severity']): SecurityDecision {
  return {
    decisionId: randomUUID(),
    eventId: ctx.eventId,
    verdict: 'deny',
    action: 'no_action',
    reason,
    matchedRuleId: ruleId,
    severity,
    requiresApproval: false,
    model: ctx.model,
    decidedAt: ctx.now,
  };
}

/** Most severe deny wins: higher severityFloor, then action impact. */
function moreSevere(a: PolicyRule, b: PolicyRule): boolean {
  const sa = SEVERITY_RANK[a.severityFloor];
  const sb = SEVERITY_RANK[b.severityFloor];
  if (sa !== sb) return sa > sb;
  return ACTION_IMPACT[a.action] > ACTION_IMPACT[b.action];
}

export function evaluate(ctx: PolicyContext): SecurityDecision {
  // 1. Fail-closed preconditions. No usable policy => deny/no_action.
  if (!ctx.schemaValid) {
    return deny(ctx, 'schema invalid: analysis not trusted', null, 'high');
  }
  if (RULES.length === 0) {
    return deny(ctx, 'policy empty: default deny', null, 'high');
  }

  // 2. ADMIN_IP guard, first and unconditional. No rule can override it.
  const target = ctx.event.sourceIp;
  if (target !== undefined && ctx.allowlist.has(target)) {
    return deny(ctx, 'ADMIN_IP protected', 'core.admin_ip_protection', 'critical');
  }

  // 3. Collect every rule whose condition holds.
  const matched: PolicyRule[] = [];
  for (const rule of RULES) {
    let holds = false;
    try {
      holds = rule.when(ctx);
    } catch {
      holds = false;
    }
    if (holds) matched.push(rule);
  }

  // 5. No match => deny/no_action (default deny).
  if (matched.length === 0) {
    return deny(ctx, 'no rule matched: default deny', null, 'low');
  }

  // 4. DENY precedence; the most severe matching rule wins. Array order
  //    therefore cannot affect safety.
  let winner = matched[0];
  for (const rule of matched.slice(1)) {
    if (moreSevere(rule, winner)) winner = rule;
  }

  // 6. Verdict -> action table. A block_ip must still clear every gate.
  let action: SentinelAction = winner.action;
  let reason = 'rule ' + winner.id;
  if (action === 'block_ip') {
    const severityOk = ctx.analysis.severity === 'high' || ctx.analysis.severity === 'critical';
    const categoryOk =
      ctx.analysis.category === 'brute_force' ||
      ctx.analysis.category === 'port_scan' ||
      ctx.analysis.category === 'malicious_ip';
    const ipOk = target !== undefined;
    const alreadyBlocked = ipOk ? ctx.history.isBlocked(target as string) : true;
    if (!severityOk || !categoryOk || !ipOk || alreadyBlocked) {
      action = 'alert';
      reason = 'downgraded to alert from ' + winner.id;
      if (alreadyBlocked) reason += ' (already blocked)';
    }
  }

  // 7. Duration is always temporary; 'permanent' is not a value.
  const durationMinutes = action === 'block_ip' ? ctx.config.blockDurationMinutes : undefined;

  const decision: SecurityDecision = {
    decisionId: randomUUID(),
    eventId: ctx.eventId,
    verdict: 'deny',
    action,
    targetIp: action === 'block_ip' ? target : undefined,
    durationMinutes,
    reason,
    matchedRuleId: winner.id,
    severity: winner.severityFloor,
    requiresApproval: false,
    model: ctx.model,
    decidedAt: ctx.now,
  };

  // 8. HITL is forced for irreversible actions; a rule cannot opt out.
  if (decision.action === 'block_ip' || decision.action === 'unblock_ip') {
    decision.requiresApproval = true;
  }
  return decision;
}

export const policyEngine = { evaluate };
