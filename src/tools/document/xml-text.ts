// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:21:58.091Z | xcoder:subtask code-st-39dbde
/**
 * Minimal, dependency-free XML text helpers for the OOXML adapters (C5).
 *
 * This is intentionally NOT an XML parser. It escapes/unescapes text and pulls
 * the text nodes out of a known-shape part. That is all the adapters need, and
 * it means there is no entity-expansion surface (XXE / billion-laughs) to
 * defend: we never resolve entities, DTDs, or external references.
 */

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** All `<tag ...>text</tag>` bodies, concatenated per match, in document order. */
export function textOfTag(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(unescapeXml(m[1].replace(/<[^>]*>/g, "")));
  return out;
}

/** Concatenate every `<w:t>`/`<a:t>`-style run inside a fragment. */
export function runsText(xml: string, tag = "w:t"): string {
  return textOfTag(xml, tag).join("");
}

/** Split a part into top-level paragraph fragments for a given tag. */
export function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}

/** Attribute value of the first matching tag, or undefined. */
export function attrOf(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${tag}\\s[^>]*\\b${attr}="([^"]*)"`);
  const m = re.exec(xml);
  return m ? unescapeXml(m[1]) : undefined;
}

/** Strip the leading XML declaration/BOM an Office part may carry. */
export function stripDecl(xml: string): string {
  return xml.replace(/^\uFEFF/, "").replace(/^<\?xml[^>]*\?>\s*/, "");
}
