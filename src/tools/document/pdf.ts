// xcoder:version 2 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:23:56.249Z | xcoder:subtask code-st-39dbde
import zlib from "node:zlib";
import { FAMILY_LIMITS } from "./limits.js";
import { fail, ok, type AdapterResult, type FormatAdapter } from "./types.js";

/**
 * PDF adapter (design C9).
 *
 * A small, dependency-free PDF reader/writer. It reads the page tree and pulls
 * text out of FlateDecode content streams; it writes a fresh, well-formed PDF
 * for `create` and a rewritten object graph for `update`. Anything it cannot
 * parse confidently — encrypted files, cross-reference streams, object streams —
 * is refused with a typed error rather than guessed at (tradeoff T1).
 */

interface PdfObject {
  num: number;
  gen: number;
  body: string;
}

interface PdfDoc {
  objects: PdfObject[];
  trailer: string;
  maxNum: number;
}

const OBJ_HEADER = /(?:^|[\r\n])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;

/** Split a PDF into top-level objects. Refuses encrypted / object-stream files. */
export function parsePdf(bytes: Uint8Array): AdapterResult<PdfDoc> {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  if (!text.startsWith("%PDF-")) return fail("corrupt_input", "missing %PDF- header.");
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(text) || /\/Encrypt\s*<</.test(text)) {
    return fail("password_protected", "this PDF is encrypted; decrypt it before use — these tools never brute-force a password.");
  }
  if (/\/Type\s*\/XRef\b/.test(text) || /\/Type\s*\/ObjStm\b/.test(text)) {
    return fail("unsupported_feature", "this PDF uses cross-reference or object streams, which this reader does not support.");
  }

  const headers: { num: number; gen: number; start: number; bodyStart: number }[] = [];
  OBJ_HEADER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OBJ_HEADER.exec(text)) !== null) {
    headers.push({ num: Number(m[1]), gen: Number(m[2]), start: m.index + (m[0].length - m[0].trimStart().length), bodyStart: m.index + m[0].length });
  }
  if (headers.length === 0) return fail("corrupt_input", "no PDF objects found.");

  const objects: PdfObject[] = [];
  let maxNum = 0;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const limit = i + 1 < headers.length ? headers[i + 1].start : text.length;
    const slice = text.slice(h.bodyStart, limit);
    const end = slice.lastIndexOf("endobj");
    if (end < 0) continue;
    objects.push({ num: h.num, gen: h.gen, body: slice.slice(0, end) });
    if (h.num > maxNum) maxNum = h.num;
  }
  const trailerMatch = /trailer\s*<<([\s\S]*?)>>/.exec(text);
  return ok({ objects, trailer: trailerMatch ? trailerMatch[1] : "", maxNum });
}

/** Inflate a stream body when the object declares a Flate filter. */
function streamText(body: string): string {
  const sIdx = body.indexOf("stream");
  if (sIdx < 0) return "";
  let dataStart = sIdx + "stream".length;
  if (body[dataStart] === "\r") dataStart++;
  if (body[dataStart] === "\n") dataStart++;
  const eIdx = body.lastIndexOf("endstream");
  if (eIdx <= dataStart) return "";
  const raw = Buffer.from(body.slice(dataStart, eIdx), "latin1");
  const dict = body.slice(0, sIdx);
  if (/\/FlateDecode/.test(dict)) {
    try {
      return zlib.inflateSync(raw, { maxOutputLength: 32 * 1024 * 1024 }).toString("latin1");
    } catch {
      return "";
    }
  }
  if (/\/Filter/.test(dict)) return ""; // unsupported filter — no text, but not fatal
  return raw.toString("latin1");
}

/** Pull visible text out of a content stream (Tj, TJ, ' and " operators). */
export function textFromContent(content: string): string {
  const parts: string[] = [];
  const re = /\(((?:\\.|[^()\\])*)\)\s*(?:Tj|TJ|'|")|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined) {
      parts.push(decodePdfString(m[1]));
    } else if (m[2] !== undefined) {
      const inner = m[2];
      const strRe = /\(((?:\\.|[^()\\])*)\)/g;
      let s: RegExpExecArray | null;
      let chunk = "";
      while ((s = strRe.exec(inner)) !== null) chunk += decodePdfString(s[1]);
      if (chunk) parts.push(chunk);
    }
  }
  return parts.join(" ").replace(/[ \t]+/g, " ").trim();
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) =>
      c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c === "b" ? "\b" : c === "f" ? "\f" : c
    )
    .replace(/\\([0-7]{1,3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
}

/** Count `/Type /Page` objects (excluding `/Pages`). */
export function countPages(doc: PdfDoc): number {
  let n = 0;
  for (const o of doc.objects) if (/\/Type\s*\/Page[^s]/.test(o.body) || /\/Type\s*\/Page\s*$/.test(o.body.trim())) n++;
  return n;
}

function escapePdfText(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Wrap one text block into 72-column lines, ASCII-safe for the base font. */
function wrap(text: string, width = 88): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/[^\x20-\x7e]/g, "?");
    if (line.length === 0) {
      out.push("");
      continue;
    }
    while (line.length > width) {
      let cut = line.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      out.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out;
}

export interface PdfPageSpec {
  text: string;
}

/** Build a fresh PDF from page texts. Object layout is fixed and predictable. */
export function buildPdf(pages: PdfPageSpec[], metadata?: Record<string, string>): AdapterResult<Uint8Array> {
  if (pages.length === 0) return fail("invalid_input", "a PDF needs at least one page.");

  // Fixed object numbering keeps the xref table trivially correct:
  //   1 = Catalog, 2 = Pages, 3+2i = page i, 4+2i = its content stream,
  //   then the font, then (optionally) the Info dictionary.
  const catalogNum = 1;
  const pagesNum = 2;
  const fontNum = 3 + pages.length * 2;
  const infoNum = fontNum + 1;
  const totalObjects = fontNum + (metadata ? 1 : 0);

  const out: string[] = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets: number[] = new Array(totalObjects).fill(0);
  let at = out[0].length;
  const emit = (num: number, body: string) => {
    const s = `${num} 0 obj\n${body}\nendobj\n`;
    offsets[num - 1] = at;
    out.push(s);
    at += s.length;
  };

  const kids = pages.map((_p, i) => `${3 + i * 2} 0 R`).join(" ");
  emit(catalogNum, `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
  emit(
    pagesNum,
    `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`
  );

  pages.forEach((page, i) => {
    const pageNum = 3 + i * 2;
    const contentNum = pageNum + 1;
    emit(pageNum, `<< /Type /Page /Parent ${pagesNum} 0 R /Contents ${contentNum} 0 R >>`);
    const lines = wrap(page.text);
    const ops = lines
      .map((line, li) => (line ? `BT /F1 11 Tf 1 0 0 1 54 ${740 - li * 16} Tm (${escapePdfText(line)}) Tj ET` : ""))
      .filter(Boolean)
      .join("\n");
    const stream = `${ops}\n`;
    emit(contentNum, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`);
  });

  emit(fontNum, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  if (metadata) {
    const entries = Object.entries(metadata)
      .filter(([, v]) => typeof v === "string" && v !== "")
      .map(([k, v]) => `/${k} (${escapePdfText(v.replace(/[^\x20-\x7e]/g, "?"))})`)
      .join(" ");
    emit(infoNum, `<< ${entries} >>`);
  }

  const xrefAt = at;
  const xref = ["xref", `0 ${totalObjects + 1}`, "0000000000 65535 f "];
  for (let i = 0; i < totalObjects; i++) xref.push(`${String(offsets[i]).padStart(10, "0")} 00000 n `);
  out.push(xref.join("\n") + "\n");
  out.push(
    `trailer\n<< /Size ${totalObjects + 1} /Root ${catalogNum} 0 R${metadata ? ` /Info ${infoNum} 0 R` : ""} >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`
  );
  return ok(new Uint8Array(Buffer.from(out.join(""), "latin1")));
}

export const pdfAdapter: FormatAdapter = {
  family: "pdf",
  extensions: [".pdf"],
  ops: ["read", "create", "update"],
  limits: FAMILY_LIMITS.pdf,

  async read(bytes, args): Promise<AdapterResult<Record<string, unknown>>> {
    const parsed = parsePdf(bytes);
    if (!parsed.ok) return parsed;
    const doc = parsed.value;
    const maxPages = typeof args.maxPages === "number" ? args.maxPages : pdfAdapter.limits.maxUnits;

    const pageObjs = doc.objects.filter((o) => /\/Type\s*\/Page[^s]/.test(o.body) || /\/Type\s*\/Page\s*$/.test(o.body.trim()));
    const pages: Record<string, unknown>[] = [];
    let hasTextLayer = false;
    for (let i = 0; i < pageObjs.length && i < maxPages; i++) {
      const obj = pageObjs[i];
      const contentRefs = [...obj.body.matchAll(/\/Contents\s+(?:(\d+)\s+\d+\s+R|\[([^\]]*)\])/g)];
      let text = "";
      for (const ref of contentRefs) {
        const nums = ref[1] ? [Number(ref[1])] : [...(ref[2] ?? "").matchAll(/(\d+)\s+\d+\s+R/g)].map((r) => Number(r[1]));
        for (const n of nums) {
          const target = doc.objects.find((o) => o.num === n);
          if (target) text += (text ? "\n" : "") + textFromContent(streamText(target.body));
        }
      }
      if (!text) {
        const inline = streamText(obj.body);
        if (inline) text = textFromContent(inline);
      }
      if (text.trim()) hasTextLayer = true;
      const truncated = text.length > 20000;
      pages.push({ index: i, text: truncated ? text.slice(0, 20000) : text, textTruncated: truncated });
    }

    const infoObj = doc.objects.find((o) => /\/Producer|\/Title|\/Author/.test(o.body) && !/\/Type/.test(o.body));
    const metadata: Record<string, string> = {};
    if (infoObj) {
      for (const mm of infoObj.body.matchAll(/\/(Title|Author|Subject|Keywords|Producer)\s*\(((?:\\.|[^()\\])*)\)/g)) {
        metadata[mm[1].toLowerCase()] = decodePdfString(mm[2]);
      }
    }

    return ok({
      pageCount: pageObjs.length,
      pages,
      metadata,
      hasTextLayer,
      truncated: pageObjs.length > maxPages,
    });
  },

  async create(args): Promise<AdapterResult<Uint8Array>> {
    const raw = Array.isArray(args.pages) ? (args.pages as { text?: unknown }[]) : [];
    if (raw.length === 0) return fail("invalid_input", "create needs at least one page.");
    if (raw.length > pdfAdapter.limits.maxUnits) {
      return fail("limit_exceeded", `${raw.length} pages requested, above the ${pdfAdapter.limits.maxUnits}-page limit.`);
    }
    const md = args.metadata as Record<string, string> | undefined;
    return buildPdf(
      raw.map((p) => ({ text: typeof p.text === "string" ? p.text : "" })),
      md && typeof md === "object" ? md : undefined
    );
  },

  async update(bytes, args): Promise<AdapterResult<Uint8Array>> {
    if (args.mergeFrom !== undefined) {
      return fail(
        "unsupported_feature",
        "mergeFrom is not implemented: merging two object graphs correctly requires renumbering every reference, which this version deliberately does not attempt. Create the combined document from its page texts instead."
      );
    }
    const parsed = parsePdf(bytes);
    if (!parsed.ok) return parsed;
    const doc = parsed.value;

    // Reconstruct current page texts, then rewrite the whole document.
    const pageObjs = doc.objects.filter((o) => /\/Type\s*\/Page[^s]/.test(o.body) || /\/Type\s*\/Page\s*$/.test(o.body.trim()));
    const texts: string[] = [];
    for (const obj of pageObjs) {
      let text = "";
      for (const ref of obj.body.matchAll(/\/Contents\s+(\d+)\s+\d+\s+R/g)) {
        const target = doc.objects.find((o) => o.num === Number(ref[1]));
        if (target) text += (text ? "\n" : "") + textFromContent(streamText(target.body));
      }
      texts.push(text);
    }

    const appended = Array.isArray(args.appendPages) ? (args.appendPages as { text?: unknown }[]) : [];
    for (const p of appended) texts.push(typeof p.text === "string" ? p.text : "");
    if (texts.length === 0) return fail("invalid_input", "update would produce a PDF with no pages.");
    if (texts.length > pdfAdapter.limits.maxUnits) {
      return fail("limit_exceeded", `result would have ${texts.length} pages, above the ${pdfAdapter.limits.maxUnits}-page limit.`);
    }

    const existingMeta: Record<string, string> = {};
    const infoObj = doc.objects.find((o) => /\/Producer|\/Title|\/Author/.test(o.body) && !/\/Type/.test(o.body));
    if (infoObj) {
      for (const mm of infoObj.body.matchAll(/\/(Title|Author|Subject|Keywords)\s*\(((?:\\.|[^()\\])*)\)/g)) {
        existingMeta[mm[1]] = decodePdfString(mm[2]);
      }
    }
    const md = args.metadata as Record<string, string> | undefined;
    const merged: Record<string, string> = { ...existingMeta };
    if (md && typeof md === "object") {
      for (const key of ["Title", "Author", "Subject", "Keywords"]) {
        const value = (md as Record<string, unknown>)[key.toLowerCase()];
        if (typeof value === "string" && value !== "") merged[key] = value;
      }
    }

    if (appended.length === 0 && Object.keys(merged).length === 0) {
      return fail("invalid_input", "update found nothing to change: supply appendPages or metadata.");
    }
    return buildPdf(texts.map((text) => ({ text })), Object.keys(merged).length ? merged : undefined);
  },
};
