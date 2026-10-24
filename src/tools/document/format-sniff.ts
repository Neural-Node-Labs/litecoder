// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:21:30.855Z | xcoder:subtask code-st-39dbde
import { fail, type AdapterResult } from "./types.js";
import { HARD_MAX_ZIP_ENTRIES } from "./limits.js";

/**
 * Magic-byte detection (design C2, tradeoff T4).
 *
 * The declared extension is a *hint*, never the truth. Every read/update path
 * sniffs the actual bytes first and refuses when they disagree, which blocks
 * the classic parser-confusion attack (a ZIP named `.pdf`, an HTML file named
 * `.png`). This module never parses content — it reads fixed header offsets and
 * a bounded central directory only.
 */

export type SniffedFormat =
  | "xlsx"
  | "docx"
  | "pptx"
  | "zip-unknown"
  | "pdf"
  | "png"
  | "jpeg"
  | "ole"
  | "mp4"
  | "mov"
  | "webm"
  | "mkv"
  | "avi"
  | "unknown";

export interface SniffResult {
  format: SniffedFormat;
  /** Short human-readable justification, echoed in errors for debuggability. */
  reason: string;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const EBML_SIG = [0x1a, 0x45, 0xdf, 0xa3];

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  const end = Math.min(bytes.length, start + length);
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/**
 * Bounded ZIP central-directory listing. Returns entry names only — no data is
 * decompressed, so this cannot be turned into a ZIP bomb on its own. Refuses
 * (returns null) on anything malformed rather than throwing.
 */
export function listZipEntryNames(bytes: Uint8Array, maxEntries = HARD_MAX_ZIP_ENTRIES): string[] | null {
  // End Of Central Directory: 0x06054b50, at most 65535 + 22 bytes from the end.
  const lowest = Math.max(0, bytes.length - (0xffff + 22));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entries = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (entries > maxEntries) return null;
  if (cdOffset >= bytes.length) return null;

  const names: string[] = [];
  let p = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (p + 46 > bytes.length) return null;
    if (u32(bytes, p) !== 0x02014b50) return null;
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    if (p + 46 + nameLen > bytes.length) return null;
    names.push(ascii(bytes, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Classify an OOXML package by the parts it actually contains. */
function sniffZip(bytes: Uint8Array): SniffResult {
  const names = listZipEntryNames(bytes);
  if (!names) {
    return { format: "zip-unknown", reason: "zip container with an unreadable central directory" };
  }
  const has = (needle: string) => names.some((n) => n === needle || n.startsWith(needle));
  if (has("xl/workbook.xml")) return { format: "xlsx", reason: "OOXML package containing xl/workbook.xml" };
  if (has("word/document.xml")) return { format: "docx", reason: "OOXML package containing word/document.xml" };
  if (has("ppt/presentation.xml")) return { format: "pptx", reason: "OOXML package containing ppt/presentation.xml" };
  return { format: "zip-unknown", reason: "zip container without an OOXML part we support" };
}

/**
 * Identify a buffer from its leading bytes (and, for ZIP, its part list).
 * Ordering matters: ISO-BMFF `ftyp` sits at offset 4, RIFF/AVI at offset 8.
 */
export function sniffFormat(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) return { format: "unknown", reason: "empty file" };

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return sniffZip(bytes);
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { format: "pdf", reason: "%PDF- header" };
  }
  if (startsWith(bytes, PNG_SIG)) {
    return { format: "png", reason: "PNG signature" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { format: "jpeg", reason: "JPEG SOI marker" };
  }
  if (startsWith(bytes, OLE_SIG)) {
    return { format: "ole", reason: "OLE/CFB compound file (legacy Office or encrypted OOXML)" };
  }
  if (startsWith(bytes, EBML_SIG)) {
    const head = ascii(bytes, 0, Math.min(bytes.length, 128)).toLowerCase();
    if (head.includes("webm")) return { format: "webm", reason: "EBML header declaring webm" };
    return { format: "mkv", reason: "EBML header (matroska)" };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "AVI ") {
    return { format: "avi", reason: "RIFF/AVI header" };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "qt  ") return { format: "mov", reason: "ISO-BMFF 'ftyp' brand qt  (QuickTime)" };
    return { format: "mp4", reason: `ISO-BMFF 'ftyp' brand ${brand.trim() || "(blank)"}` };
  }
  return { format: "unknown", reason: "no recognised magic bytes" };
}

/** Which extensions a sniffed format is expected to be carried in. */
export function extensionsForFormat(format: SniffedFormat): string[] {
  switch (format) {
    case "xlsx":
      return [".xlsx", ".xlsm"];
    case "docx":
      return [".docx", ".docm"];
    case "pptx":
      return [".pptx", ".pptm"];
    case "pdf":
      return [".pdf"];
    case "png":
      return [".png"];
    case "jpeg":
      return [".jpg", ".jpeg"];
    case "mp4":
      return [".mp4", ".m4v"];
    case "mov":
      return [".mov"];
    case "webm":
      return [".webm"];
    case "mkv":
      return [".mkv"];
    case "avi":
      return [".avi"];
    default:
      return [];
  }
}

/**
 * Do the bytes actually match the extension the caller claimed?
 *
 * A CFB/OLE container behind an OOXML extension is the encrypted-OOXML case and
 * is reported as `password_protected` — we cannot read it, but telling the model
 * "this file is encrypted" is far more useful than "corrupt".
 */
export function requireDeclaredMatch(declaredExt: string, sniffed: SniffResult): AdapterResult<void> {
  const ext = declaredExt.toLowerCase();
  const allowed = extensionsForFormat(sniffed.format);
  if (allowed.includes(ext)) return { ok: true, value: undefined };

  if (sniffed.format === "ole" && [".xlsx", ".xlsm", ".docx", ".docm", ".pptx", ".pptm"].includes(ext)) {
    return fail(
      "password_protected",
      `"${ext}" is an OLE/CFB container, not an OOXML package — the file is almost certainly password-protected or legacy-encrypted, which this tool cannot open.`
    );
  }
  if (sniffed.format === "ole" && [".xls", ".doc", ".ppt"].includes(ext)) {
    return fail("unsupported_format", `legacy binary "${ext}" (Office 97-2003) is not supported; convert to the OOXML format first.`);
  }
  if (sniffed.format === "unknown") {
    return fail("unsupported_format", `the bytes of "${ext}" are not a format these tools understand (${sniffed.reason}).`);
  }
  if (sniffed.format === "zip-unknown") {
    return fail("unsupported_format", `"${ext}" is a ZIP archive that is not an Office package (${sniffed.reason}).`);
  }
  const actual = allowed[0] ?? sniffed.format;
  return fail(
    "format_mismatch",
    `declared extension "${ext}" does not match the file contents, which are ${sniffed.format} (${sniffed.reason}). ` +
      `Rename the file to "${actual}" or pass the correct path — these tools never guess or convert silently.`
  );
}
