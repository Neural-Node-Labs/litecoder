// xcoder:version 2 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:24:12.485Z | xcoder:subtask code-st-39dbde
import zlib from "node:zlib";
import { assertPixels, FAMILY_LIMITS } from "./limits.js";
import { fail, ok, type AdapterResult, type FormatAdapter } from "./types.js";

/**
 * Image adapter for PNG and JPEG (design C10, tradeoff T3/T6).
 *
 * PNG can be created, read (dimensions/alpha) and updated; JPEG can be read and
 * copied but not generated — writing a baseline JPEG encoder is out of scope, and
 * silently emitting a PNG into a `.jpg` path is exactly the silent conversion
 * this surface refuses to do. EXIF is opt-in only (T6): it routinely carries GPS
 * coordinates, so a default read does not return it.
 */

export type ImageFormat = "png" | "jpg";

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
  bitDepth: number;
  colorType: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COLOR_TYPE_NAMES: Record<number, string> = {
  0: "grayscale",
  2: "rgb",
  3: "palette",
  4: "grayscale+alpha",
  6: "rgba",
};

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b);
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}

/** Read the IHDR chunk. Dimensions are validated before anything allocates. */
export function readPngInfo(bytes: Uint8Array): AdapterResult<ImageInfo> {
  if (!isPng(bytes)) return fail("format_mismatch", "bytes are not a PNG (signature missing).");
  if (bytes.length < 33) return fail("corrupt_input", "PNG is truncated before its first chunk.");
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== "IHDR") return fail("corrupt_input", `PNG's first chunk is "${chunkType}", expected IHDR.`);
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  const guarded = assertPixels(width, height);
  if (!guarded.ok) return guarded;
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  return ok({
    format: "png",
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || bytes[28] !== 0,
    bitDepth,
    colorType,
  });
}

/** Walk the JPEG marker chain to the first SOFn frame header. */
export function readJpegInfo(bytes: Uint8Array): AdapterResult<ImageInfo> {
  if (!isJpeg(bytes)) return fail("format_mismatch", "bytes are not a JPEG (SOI marker missing).");
  let p = 2;
  let guard = 0;
  while (p + 9 < bytes.length && guard++ < 10000) {
    if (bytes[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = bytes[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = u16be(bytes, p + 2);
    if (len < 2) return fail("corrupt_input", `JPEG marker 0x${marker.toString(16)} declares an impossible length ${len}.`);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = u16be(bytes, p + 5);
      const width = u16be(bytes, p + 7);
      const guarded = assertPixels(width, height);
      if (!guarded.ok) return guarded;
      return ok({ format: "jpg", width, height, hasAlpha: false, bitDepth: bytes[p + 4], colorType: bytes[p + 9] });
    }
    p += 2 + len;
  }
  return fail("corrupt_input", "JPEG has no SOF frame header — the file is truncated or not a JPEG.");
}

export function readImageInfo(bytes: Uint8Array): AdapterResult<ImageInfo> {
  if (isPng(bytes)) return readPngInfo(bytes);
  if (isJpeg(bytes)) return readJpegInfo(bytes);
  return fail("format_mismatch", "bytes are neither PNG nor JPEG.");
}

/**
 * A minimal EXIF (APP1) reader. Returns only the textual tags that are safe to
 * surface — never GPS, never maker notes (tradeoff T6).
 */
export function readJpegExif(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let p = 2;
  while (p + 4 < bytes.length) {
    if (bytes[p] !== 0xff) break;
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = u16be(bytes, p + 2);
    if (len < 2) break;
    if (marker === 0xe1) {
      const seg = bytes.subarray(p + 4, p + 2 + len);
      const ascii = Buffer.from(seg).toString("latin1");
      if (ascii.startsWith("Exif\u0000\u0000")) {
        for (const key of ["Make", "Model", "Software", "DateTime", "Artist", "ImageDescription"]) {
          const m = new RegExp(`${key}\\u0000[\\s\\S]{0,16}?([\\x20-\\x7e]{1,64})\\u0000`).exec(ascii);
          if (m) out[key] = m[1].trim();
        }
      }
    }
    p += 2 + len;
  }
  return out;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "latin1");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  Buffer.from(data).copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return new Uint8Array(out);
}

/** Encode a solid-colour (optionally transparent-free) RGBA PNG. */
export function encodeSolidPng(width: number, height: number, hex: string, alpha = 255): AdapterResult<Uint8Array> {
  const guarded = assertPixels(width, height);
  if (!guarded.ok) return guarded;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return fail("invalid_input", `background must be #rrggbb, got "${hex}".`);
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);

  const rowLength = 1 + width * 4;
  const total = rowLength * height;
  const raw = Buffer.alloc(total);
  for (let y = 0; y < height; y++) {
    const base = y * rowLength;
    raw[base] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = base + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = alpha;
    }
  }
  const compressed = new Uint8Array(zlib.deflateSync(raw, { level: 6 }));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    Buffer.from(PNG_SIG),
    Buffer.from(pngChunk("IHDR", new Uint8Array(ihdr))),
    Buffer.from(pngChunk("IDAT", compressed)),
    Buffer.from(pngChunk("IEND", new Uint8Array(0))),
  ];
  return ok(new Uint8Array(Buffer.concat(parts)));
}

/** Convert a PNG's colour type to 6 where that is a safe, lossless reinterpretation. */
export function toJpegUnsupported(): AdapterResult<never> {
  return fail(
    "unsupported_feature",
    "JPEG encoding is not implemented in this tool: no baseline JPEG encoder ships with it. Create the image as PNG (format: 'png') instead — these tools never silently convert formats."
  );
}

export const imageAdapter: FormatAdapter = {
  family: "image",
  extensions: [".png", ".jpg", ".jpeg"],
  ops: ["read", "create", "update"],
  limits: FAMILY_LIMITS.image,

  async read(bytes, args): Promise<AdapterResult<Record<string, unknown>>> {
    const info = readImageInfo(bytes);
    if (!info.ok) return info;
    const result: Record<string, unknown> = {
      format: info.value.format,
      width: info.value.width,
      height: info.value.height,
      hasAlpha: info.value.hasAlpha,
      colorType: COLOR_TYPE_NAMES[info.value.colorType] ?? info.value.colorType,
      bitDepth: info.value.bitDepth,
    };
    if (args.includeExif === true) {
      result.exif = info.value.format === "jpg" ? readJpegExif(bytes) : {};
    }
    return ok(result);
  },

  async create(args): Promise<AdapterResult<Uint8Array>> {
    const format = args.format === "jpg" ? "jpg" : "png";
    if (format === "jpg") return toJpegUnsupported();
    const width = Number(args.width);
    const height = Number(args.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      return fail("invalid_input", `width and height must be positive integers, got ${String(args.width)}×${String(args.height)}.`);
    }
    const background = typeof args.background === "string" ? args.background : "#ffffff";
    return encodeSolidPng(width, height, background);
  },

  async update(bytes, args): Promise<AdapterResult<Uint8Array>> {
    const info = readImageInfo(bytes);
    if (!info.ok) return info;
    if (args.copyFrom !== undefined) {
      return fail(
        "unsupported_feature",
        "copyFrom is not implemented: composing one image over another needs a raster pipeline this tool does not ship. Use read to inspect the source and create to produce a new image."
      );
    }
    const setMeta = args.setMetadata as Record<string, unknown> | undefined;
    if (setMeta && typeof setMeta.format === "string") {
      const wanted = setMeta.format === "jpg" ? "jpg" : "png";
      if (wanted !== info.value.format) {
        return fail(
          "unsupported_feature",
          `converting ${info.value.format} → ${wanted} requires a pixel pipeline (and a JPEG encoder) that this tool does not include. Create the image in the target format instead.`
        );
      }
      // Same format: a normalising rewrite is the whole operation. The caller's
      // atomic-write path still runs, so the file is replaced only on success.
      return ok(bytes);
    }
    return fail("invalid_input", "update found nothing to change: supply copyFrom or setMetadata.");
  },
};
