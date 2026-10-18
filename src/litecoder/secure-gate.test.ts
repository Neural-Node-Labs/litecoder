// xcoder:version 1 | xcoder:task task-1f0256 | xcoder:updated 2026-10-17T14:37:45.671Z | xcoder:subtask code-st-9de79a
import { describe, it, expect } from "vitest";
import { BYLAW_SECTION_HEADER } from "../skills/bylaw-context.js";
import { BYLAW_GATED_ROLES, createSecureGate } from "./secure-gate.js";

describe("SecureGate — --secure off is a full opt-out (AC11)", () => {
  const off = createSecureGate("off");

  it("injects no bylaw text for any role", () => {
    for (const role of BYLAW_GATED_ROLES) {
      expect(off.promptBlock(role, "design a postgres migration")).toBeNull();
    }
  });

  it("produces no verdict, so security can never influence status", () => {
    for (const role of BYLAW_GATED_ROLES) {
      expect(off.judge(role, "design a postgres migration", { findings: [] })).toBeNull();
    }
  });
});

describe("SecureGate — --secure enforces through the frozen bylaws (AC10/AC12)", () => {
  const on = createSecureGate("enforce");

  it("injects the bylaws for a gated role, using the canonical header", () => {
    const block = on.promptBlock("architect", "design a REST API for users");
    expect(block).not.toBeNull();
    expect(block!.startsWith(BYLAW_SECTION_HEADER)).toBe(true);
    expect(block).toMatch(/## api/);
    expect(block).toMatch(/## core/);
  });

  it("injects nothing for a role that neither designs nor judges", () => {
    expect(on.promptBlock("programmer", "write the handler")).toBeNull();
  });

  it("blocks a deliverable with no findings, because every in-scope bylaw is unreviewed", () => {
    const verdict = on.judge("architect", "design a login flow", { summary: "done" });
    expect(verdict).not.toBeNull();
    expect(verdict!.approved).toBe(false);
    expect(verdict!.unreviewed.length).toBeGreaterThan(0);
  });

  it("approves when every in-scope bylaw is reported as passing", () => {
    const empty = on.judge("architect", "hello world", { findings: [] })!;
    const scope = [...empty.unreviewed, ...empty.blocking, ...empty.invalid];
    const findings = scope.map((bylawId) => ({ bylawId, status: "pass" }));

    const verdict = on.judge("architect", "hello world", { findings })!;
    expect(verdict.approved).toBe(true);
  });

  it("records a failed MUST as blocking, never as approved", () => {
    const empty = on.judge("architect", "hello world", { findings: [] })!;
    const first = empty.unreviewed[0];
    if (!first) return;

    const verdict = on.judge("architect", "hello world", {
      findings: [{ bylawId: first, status: "fail" }],
    })!;
    expect(verdict.approved).toBe(false);
    expect(verdict.blocking).toContain(first);
  });
});
