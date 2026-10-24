// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:24:26.277Z | xcoder:subtask code-st-39dbde
import { attrOf, blocks, escapeXmlText, runsText, XML_DECL } from "./xml-text.js";
import { readZip, toText, utf8, writeZip, type OoxmlPackage } from "./ooxml-zip.js";
import { FAMILY_LIMITS, chargeUnits } from "./limits.js";
import { fail, ok, type AdapterResult, type FormatAdapter, type OpBudget } from "./types.js";

/**
 * PowerPoint (.pptx) adapter (design C11).
 *
 * Reads slide text by walking `pptx/slideN.xml` shape trees and collecting their
 * `<a:t>` runs; writing regenerates whole slides from a title + bullets. Layout
 * masters and themes from an existing deck are preserved on update because only
 * the slide parts named in the edit are replaced.
 */

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

interface SlideText {
  index: number;
  title: string;
  texts: string[];
}

/** Slide part names in presentation order, from presentation.xml + its rels. */
function slideParts(pkg: OoxmlPackage): string[] {
  const pres = pkg.get("ppt/presentation.xml");
  const rels = pkg.get("ppt/_rels/presentation.xml.rels");
  if (!pres) return [];
  const targets = new Map<string, string>();
  if (rels) {
    for (const tag of toText(rels.data).match(/<Relationship\s[^>]*\/?>/g) ?? []) {
      const id = attrOf(tag, "Relationship", "Id");
      const target = attrOf(tag, "Relationship", "Target");
      if (id && target) targets.set(id, target.replace(/^\.?\//, ""));
    }
  }
  const order: string[] = [];
  for (const tag of toText(pres.data).match(/<p:sldId\s[^>]*\/?>/g) ?? []) {
    const rid = attrOf(tag, "p:sldId", "r:id");
    const target = rid ? targets.get(rid) : undefined;
    if (target) order.push(`ppt/${target.replace(/^ppt\//, "")}`);
  }
  if (order.length === 0) {
    const found = [...pkg.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    found.sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0));
    return found;
  }
  return order;
}

/** Text of a slide, split into per-shape chunks (title first when present). */
function slideText(xml: string, budget: OpBudget): AdapterResult<SlideText> {
  const texts: string[] = [];
  let title = "";
  for (const shape of blocks(xml, "p:sp")) {
    const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(shape);
    const text = runsText(shape, "a:t").trim();
    if (!text) continue;
    texts.push(text);
    if (isTitle && !title) title = text;
    const charged = chargeUnits(budget, 1);
    if (!charged.ok) return charged;
  }
  if (!title) title = texts[0] ?? "";
  return ok({ index: 0, title, texts });
}

function runXml(text: string, size: number, bold = false): string {
  const b = bold ? ' b="1"' : "";
  return (
    `<a:r><a:rPr lang="en-US" sz="${size}"${b} dirty="0"/>` +
    `<a:t>${escapeXmlText(text)}</a:t></a:r>`
  );
}

/** One slide part: a title placeholder plus an optional bullet body. */
function slideXml(title: string, bullets: string[]): string {
  const bodyShapes = bullets.length
    ? `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>` +
      bullets.map((b) => `<a:p><a:pPr lvl="0"/>${runXml(b, 1800)}</a:p>`).join("") +
      `</p:txBody></p:sp>`
    : "";
  return (
    XML_DECL +
    `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>` +
    `<a:p>${runXml(title, 3200, true)}</a:p></p:txBody></p:sp>` +
    bodyShapes +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

/** Replace the text of the Nth shape that already carries text. */
function replaceSlideTexts(xml: string, setText: { placeholder?: string; text: string }[]): AdapterResult<string> {
  const shapes = blocks(xml, "p:sp");
  if (shapes.length === 0) return fail("corrupt_input", "slide has no shapes to edit.");
  let out = xml;
  for (let i = 0; i < setText.length; i++) {
    const spec = setText[i];
    const target = spec.placeholder
      ? shapes.find((s) => new RegExp(`<p:ph[^>]*name="${spec.placeholder}"`).test(s)) ?? shapes[i]
      : shapes[i];
    if (!target) {
      return fail("invalid_input", `slide has ${shapes.length} editable shape(s); setText[${i}] asks for one more.`);
    }
    const firstRun = /<a:r>[\s\S]*?<\/a:r>/.exec(target);
    if (!firstRun) return fail("unsupported_feature", `shape ${i} has no text run to replace (it may be a picture or table).`);
    const sizeMatch = /sz="(\d+)"/.exec(firstRun[0]);
    const size = sizeMatch ? Number(sizeMatch[1]) : 1800;
    const bold = / b="1"/.test(firstRun[0]);
    // Replace the entire paragraph text of the first paragraph, keeping its props.
    const replacedShape = target.replace(
      /(<a:p\b[^>]*>(?:<a:pPr\b[^>]*\/>)?)([\s\S]*?)(<\/a:p>)/,
      (_m, head: string) => `${head}${runXml(spec.text, size, bold)}</a:p>`
    );
    if (replacedShape === target) {
      return fail("unsupported_feature", `shape ${i} has no <a:p> paragraph this tool can rewrite.`);
    }
    out = out.replace(target, replacedShape);
  }
  return ok(out);
}

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
  "</Types>";

function buildPackage(slides: { title: string; bullets: string[] }[]): OoxmlPackage {
  const pkg: OoxmlPackage = new Map();
  const put = (name: string, xml: string) =>
    pkg.set(name, { name, method: 8, crc32: 0, compressedSize: 0, uncompressedSize: 0, data: utf8(xml) });

  const overrides: string[] = [];
  const rels: string[] = [];
  const sldIds: string[] = [];
  slides.forEach((slide, i) => {
    const n = i + 1;
    put(`ppt/slides/slide${n}.xml`, slideXml(slide.title, slide.bullets));
    overrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    );
    rels.push(`<Relationship Id="rId${n}" Type="${NS_R}/slide" Target="slides/slide${n}.xml"/>`);
    sldIds.push(`<p:sldId id="${255 + n}" r:id="rId${n}"/>`);
  });

  put("ppt/presentation.xml",
    XML_DECL +
      `<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
      `<p:sldIdLst>${sldIds.join("")}</p:sldIdLst>` +
      `<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>` +
      `</p:presentation>`);
  put("ppt/_rels/presentation.xml.rels",
    XML_DECL + `<Relationships xmlns="${NS_PKG_REL}">${rels.join("")}</Relationships>`);
  put("[Content_Types].xml", CONTENT_TYPES.replace("</Types>", `${overrides.join("")}</Types>`));
  put("_rels/.rels",
    XML_DECL +
      `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  return pkg;
}

export const slidesAdapter: FormatAdapter = {
  family: "slides",
  extensions: [".pptx", ".pptm"],
  ops: ["read", "create", "update"],
  limits: FAMILY_LIMITS.slides,

  async read(bytes): Promise<AdapterResult<Record<string, unknown>>> {
    const opened = readZip(bytes);
    if (!opened.ok) return opened;
    const pkg = opened.value;
    if (pkg.has("ppt/vbaProject.bin")) {
      return fail("unsupported_feature", "this deck contains VBA macros; it is read as plain content and cannot be updated by this tool.");
    }
    const parts = slideParts(pkg);
    if (parts.length === 0) return fail("corrupt_input", "presentation declares no slides.");

    const budget: OpBudget = {
      deadline: Date.now() + slidesAdapter.limits.timeoutMs,
      maxBytes: slidesAdapter.limits.maxOutputBytes,
      maxUnits: slidesAdapter.limits.maxUnits,
      unitsUsed: 0,
    };
    const slides: SlideText[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = pkg.get(parts[i]);
      if (!part) continue;
      const parsed = slideText(toText(part.data), budget);
      if (!parsed.ok) return parsed;
      slides.push({ index: i, title: parsed.value.title, texts: parsed.value.texts });
    }
    return ok({ format: "pptx", slideCount: slides.length, slides, truncated: slides.length >= slidesAdapter.limits.maxUnits });
  },

  async create(args): Promise<AdapterResult<Uint8Array>> {
    const raw = Array.isArray(args.slides) ? (args.slides as { title?: unknown; bullets?: unknown }[]) : [];
    if (raw.length === 0) return fail("invalid_input", "create needs at least one slide.");
    if (raw.length > slidesAdapter.limits.maxUnits) {
      return fail("limit_exceeded", `${raw.length} slides requested, above the ${slidesAdapter.limits.maxUnits}-slide limit.`);
    }
    const slides = raw.map((s) => ({
      title: typeof s.title === "string" ? s.title : "",
      bullets: Array.isArray(s.bullets) ? (s.bullets as unknown[]).filter((b): b is string => typeof b === "string") : [],
    }));
    return writeZip(buildPackage(slides));
  },

  async update(bytes, args): Promise<AdapterResult<Uint8Array>> {
    const opened = readZip(bytes);
    if (!opened.ok) return opened;
    const pkg = opened.value;
    if (pkg.has("ppt/vbaProject.bin")) {
      return fail("unsupported_feature", "refusing to rewrite a macro-enabled deck: the VBA project would be invalidated. Remove the macros first.");
    }
    const parts = slideParts(pkg);
    const slideNumber = Number(args.slide);
    if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > parts.length) {
      return fail("invalid_input", `slide must be between 1 and ${parts.length}, got "${String(args.slide)}".`);
    }
    const partName = parts[slideNumber - 1];
    const part = pkg.get(partName);
    if (!part) return fail("corrupt_input", `slide ${slideNumber} names the part "${partName}", which is missing from the package.`);

    const setText = Array.isArray(args.setText) ? (args.setText as { placeholder?: unknown; text?: unknown }[]) : [];
    if (setText.length === 0) return fail("invalid_input", "update needs at least one setText entry.");
    const specs = setText.map((s) => ({
      placeholder: typeof s.placeholder === "string" ? s.placeholder : undefined,
      text: typeof s.text === "string" ? s.text : "",
    }));

    const replaced = replaceSlideTexts(toText(part.data), specs);
    if (!replaced.ok) return replaced;
    pkg.set(partName, { name: partName, method: 8, crc32: 0, compressedSize: 0, uncompressedSize: 0, data: utf8(replaced.value) });
    return writeZip(pkg);
  },
};
