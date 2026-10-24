// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:23:17.760Z | xcoder:subtask code-st-39dbde
import { blocks, escapeXmlAttr, escapeXmlText, runsText, textOfTag, XML_DECL } from "./xml-text.js";
import { readZip, toText, utf8, writeZip, type OoxmlPackage } from "./ooxml-zip.js";
import { FAMILY_LIMITS, chargeUnits } from "./limits.js";
import { fail, ok, type AdapterResult, type FormatAdapter, type OpBudget } from "./types.js";

/**
 * Word (.docx) adapter (design C8).
 *
 * Paragraphs are read from `word/document.xml` by splitting `<w:p>` blocks and
 * concatenating their `<w:t>` runs. Writing regenerates the paragraph list and
 * reuses every other part of the package untouched, so styles, headers and
 * embedded media survive an update; only the paragraph bodies change.
 */

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const STYLE_IDS: Record<string, string> = {
  Normal: "Normal",
  Heading1: "Heading1",
  Heading2: "Heading2",
  Heading3: "Heading3",
  Quote: "Quote",
};

interface Paragraph {
  index: number;
  style: string;
  text: string;
}

function paragraphStyle(pXml: string): string {
  const m = /<w:pStyle\s+w:val="([^"]*)"/.exec(pXml);
  return m ? m[1] : "Normal";
}

function readParagraphs(xml: string, budget: OpBudget): AdapterResult<Paragraph[]> {
  const out: Paragraph[] = [];
  for (const p of blocks(xml, "w:p")) {
    out.push({ index: out.length, style: paragraphStyle(p), text: runsText(p) });
    const charged = chargeUnits(budget, 1);
    if (!charged.ok) return charged;
  }
  return ok(out);
}

function paragraphXml(text: string, style?: string): string {
  const styleId = style ? STYLE_IDS[style] ?? style.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) : undefined;
  const pPr = styleId && styleId !== "Normal" ? `<w:pPr><w:pStyle w:val="${escapeXmlAttr(styleId)}"/></w:pPr>` : "";
  const body = text
    .split("\n")
    .map((line) => `<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`)
    .join("<w:r><w:br/></w:r>");
  return `<w:p>${pPr}${body}</w:p>`;
}

function documentXml(body: string): string {
  return (
    XML_DECL +
    `<w:document xmlns:w="${NS_W}"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types";

function emptyPackage(): OoxmlPackage {
  const pkg: OoxmlPackage = new Map();
  const put = (name: string, xml: string) =>
    pkg.set(name, { name, method: 8, crc32: 0, compressedSize: 0, uncompressedSize: 0, data: utf8(xml) });
  put("[Content_Types].xml", CONTENT_TYPES);
  put(
    "_rels/.rels",
    XML_DECL +
      `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  return pkg;
}

/** Paragraph blocks of an existing document, plus the trailing sectPr. */
function splitDocument(xml: string): { paragraphs: string[]; trailer: string } {
  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;
  const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(body);
  return { paragraphs: blocks(body, "w:p"), trailer: sectPr ? sectPr[0] : "" };
}

export const wordAdapter: FormatAdapter = {
  family: "word",
  extensions: [".docx", ".docm"],
  ops: ["read", "create", "update"],
  limits: FAMILY_LIMITS.word,

  async read(bytes, args): Promise<AdapterResult<Record<string, unknown>>> {
    const opened = readZip(bytes);
    if (!opened.ok) return opened;
    const doc = opened.value.get("word/document.xml");
    if (!doc) return fail("corrupt_input", "package has no word/document.xml — not a Word document.");

    const budget: OpBudget = {
      deadline: Date.now() + wordAdapter.limits.timeoutMs,
      maxBytes: wordAdapter.limits.maxOutputBytes,
      maxUnits: wordAdapter.limits.maxUnits,
      unitsUsed: 0,
    };
    const parsed = readParagraphs(toText(doc.data), budget);
    if (!parsed.ok) return parsed;

    const paragraphs = parsed.value;
    const truncated = paragraphs.length >= wordAdapter.limits.maxUnits;
    const result: Record<string, unknown> = { format: "docx", paragraphs, truncated };
    if (args.includeOutline === true) {
      result.outline = paragraphs
        .filter((p) => /^Heading[1-3]$/.test(p.style))
        .map((p) => ({ level: Number(p.style.slice(-1)), text: p.text, index: p.index }));
    }
    return ok(result);
  },

  async create(args): Promise<AdapterResult<Uint8Array>> {
    const raw = Array.isArray(args.paragraphs) ? (args.paragraphs as { text?: unknown; style?: unknown }[]) : [];
    if (raw.length === 0) return fail("invalid_input", "create needs at least one paragraph.");
    if (raw.length > wordAdapter.limits.maxUnits) {
      return fail("limit_exceeded", `${raw.length} paragraphs requested, above the ${wordAdapter.limits.maxUnits}-paragraph limit.`);
    }
    const body = raw
      .map((p) => paragraphXml(typeof p.text === "string" ? p.text : "", typeof p.style === "string" ? p.style : undefined))
      .join("");
    const pkg = emptyPackage();
    pkg.set("word/document.xml", {
      name: "word/document.xml",
      method: 8,
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      data: utf8(documentXml(body)),
    });
    return writeZip(pkg);
  },

  async update(bytes, args): Promise<AdapterResult<Uint8Array>> {
    const opened = readZip(bytes);
    if (!opened.ok) return opened;
    const pkg = opened.value;
    const doc = pkg.get("word/document.xml");
    if (!doc) return fail("corrupt_input", "package has no word/document.xml — not a Word document.");

    const { paragraphs, trailer } = splitDocument(toText(doc.data));
    const list = [...paragraphs];
    let changed = false;

    const replaceSpecs = Array.isArray(args.replace) ? (args.replace as { find?: unknown; replace?: unknown; all?: unknown }[]) : [];
    for (const spec of replaceSpecs) {
      const find = typeof spec.find === "string" ? spec.find : "";
      if (!find) continue;
      const replacement = typeof spec.replace === "string" ? spec.replace : "";
      for (let i = 0; i < list.length; i++) {
        const plain = runsText(list[i]);
        if (!plain.includes(find)) continue;
        const style = paragraphStyle(list[i]);
        const replaced = spec.all === false ? plain.replace(find, replacement) : plain.split(find).join(replacement);
        list[i] = paragraphXml(replaced, style);
        changed = true;
        if (spec.all === false) break;
      }
    }

    const insertions = Array.isArray(args.insertAfter)
      ? (args.insertAfter as { index?: unknown; text?: unknown; style?: unknown }[])
          .slice()
          .sort((a, b) => Number(b.index) - Number(a.index))
      : [];
    for (const ins of insertions) {
      const at = Number(ins.index);
      if (!Number.isInteger(at) || at < 0) {
        return fail("invalid_input", `insertAfter index must be a non-negative integer, got "${String(ins.index)}".`);
      }
      if (at >= list.length) return fail("invalid_input", `insertAfter index ${at} is past the last paragraph (${list.length - 1}).`);
      list.splice(
        at + 1,
        0,
        paragraphXml(typeof ins.text === "string" ? ins.text : "", typeof ins.style === "string" ? ins.style : undefined)
      );
      changed = true;
    }

    const appends = Array.isArray(args.append) ? (args.append as { text?: unknown; style?: unknown }[]) : [];
    for (const p of appends) {
      list.push(paragraphXml(typeof p.text === "string" ? p.text : "", typeof p.style === "string" ? p.style : undefined));
      changed = true;
    }

    if (!changed) return fail("invalid_input", "update found nothing to change: supply append, replace or insertAfter.");
    if (list.length > wordAdapter.limits.maxUnits) {
      return fail("limit_exceeded", `result would have ${list.length} paragraphs, above the ${wordAdapter.limits.maxUnits}-paragraph limit.`);
    }

    pkg.set("word/document.xml", {
      name: "word/document.xml",
      method: 8,
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      data: utf8(documentXml(list.join("") + trailer)),
    });
    return writeZip(pkg);
  },
};

/** Exported for the round-trip tests: plain text of a document part. */
export function wordPlainText(xml: string): string {
  return blocks(xml, "w:p")
    .map((p) => textOfTag(p, "w:t").join(""))
    .join("\n");
}
