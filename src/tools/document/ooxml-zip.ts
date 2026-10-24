// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:21:49.802Z | xcoder:subtask code-st-39dbde
import zlib from "node:zlib";
import { fail, ok, type AdapterResult } from "./types.js";
import { HARD_MAX_INFLATED_BYTES, HARD_MAX_ZIP_ENTRIES } from "./limits.js";

/**
 * Bounded ZIP read/write for OOXML packages (design C5, tradeoff T2).
 *
 * Deliberately small and strict:
 *  - only `store` (0) and `deflate` (8) are accepted — no encryption, no ZIP64;
 *  - every entry is charged against an inflation budget *as it is inflated*, so
 *    a small bomb cannot allocate its way past the ceiling;
 *  - entry names are never used as filesystem paths and relationships are never
 *    resolved, so an external `.rels` target cannot make us touch the network.
 *
 * This is not a general-purpose ZIP library. It is exactly enough to read and
 * rewrite the parts of an OOXML container we understand, and to fail closed on
 * everything else.
 */

export interface ZipEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Uint8Array;
}

export type OoxmlPackage = Map<string, ZipEntry>;

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function nameAt(b: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function utf8(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "utf8"));
}

export function toText(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

interface CdEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readCentralDirectory(bytes: Uint8Array): AdapterResult<CdEntry[]> {
  const lowest = Math.max(0, bytes.length - (0xffff + 22));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail("corrupt_input", "not a ZIP container: no end-of-central-directory record.");

  const count = u16(bytes, eocd + 10);
  if (count > HARD_MAX_ZIP_ENTRIES) {
    return fail("limit_exceeded", `archive declares ${count} entries, above the ${HARD_MAX_ZIP_ENTRIES}-entry limit.`);
  }
  let p = u32(bytes, eocd + 16);
  const entries: CdEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) {
      return fail("corrupt_input", `ZIP central directory is malformed at entry ${i}.`);
    }
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compSize = u32(bytes, p + 20);
    const uncompSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    if (p + 46 + nameLen > bytes.length) return fail("corrupt_input", "ZIP entry name runs past the end of the file.");
    entries.push({
      name: nameAt(bytes, p + 46, nameLen),
      method,
      crc32: crc,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return ok(entries);
}

/**
 * Read every entry of an OOXML package, inflating within a hard budget.
 * Entries with an unsupported compression method are skipped rather than fatal
 * (Office writes plenty of parts we never read), but the package is rejected if
 * a part we ask for later turns out to be missing.
 */
export function readZip(bytes: Uint8Array, maxEntries = HARD_MAX_ZIP_ENTRIES): AdapterResult<OoxmlPackage> {
  const dir = readCentralDirectory(bytes);
  if (!dir.ok) return dir;
  if (dir.value.length > maxEntries) {
    return fail("limit_exceeded", `archive has ${dir.value.length} entries, above the ${maxEntries}-entry limit.`);
  }

  const pkg: OoxmlPackage = new Map();
  let inflated = 0;

  for (const entry of dir.value) {
    if (entry.name.endsWith("/")) continue; // directory record
    const at = entry.localOffset;
    if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) {
      return fail("corrupt_input", `ZIP local header for "${entry.name}" is malformed.`);
    }
    const nameLen = u16(bytes, at + 26);
    const extraLen = u16(bytes, at + 28);
    const start = at + 30 + nameLen + extraLen;
    const end = start + entry.compressedSize;
    if (end > bytes.length) return fail("corrupt_input", `ZIP data for "${entry.name}" runs past the end of the file.`);

    inflated += entry.uncompressedSize;
    if (inflated > HARD_MAX_INFLATED_BYTES) {
      return fail(
        "limit_exceeded",
        `archive would inflate to more than ${HARD_MAX_INFLATED_BYTES} bytes — refusing (ZIP bomb guard).`
      );
    }

    const raw = bytes.subarray(start, end);
    let data: Uint8Array;
    if (entry.method === 0) {
      data = raw.slice();
    } else if (entry.method === 8) {
      try {
        data = new Uint8Array(zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize) }));
      } catch (e) {
        return fail("corrupt_input", `could not inflate "${entry.name}": ${(e as Error).message}`);
      }
    } else {
      continue; // encrypted/unsupported part — ignore, we never need it
    }
    pkg.set(entry.name, {
      name: entry.name,
      method: entry.method,
      crc32: entry.crc32,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      data,
    });
  }
  return ok(pkg);
}

/** Re-serialise a package. Entries are stored deflated when that is smaller. */
export function writeZip(pkg: OoxmlPackage): AdapterResult<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of pkg.values()) {
    const nameBytes = utf8(entry.name);
    let payload = entry.data;
    let method = 0;
    if (entry.data.length > 64) {
      const deflated = new Uint8Array(zlib.deflateRawSync(entry.data, { level: 6 }));
      if (deflated.length < entry.data.length) {
        payload = deflated;
        method = 8;
      }
    }
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + nameBytes.length + payload.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x21, true); // mod date (1980-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(payload, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of locals) {
    out.set(chunk, p);
    p += chunk.length;
  }
  for (const chunk of centrals) {
    out.set(chunk, p);
    p += chunk.length;
  }
  out.set(eocd, p);
  return ok(out);
}
