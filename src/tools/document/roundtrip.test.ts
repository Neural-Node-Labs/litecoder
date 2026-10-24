// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:26:12.964Z | xcoder:subtask code-st-39dbde
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDocumentTool } from "./tool-handler.js";
import { buildToolManifest, dispatchTool } from "../tool-registry.js";
import { clearDocOperations, recentDocOperations } from "./doc-log.js";
import { buildPdf, parsePdf } from "./pdf.js";
import { colToIndex, indexToCol } from "./excel.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-tools-"));
  clearDocOperations();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("manifest and dispatch wiring", () => {
  it("exposes all six document tools", () => {
    const manifest = buildToolManifest();
    for (const name of ["excel", "word", "pdf", "image", "slides", "video"]) {
      const entry = manifest.find((t) => t.name === name);
      expect(entry, `${name} must be in the manifest`).toBeDefined();
      expect(entry!.inputHint).toContain("op");
      expect(entry!.description.length).toBeGreaterThan(40);
    }
  });

  it("returns a typed error instead of throwing on a bad call", async () => {
    const res = await dispatchTool(root, "excel", { op: "read" });
    expect(res.tool).toBe("excel");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res.output)).toContain("path");
  });

  it("rejects an unknown tool name without crashing", async () => {
    const res = await dispatchTool(root, "excel_v2", { op: "read", path: "a.xlsx" });
    expect(res.ok).toBe(false);
  });
});

describe("excel", () => {
  it("round-trips create -> read -> update", async () => {
    const created = await handleDocumentTool(root, "excel", {
      op: "create",
      path: "book.xlsx",
      sheets: [{ name: "Sheet1", rows: [["name", "score"], ["ada", 42], ["grace", 97]] }],
    });
    expect(created).toMatchObject({ ok: true, relPath: "book.xlsx" });

    const read = await handleDocumentTool(root, "excel", { op: "read", path: "book.xlsx" });
    expect(read.ok).toBe(true);
    const sheets = read.sheets as { name: string; rows: unknown[][] }[];
    expect(sheets[0].name).toBe("Sheet1");
    expect(sheets[0].rows[1]).toEqual(["ada", 42]);

    const updated = await handleDocumentTool(root, "excel", {
      op: "update",
      path: "book.xlsx",
      edits: [{ sheet: "Sheet1", cell: "B2", value: 43 }],
      overwrite: true,
    });
    expect(updated.ok).toBe(true);

    const reread = await handleDocumentTool(root, "excel", { op: "read", path: "book.xlsx" });
    expect((reread.sheets as { rows: unknown[][] }[])[0].rows[1][1]).toBe(43);
  });

  it("refuses to overwrite without an explicit flag", async () => {
    await handleDocumentTool(root, "excel", { op: "create", path: "a.xlsx", sheets: [{ name: "S", rows: [[1]] }] });
    const again = await handleDocumentTool(root, "excel", { op: "create", path: "a.xlsx", sheets: [{ name: "S", rows: [[2]] }] });
    expect(again.ok).toBe(false);
    expect(again.code).toBe("overwrite_refused");
  });

  it("maps column letters both ways", () => {
    expect(colToIndex("A")).toBe(1);
    expect(colToIndex("AA")).toBe(27);
    expect(indexToCol(27)).toBe("AA");
    expect(indexToCol(colToIndex("BC"))).toBe("BC");
  });
});

describe("word", () => {
  it("round-trips create -> read -> append", async () => {
    const created = await handleDocumentTool(root, "word", {
      op: "create",
      path: "doc.docx",
      paragraphs: [{ text: "Title", style: "Heading1" }, { text: "Body text" }],
    });
    expect(created.ok).toBe(true);

    const read = await handleDocumentTool(root, "word", { op: "read", path: "doc.docx", includeOutline: true });
    const paragraphs = read.paragraphs as { text: string }[];
    expect(paragraphs.map((p) => p.text)).toEqual(["Title", "Body text"]);
    expect((read.outline as { text: string }[])[0].text).toBe("Title");

    const updated = await handleDocumentTool(root, "word", {
      op: "update",
      path: "doc.docx",
      append: [{ text: "Tail" }],
      overwrite: true,
    });
    expect(updated.ok).toBe(true);
    const reread = await handleDocumentTool(root, "word", { op: "read", path: "doc.docx" });
    expect((reread.paragraphs as { text: string }[]).map((p) => p.text)).toContain("Tail");
  });

  it("replaces matched text", async () => {
    await handleDocumentTool(root, "word", { op: "create", path: "r.docx", paragraphs: [{ text: "hello world" }] });
    const updated = await handleDocumentTool(root, "word", {
      op: "update",
      path: "r.docx",
      replace: [{ find: "world", replace: "there" }],
      overwrite: true,
    });
    expect(updated.ok).toBe(true);
    const read = await handleDocumentTool(root, "word", { op: "read", path: "r.docx" });
    expect((read.paragraphs as { text: string }[])[0].text).toBe("hello there");
  });
});

describe("pdf", () => {
  it("round-trips create -> read text -> append page", async () => {
    const created = await handleDocumentTool(root, "pdf", {
      op: "create",
      path: "n.pdf",
      pages: [{ text: "first page" }],
      metadata: { title: "Notes" },
    });
    expect(created.ok).toBe(true);

    const read = await handleDocumentTool(root, "pdf", { op: "read", path: "n.pdf" });
    expect(read.pageCount).toBe(1);
    expect((read.pages as { text: string }[])[0].text).toContain("first page");
    expect(read.hasTextLayer).toBe(true);

    const updated = await handleDocumentTool(root, "pdf", {
      op: "update",
      path: "n.pdf",
      appendPages: [{ text: "second page" }],
      overwrite: true,
    });
    expect(updated.ok).toBe(true);
    const reread = await handleDocumentTool(root, "pdf", { op: "read", path: "n.pdf" });
    expect(reread.pageCount).toBe(2);
  });

  it("produces a parseable object graph", () => {
    const built = buildPdf([{ text: "a" }, { text: "b" }]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parsePdf(built.value);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.objects.length).toBe(7);
  });

  it("logs a redacted record with no file contents", async () => {
    await handleDocumentTool(root, "pdf", { op: "create", path: "s.pdf", pages: [{ text: "TOP-SECRET-CONTENT" }] });
    const log = recentDocOperations();
    expect(log[log.length - 1].relPath).toBe("s.pdf");
    expect(JSON.stringify(log)).not.toContain("TOP-SECRET-CONTENT");
  });
});
