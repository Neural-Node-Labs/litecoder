// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:47:13.734Z | xcoder:subtask test-st-bfa3d9
/**
 * Conformance: every round-trip case PUBLISHED in ./new_tools_handoff must
 * actually pass against this implementation.
 *
 * Why this suite exists: design-contract/roundtrip/security prove the behaviour
 * we chose; this suite proves the *promise we shipped to the porting program*.
 * ROUNDTRIP_CASES is emitted verbatim into new_tools_handoff/tests/roundtrip-cases.json,
 * so a second program is expected to implement exactly these steps and expect
 * exactly these results. If our own implementation stops satisfying a published
 * case, the handoff becomes a lie — and nothing else in the repo would notice,
 * because the generator only checks parity of names, not of behaviour.
 *
 * A newly published case with no interpreter here fails loudly on purpose: the
 * handoff must never advertise a case that no test verifies.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDocumentTool } from "./tool-handler.js";
import { clearDocOperations } from "./doc-log.js";
import { ROUNDTRIP_CASES, SOURCE_VERSION, type RoundtripCase } from "./handoff-content.js";
import { encodeSolidPng } from "./image.js";

let root = "";

type StepResult = Record<string, unknown> & { ok?: boolean; code?: string };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-conformance-"));
  clearDocOperations();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Fixtures for cases that start from a file rather than creating one. Each is
 * the minimum input that still reaches the promised code path — e.g. an
 * encrypted PDF is recognised from its trailer, so it needs a real %PDF-
 * header, a page tree and an /Encrypt reference, but no valid xref.
 */
const CASE_FIXTURES: Record<string, () => Promise<void>> = {
  "pdf-encrypted-refused": async () => {
    const encrypted = [
      "%PDF-1.4",
      "1 0 obj",
      "<< /Type /Catalog /Pages 2 0 R >>",
      "endobj",
      "2 0 obj",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "endobj",
      "3 0 obj",
      "<< /Type /Page /Parent 2 0 R >>",
      "endobj",
      "4 0 obj",
      "<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) >>",
      "endobj",
      "trailer",
      "<< /Root 1 0 R /Encrypt 4 0 R >>",
      "%%EOF",
    ].join("\n");
    await fs.writeFile(path.join(root, "locked.pdf"), encrypted);
  },

  "video-read-mp4": async () => {
    // Minimal ISO-BMFF: a single ftyp box. Enough for container detection,
    // which is all the published case claims (structure walk, no decode).
    const ftyp = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isomiso2"),
    ]);
    await fs.writeFile(path.join(root, "clip.mp4"), ftyp);
  },

  "security-format-mismatch": async () => {
    // A real PNG wearing a .pdf extension: only magic bytes can catch this.
    const png = encodeSolidPng(2, 2, "#ffffff");
    if (!png.ok) throw new Error(`fixture failed: ${png.error}`);
    await fs.writeFile(path.join(root, "notreally.pdf"), png.value);
  },
};

async function runCase(c: RoundtripCase): Promise<StepResult[]> {
  await CASE_FIXTURES[c.id]?.();
  const results: StepResult[] = [];
  for (const step of c.steps) {
    results.push((await handleDocumentTool(root, c.tool, step)) as StepResult);
  }
  return results;
}

const textOf = (r: StepResult): string[] =>
  ((r.paragraphs ?? []) as { text: string }[]).map((p) => p.text);

describe.each(ROUNDTRIP_CASES.map((c) => [c.id, c] as const))("published handoff case %s", (id, c) => {
  it("satisfies every expectation the handoff publishes", async () => {
    const r = await runCase(c);

    switch (id) {
      case "excel-create-read-update": {
        const sheet = (r[3].sheets as { name: string; rows: unknown[][] }[])[0];
        expect(sheet.name).toBe(c.expect.finalSheetName);
        expect(sheet.rows[1][1]).toBe(c.expect.finalCellB2);
        expect(sheet.rows[1][0]).toBe(c.expect.finalCellA2);
        break;
      }

      case "excel-overwrite-guard":
      case "pdf-encrypted-refused":
      case "image-jpeg-create-refused":
      case "video-create-refused":
      case "security-format-mismatch":
      case "security-workspace-escape": {
        const step = c.steps.length === 1 ? r[0] : r[1];
        expect(step.ok).toBe(false);
        expect(step.code).toBe(c.expect.lastError);
        break;
      }

      case "security-overwrite-refused": {
        expect(r[1].ok).toBe(false);
        expect(r[1].code).toBe(c.expect.lastError);
        break;
      }

      case "word-create-append": {
        expect(textOf(r[1])).toEqual(c.expect.initialParagraphs);
        expect(((r[1].outline ?? []) as { text: string }[])[0].text).toBe(c.expect.outlineFirst);
        expect(textOf(r[3])).toContain(c.expect.finalParagraphsInclude);
        break;
      }

      case "word-replace-text": {
        expect(textOf(r[2])).toEqual(c.expect.finalParagraphs);
        break;
      }

      case "pdf-create-read-append": {
        expect(r[1].pageCount).toBe(c.expect.initialPageCount);
        expect(r[1].hasTextLayer).toBe(c.expect.hasTextLayer);
        expect((r[1].pages as { text: string }[])[0].text).toContain(c.expect.initialTextContains);
        expect(r[3].pageCount).toBe(c.expect.finalPageCount);
        break;
      }

      case "image-create-read": {
        const img = r[1] as { format: string; width: number; height: number; exif?: unknown };
        expect(img.format).toBe(c.expect.format);
        expect(img.width).toBe(c.expect.width);
        expect(img.height).toBe(c.expect.height);
        // EXIF is opt-in: a plain read must not volunteer it.
        expect(img.exif).toBeUndefined();
        break;
      }

      case "slides-create-read-update": {
        expect(r[3].slideCount).toBe(c.expect.slideCount);
        expect((r[1].slides as { title: string }[])[0].title).toBe(c.expect.firstTitleInitial);
        expect((r[3].slides as { title: string }[])[0].title).toBe(c.expect.firstTitleFinal);
        break;
      }

      case "video-read-mp4": {
        expect(r[0].ok).toBe(true);
        expect(r[0].container).toBe(c.expect.container);
        expect(Array.isArray(r[0].parseWarnings)).toBe(true);
        break;
      }

      default:
        throw new Error(
          `handoff case "${id}" is published but has no conformance interpretation. ` +
            "Add assertions here before shipping the case — an unverified published case is a false promise."
        );
    }
  });
});

describe("handoff metadata integrity", () => {
  it("describes the version this package actually is", () => {
    // The porting package claims to describe SOURCE_VERSION of this program. If
    // package.json moves and the handoff does not, a porting reader implements a
    // contract for a version that no longer exists.
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    expect(SOURCE_VERSION).toBe(pkg.version);
  });

  it("only publishes cases whose tool is one of the six document tools", () => {
    const tools = new Set(["excel", "word", "pdf", "image", "slides", "video"]);
    for (const c of ROUNDTRIP_CASES) {
      expect(tools.has(c.tool), `${c.id} names unknown tool ${c.tool}`).toBe(true);
      expect(c.steps.length, `${c.id} must have at least one step`).toBeGreaterThan(0);
      expect(c.intent.length, `${c.id} must explain its intent`).toBeGreaterThan(10);
    }
  });
});
