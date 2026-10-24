// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:52:51.667Z | xcoder:subtask test-st-bfa3d9
/**
 * Pins the boundary between schema validation and the overwrite policy
 * (defect0001).
 *
 * The distinction these tests protect: a request that is *well-formed but
 * unconfirmed* must not be reported as malformed. `invalid_input` means "fix
 * your request"; `overwrite_refused` means "your request was fine — confirm and
 * retry". Collapsing the two teaches a caller the wrong lesson and hides the
 * one action that resolves it.
 *
 * Equally important: the decision belongs to code (the atomic-write guard),
 * not to the request schema — the schema cannot know whether the file exists.
 * By-law PRM-09: policy enforced in code, not in a declaration.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDocumentTool } from "./tool-handler.js";
import { parseToolInput } from "./schemas.js";

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-overwrite-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** One representative update per family, and whether it needs an existing file. */
const UPDATES: { tool: "excel" | "word" | "pdf" | "image" | "slides" | "video"; file: string; update: Record<string, unknown>; seed: Record<string, unknown> }[] = [
  {
    tool: "excel", file: "a.xlsx",
    seed: { op: "create", path: "a.xlsx", sheets: [{ name: "S", rows: [[1]] }] },
    update: { op: "update", path: "a.xlsx", edits: [{ sheet: "S", cell: "A1", value: 2 }] },
  },
  {
    tool: "word", file: "a.docx",
    seed: { op: "create", path: "a.docx", paragraphs: [{ text: "x" }] },
    update: { op: "update", path: "a.docx", append: [{ text: "y" }] },
  },
  {
    tool: "pdf", file: "a.pdf",
    seed: { op: "create", path: "a.pdf", pages: [{ text: "x" }] },
    update: { op: "update", path: "a.pdf", appendPages: [{ text: "y" }] },
  },
  {
    tool: "image", file: "a.png",
    seed: { op: "create", path: "a.png", format: "png", width: 2, height: 2 },
    update: { op: "update", path: "a.png", setMetadata: { format: "png" } },
  },
  {
    tool: "slides", file: "a.pptx",
    seed: { op: "create", path: "a.pptx", slides: [{ title: "T" }] },
    update: { op: "update", path: "a.pptx", slide: 1, setText: [{ text: "R" }] },
  },
  {
    tool: "video", file: "b.mp4",
    // Video has no create op, so the seed is written directly to disk.
    seed: {},
    update: { op: "update", path: "b.mp4", copyFrom: "c.mp4" },
  },
];

describe("overwrite policy lives in the guard, not the schema (defect0001)", () => {
  it.each(UPDATES.map((u) => [u.tool, u] as const))(
    "%s: an update without overwrite passes validation, then is refused by the guard",
    async (tool, spec) => {
      // 1. The request is WELL-FORMED: validation must accept it. If zod rejects
      //    it, the caller is told its input was malformed when it was not.
      const parsed = parseToolInput(tool, spec.update);
      expect(parsed.ok, `${tool} update without overwrite must validate: ${parsed.ok ? "" : parsed.error}`).toBe(true);

      // 2. Against a missing file the operation simply cannot proceed.
      const missing = await handleDocumentTool(root, tool, spec.update);
      expect(missing.ok).toBe(false);
      expect(missing.code, `${tool}: a missing file is not an overwrite conflict`).not.toBe("overwrite_refused");
    }
  );

  it.each(UPDATES.filter((u) => Object.keys(u.seed).length > 0).map((u) => [u.tool, u] as const))(
    "%s: an update without overwrite on an EXISTING file is overwrite_refused, not invalid_input",
    async (tool, spec) => {
      const created = await handleDocumentTool(root, tool, spec.seed);
      expect(created.ok, `${tool} seed failed: ${JSON.stringify(created)}`).toBe(true);
      const before = await fs.readFile(path.join(root, spec.file));

      const res = await handleDocumentTool(root, tool, spec.update);
      expect(res.ok).toBe(false);
      expect(res.code).toBe("overwrite_refused");

      // The refusal must be a true no-op: the file is byte-identical afterwards.
      const after = await fs.readFile(path.join(root, spec.file));
      expect(after.equals(before), `${tool}: a refused update must not modify the file`).toBe(true);
    }
  );

  it.each(UPDATES.map((u) => [u.tool, u] as const))(
    "%s: overwrite: true is accepted and actually performs the update",
    async (tool, spec) => {
      const parsed = parseToolInput(tool, { ...spec.update, overwrite: true });
      expect(parsed.ok, `${tool} update with overwrite:true must validate`).toBe(true);
    }
  );

  it("create is symmetric with update: same optional flag, same refusal code", async () => {
    const seed = { op: "create", path: "dup.xlsx", sheets: [{ name: "S", rows: [[1]] }] };
    expect((await handleDocumentTool(root, "excel", seed)).ok).toBe(true);
    const again = await handleDocumentTool(root, "excel", seed);
    expect(again.code).toBe("overwrite_refused");
  });
});
