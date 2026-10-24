// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:26:20.851Z | xcoder:subtask code-st-39dbde
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDocumentTool } from "./tool-handler.js";
import { dispatchTool } from "../tool-registry.js";
import { clearDocOperations, recentDocOperations } from "./doc-log.js";
import { encodeSolidPng, readPngInfo } from "./image.js";
import { sniffFormat, requireDeclaredMatch, listZipEntryNames } from "./format-sniff.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-sec-"));
  clearDocOperations();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("image", () => {
  it("creates a valid PNG and reads its dimensions back", async () => {
    const created = await handleDocumentTool(root, "image", {
      op: "create",
      path: "px.png",
      format: "png",
      width: 8,
      height: 5,
      background: "#3366cc",
    });
    expect(created.ok).toBe(true);
    const read = await handleDocumentTool(root, "image", { op: "read", path: "px.png" });
    expect(read).toMatchObject({ ok: true, format: "png", width: 8, height: 5 });
    expect(read.exif).toBeUndefined(); // EXIF is opt-in only
  });

  it("refuses JPEG creation instead of silently writing a PNG", async () => {
    const res = await handleDocumentTool(root, "image", { op: "create", path: "photo.jpg", format: "jpg", width: 4, height: 4 });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("unsupported_feature");
  });

  it("rejects an oversized image before allocating", () => {
    const huge = encodeSolidPng(60000, 60000, "#000000");
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.code).toBe("limit_exceeded");
  });

  it("rejects a truncated PNG", () => {
    const info = readPngInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(info.ok).toBe(false);
  });
});

describe("slides", () => {
  it("round-trips create -> read -> replace slide text", async () => {
    const created = await handleDocumentTool(root, "slides", {
      op: "create",
      path: "deck.pptx",
      slides: [{ title: "Intro", bullets: ["one", "two"] }, { title: "Second", bullets: ["three"] }],
    });
    expect(created.ok).toBe(true);

    const read = await handleDocumentTool(root, "slides", { op: "read", path: "deck.pptx" });
    expect(read.slideCount).toBe(2);
    expect((read.slides as { title: string }[])[0].title).toBe("Intro");

    const updated = await handleDocumentTool(root, "slides", {
      op: "update",
      path: "deck.pptx",
      slide: 1,
      setText: [{ text: "Renamed" }],
      overwrite: true,
    });
    expect(updated.ok).toBe(true);
    const reread = await handleDocumentTool(root, "slides", { op: "read", path: "deck.pptx" });
    expect((reread.slides as { title: string }[])[0].title).toBe("Renamed");
  });

  it("rejects a slide index past the end", async () => {
    await handleDocumentTool(root, "slides", { op: "create", path: "d.pptx", slides: [{ title: "only" }] });
    const res = await handleDocumentTool(root, "slides", {
      op: "update",
      path: "d.pptx",
      slide: 9,
      setText: [{ text: "x" }],
      overwrite: true,
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("invalid_input");
  });
});

describe("video", () => {
  it("has no create op", async () => {
    const res = await dispatchTool(root, "video", { op: "create", path: "a.mp4" });
    expect(res.ok).toBe(false);
  });

  it("rejects non-video bytes behind an .mp4 name", async () => {
    await fs.writeFile(path.join(root, "fake.mp4"), Buffer.from("not a video at all"));
    const read = await handleDocumentTool(root, "video", { op: "read", path: "fake.mp4" });
    expect(read.ok).toBe(false);
    expect(["unsupported_format", "format_mismatch"]).toContain(read.code);
  });

  it("reads MP4 container metadata and degrades without throwing", async () => {
    const ftyp = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isomiso2"),
    ]);
    await fs.writeFile(path.join(root, "clip.mp4"), ftyp);
    const read = await handleDocumentTool(root, "video", { op: "read", path: "clip.mp4" });
    expect(read.ok).toBe(true);
    expect(read.container).toBe("mp4");
    expect(Array.isArray(read.parseWarnings)).toBe(true);
  });
});

describe("security contract", () => {
  it("refuses a path that escapes the workspace", async () => {
    const res = await handleDocumentTool(root, "excel", { op: "read", path: "../outside.xlsx" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("workspace_escape");
  });

  it("refuses a drive-absolute path at schema level", async () => {
    const res = await handleDocumentTool(root, "excel", { op: "read", path: "C:\\Windows\\x.xlsx" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("invalid_input");
  });

  it("magic bytes win over the declared extension", async () => {
    const png = encodeSolidPng(2, 2, "#ffffff");
    expect(png.ok).toBe(true);
    if (!png.ok) return;
    await fs.writeFile(path.join(root, "notreally.pdf"), png.value);
    const res = await handleDocumentTool(root, "pdf", { op: "read", path: "notreally.pdf" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("format_mismatch");
    expect(String(res.error)).toContain("png");
  });

  it("identifies OLE containers and refuses them as encrypted OOXML", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const sniffed = sniffFormat(ole);
    expect(sniffed.format).toBe("ole");
    const verdict = requireDeclaredMatch(".docx", sniffed);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("password_protected");
  });

  it("returns null rather than throwing on a corrupt ZIP", () => {
    expect(listZipEntryNames(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBeNull();
  });

  it("logs a redacted record with no file contents or absolute paths", async () => {
    await handleDocumentTool(root, "word", {
      op: "create",
      path: "secret.docx",
      paragraphs: [{ text: "TOP-SECRET-CONTENT" }],
    });
    const log = recentDocOperations();
    const last = log[log.length - 1];
    expect(last.tool).toBe("word");
    expect(last.relPath).toBe("secret.docx");
    expect(JSON.stringify(log)).not.toContain("TOP-SECRET-CONTENT");
    expect(JSON.stringify(log)).not.toContain(root.replace(/\\/g, "\\\\"));
  });
});
