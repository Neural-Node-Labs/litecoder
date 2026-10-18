// xcoder:version 3 | xcoder:task task-f1ac77 | xcoder:updated 2026-10-17T10:29:00.692Z | xcoder:subtask test-st-304810
import { describe, it, expect } from 'vitest';
import {
  BYLAWS,
  SKILL_META,
  evaluateReview,
  inferLayers,
  renderBylaws,
  getBylawById,
  getBylawsByLayer,
  getBylawsByLevel,
  type Bylaw,
  type BylawFinding,
  type BylawLayer,
} from './secure-architect.bylaws.js';
import { parseBylawFindings, reviewDeliverable, describeReview } from './bylaw-review.js';
import { buildBylawContext, BYLAW_GATED_STAGES, BYLAW_SECTION_HEADER } from './bylaw-context.js';

const ALL_LAYERS: readonly BylawLayer[] = Array.from(new Set(BYLAWS.map((b) => b.layer)));
const inScope = (layers?: readonly BylawLayer[]): readonly Bylaw[] =>
  layers ? BYLAWS.filter((b) => layers.includes(b.layer)) : BYLAWS;
const passAll = (layers?: readonly BylawLayer[]): BylawFinding[] =>
  inScope(layers).map((b) => ({ bylawId: b.id, status: 'pass' as const }));
const passAllExcept = (
  layers: readonly BylawLayer[],
  override: Partial<BylawFinding> & { bylawId: string },
): BylawFinding[] =>
  inScope(layers).map((b) =>
    b.id === override.bylawId
      ? ({ status: 'pass', ...override } as BylawFinding)
      : { bylawId: b.id, status: 'pass' as const },
  );

const mustBylaw = BYLAWS.find((b) => b.level === 'MUST')!;
const mustNotBylaw = BYLAWS.find((b) => b.level === 'MUST_NOT')!;
const shouldBylaw = BYLAWS.find((b) => b.level === 'SHOULD')!;

describe('frozen bylaw corpus', () => {
  it('has unique, complete, immutable records', () => {
    expect(BYLAWS.length).toBeGreaterThan(0);
    const ids = BYLAWS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.isFrozen(BYLAWS)).toBe(true);
    for (const b of BYLAWS) {
      expect(Object.isFrozen(b)).toBe(true);
      expect(b.id.trim().length).toBeGreaterThan(0);
      expect(['MUST', 'MUST_NOT', 'SHOULD']).toContain(b.level);
      expect(ALL_LAYERS).toContain(b.layer);
      expect(b.title.trim()).not.toBe('');
      expect(b.rule.trim()).not.toBe('');
      expect(getBylawById(b.id)).toBe(b);
    }
  });

  it('covers every normative level and the always-applicable layers', () => {
    for (const level of ['MUST', 'MUST_NOT', 'SHOULD'] as const) {
      expect(getBylawsByLevel(level).length).toBeGreaterThan(0);
    }
    expect(getBylawsByLayer('core').length).toBeGreaterThan(0);
    expect(getBylawsByLayer('cross-cutting').length).toBeGreaterThan(0);
    expect(getBylawById('does-not-exist')).toBeUndefined();
  });
});

describe('inferLayers', () => {
  it('always applies core and cross-cutting and invents nothing else', () => {
    expect(inferLayers('rename a private helper')).toEqual(['core', 'cross-cutting']);
    expect(inferLayers('')).toEqual(['core', 'cross-cutting']);
  });

  it('infers each keyword-scoped layer from the task text', () => {
    const cases: ReadonlyArray<readonly [string, BylawLayer]> = [
      ['implement login with JWT sessions', 'authentication'],
      ['add a postgres database migration', 'database'],
      ['harden against prompt injection and jailbreak', 'prompt'],
      ['call the LLM inference endpoint', 'ai'],
      ['build the react frontend', 'ui'],
      ['deploy the docker container to kubernetes', 'microservices'],
      ['expose a REST endpoint', 'api'],
      ['harden the ubuntu server over ssh', 'server-linux'],
      ['configure IIS and RDP on windows', 'server-windows'],
    ];
    for (const [text, layer] of cases) {
      const layers = inferLayers(text);
      expect(layers).toContain(layer);
      expect(layers).toContain('core');
      expect(layers).toContain('cross-cutting');
    }
  });

  it('is case-insensitive and deterministic', () => {
    expect(inferLayers('AUTH LOGIN')).toEqual(inferLayers('auth login'));
    expect(inferLayers('database migration')).toEqual(inferLayers('database migration'));
  });
});

describe('renderBylaws', () => {
  it('renders only the requested layers and their bylaws', () => {
    const text = renderBylaws(['authentication']);
    for (const b of getBylawsByLayer('authentication')) expect(text).toContain(b.id);
    for (const b of getBylawsByLayer('database')) expect(text).not.toContain(b.id);
    expect(text).toContain(SKILL_META.name);
    expect(text).toContain(SKILL_META.version);
  });

  it('renders the full corpus when no scope is given', () => {
    const text = renderBylaws();
    for (const b of BYLAWS) expect(text).toContain(b.id);
  });

  it('formats every law as an answerable normative bullet', () => {
    const bullets = renderBylaws().split('\n').filter((l) => l.startsWith('- ['));
    expect(bullets).toHaveLength(BYLAWS.length);
    for (const line of bullets) {
      expect(line).toMatch(/^- \[[A-Za-z0-9_.-]+\] (MUST|MUST_NOT|SHOULD) - .+: .+$/);
    }
  });

  it('is deterministic', () => {
    expect(renderBylaws(['core', 'api'])).toBe(renderBylaws(['core', 'api']));
  });
});

describe('evaluateReview', () => {
  it('fails closed when nothing was reported', () => {
    const r = evaluateReview([], ALL_LAYERS);
    expect(r.approved).toBe(false);
    expect(r.unreviewed).toEqual(expect.arrayContaining(BYLAWS.map((b) => b.id)));
  });

  it('approves a complete passing review and accepts not-applicable', () => {
    expect(evaluateReview(passAll(ALL_LAYERS), ALL_LAYERS).approved).toBe(true);
    const na = passAll(ALL_LAYERS).map((f) => ({ ...f, status: 'not-applicable' as const }));
    expect(evaluateReview(na, ALL_LAYERS).approved).toBe(true);
    expect(reviewDeliverable({ findings: passAll(ALL_LAYERS) }, ALL_LAYERS).approved).toBe(true);
  });

  it('only requires findings for in-scope bylaws', () => {
    const layers: readonly BylawLayer[] = ['core'];
    expect(evaluateReview(passAll(layers), layers).approved).toBe(true);
    const partial = passAll(layers).slice(1);
    expect(evaluateReview(partial, layers).unreviewed).toContain(passAll(layers)[0].bylawId);
  });

  it('blocks a failed MUST and MUST_NOT', () => {
    for (const b of [mustBylaw, mustNotBylaw]) {
      const layers: readonly BylawLayer[] = [b.layer];
      const r = evaluateReview(passAllExcept(layers, { bylawId: b.id, status: 'fail' }), layers);
      expect(r.approved).toBe(false);
      expect(r.blocking).toContain(b.id);
    }
  });

  it('never accepts risk on MUST/MUST_NOT, even with a named owner', () => {
    for (const b of [mustBylaw, mustNotBylaw]) {
      const layers: readonly BylawLayer[] = [b.layer];
      const r = evaluateReview(
        passAllExcept(layers, { bylawId: b.id, status: 'accepted-risk', riskOwner: 'ciso' }),
        layers,
      );
      expect(r.approved).toBe(false);
      expect(r.invalid).toContain(b.id);
    }
  });

  it('requires a named risk owner for a SHOULD deviation', () => {
    const layers: readonly BylawLayer[] = [shouldBylaw.layer];
    const anonymous = evaluateReview(
      passAllExcept(layers, { bylawId: shouldBylaw.id, status: 'accepted-risk' }),
      layers,
    );
    expect(anonymous.approved).toBe(false);
    expect(anonymous.invalid).toContain(shouldBylaw.id);

    const owned = passAllExcept(layers, {
      bylawId: shouldBylaw.id,
      status: 'accepted-risk',
      riskOwner: 'head-of-platform',
    });
    expect(evaluateReview(owned, layers).approved).toBe(true);
  });

  it('blocks a failed SHOULD', () => {
    const layers: readonly BylawLayer[] = [shouldBylaw.layer];
    expect(
      evaluateReview(passAllExcept(layers, { bylawId: shouldBylaw.id, status: 'fail' }), layers)
        .approved,
    ).toBe(false);
  });

  it('treats an omitted bylaw as unreviewed and lets a later duplicate win', () => {
    const layers: readonly BylawLayer[] = [mustBylaw.layer];
    const base = passAll(layers).filter((f) => f.bylawId !== mustBylaw.id);
    expect(evaluateReview(base, layers).unreviewed).toContain(mustBylaw.id);
    const duped = [
      ...base,
      { bylawId: mustBylaw.id, status: 'fail' as const },
      { bylawId: mustBylaw.id, status: 'pass' as const },
    ];
    expect(evaluateReview(duped, layers).approved).toBe(true);
  });

  it('returns a frozen verdict', () => {
    const r = evaluateReview(passAll(ALL_LAYERS), ALL_LAYERS);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.blocking)).toBe(true);
  });
});

describe('parseBylawFindings', () => {
  it('accepts arrays, envelopes and JSON strings', () => {
    expect(parseBylawFindings([{ bylawId: 'a', status: 'pass' }])[0].bylawId).toBe('a');
    expect(parseBylawFindings({ findings: [{ bylawId: 'b', status: 'fail' }] })[0].status).toBe(
      'fail',
    );
    expect(
      parseBylawFindings(JSON.stringify([{ bylawId: 'c', status: 'not-applicable' }])),
    ).toHaveLength(1);
    expect(
      parseBylawFindings(JSON.stringify({ findings: [{ bylawId: 'd', status: 'pass' }] })),
    ).toHaveLength(1);
  });

  it('preserves note and riskOwner', () => {
    const [f] = parseBylawFindings([
      { bylawId: 'x', status: 'accepted-risk', note: 'deferred to Q3', riskOwner: 'ciso' },
    ]);
    expect(f.note).toBe('deferred to Q3');
    expect(f.riskOwner).toBe('ciso');
  });

  it('drops malformed entries and never throws', () => {
    const kept = parseBylawFindings([
      { bylawId: 'ok', status: 'pass' },
      { bylawId: '', status: 'pass' },
      { bylawId: 'bad-status', status: 'approved' },
      { bylawId: 7, status: 'pass' },
      'x',
      null,
      42,
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].bylawId).toBe('ok');
    for (const bad of [null, undefined, 42, 'not json', { findings: 'nope' }, { text: 'x' }, [], {}]) {
      expect(parseBylawFindings(bad)).toEqual([]);
    }
  });

  it('turns an unknown status into a blocking, fail-closed review', () => {
    const layers: readonly BylawLayer[] = [mustBylaw.layer];
    const findings = passAllExcept(layers, {
      bylawId: mustBylaw.id,
      status: 'approved' as unknown as BylawFinding['status'],
    });
    const r = reviewDeliverable({ findings }, layers);
    expect(r.approved).toBe(false);
    expect(r.unreviewed).toContain(mustBylaw.id);
  });
});

describe('reviewDeliverable and describeReview', () => {
  it('fails closed on an empty deliverable', () => {
    const r = reviewDeliverable({ findings: [] }, ALL_LAYERS);
    expect(r.approved).toBe(false);
    expect(r.unreviewed).toHaveLength(BYLAWS.length);
    expect(r.findings).toEqual([]);
  });

  it('exposes the parsed findings on the result', () => {
    const findings = passAll(ALL_LAYERS);
    expect(reviewDeliverable({ findings }, ALL_LAYERS).findings).toHaveLength(findings.length);
  });

  it('delegates the verdict to evaluateReview rather than inventing one', () => {
    const layers: readonly BylawLayer[] = [mustBylaw.layer];
    const findings = passAllExcept(layers, { bylawId: mustBylaw.id, status: 'fail' });
    const viaAdapter = reviewDeliverable({ findings }, layers);
    const authority = evaluateReview(findings, layers);
    expect(viaAdapter.approved).toBe(authority.approved);
    expect(viaAdapter.blocking).toEqual(authority.blocking);
    expect(viaAdapter.unreviewed).toEqual(authority.unreviewed);
    expect(viaAdapter.invalid).toEqual(authority.invalid);
  });

  it('describes approval and names each outstanding bylaw when blocked', () => {
    expect(describeReview(evaluateReview(passAll(ALL_LAYERS), ALL_LAYERS))).toBe(
      'bylaw review approved',
    );

    const layers: readonly BylawLayer[] = [mustBylaw.layer];
    const blocked = evaluateReview(
      passAllExcept(layers, { bylawId: mustBylaw.id, status: 'fail' }),
      layers,
    );
    const text = describeReview(blocked);
    expect(text).toContain('blocked:');
    expect(text).toContain(mustBylaw.id);

    const missing = evaluateReview(passAll(layers).slice(1), layers);
    expect(describeReview(missing)).toContain('unreviewed');
  });
});

describe('buildBylawContext', () => {
  const goal = 'design the authentication service';

  it('gates exactly the design and quality_gate stages', () => {
    expect([...BYLAW_GATED_STAGES].sort()).toEqual(['design', 'quality_gate']);
    expect(buildBylawContext({ stage: 'design', role: 'system-architect', goal })).not.toBeNull();
    expect(buildBylawContext({ stage: 'quality_gate', role: 'security-lead', goal })).not.toBeNull();
    for (const stage of ['requirements', 'code', 'test', 'deploy'] as const) {
      expect(buildBylawContext({ stage, role: 'programmer', goal })).toBeNull();
    }
  });

  it('renders the header plus exactly the layers the goal implicates', () => {
    const input = {
      stage: 'design',
      role: 'system-architect',
      goal: 'implement login with JWT',
    } as const;
    const ctx = buildBylawContext(input)!;
    expect(ctx.text.startsWith(BYLAW_SECTION_HEADER)).toBe(true);
    expect(ctx.layers).toEqual(inferLayers(input.goal));
    expect(ctx.layers).toContain('core');
    expect(ctx.layers).toContain('authentication');
    expect(ctx.text).toContain(renderBylaws(ctx.layers));
    for (const b of BYLAWS.filter((x) => ctx.layers.includes(x.layer))) {
      expect(ctx.text).toContain(b.id);
    }
  });

  it('keeps unrelated layers out of the prompt', () => {
    const ctx = buildBylawContext({
      stage: 'quality_gate',
      role: 'security-lead',
      goal: 'login flow review',
    })!;
    expect(ctx.layers).not.toContain('database');
    for (const b of getBylawsByLayer('database')) expect(ctx.text).not.toContain(b.id);
  });

  it('is deterministic and safe on an empty goal', () => {
    const input = { stage: 'design', role: 'system-architect', goal: 'auth and storage' } as const;
    expect(buildBylawContext(input)!.text).toBe(buildBylawContext(input)!.text);
    expect(buildBylawContext({ ...input, goal: '' })!.layers).toEqual(['core', 'cross-cutting']);
  });

  it('closes the loop: a security-lead JSON deliverable yields the acceptance verdict', () => {
    const ctx = buildBylawContext({
      stage: 'quality_gate',
      role: 'security-lead',
      goal: 'review login auth',
    })!;
    expect(reviewDeliverable(JSON.stringify({ findings: passAll(ctx.layers) }), ctx.layers).approved).toBe(
      true,
    );

    const blockedId = inScope(ctx.layers)[0].id;
    const partial = JSON.stringify({
      findings: passAll(ctx.layers).filter((f) => f.bylawId !== blockedId),
    });
    const verdict = reviewDeliverable(partial, ctx.layers);
    expect(verdict.approved).toBe(false);
    expect(verdict.unreviewed).toContain(blockedId);
    expect(describeReview(verdict)).toContain(blockedId);
  });
});
