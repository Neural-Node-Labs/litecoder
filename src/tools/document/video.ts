// xcoder:version 1 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:24:39.793Z | xcoder:subtask code-st-39dbde
import { FAMILY_LIMITS } from "./limits.js";
import { fail, ok, type AdapterResult, type FormatAdapter } from "./types.js";

/**
 * Video adapter (design C12).
 *
 * Read-only metadata plus whole-file copy. There is deliberately no `create`:
 * encoding video needs a codec library, and pretending otherwise would produce
 * unplayable files. Everything here walks container structure only — no frame is
 * ever decoded, so a hostile file cannot trigger a decoder exploit.
 */

export type VideoContainer = "mp4" | "mov" | "webm" | "mkv" | "avi";

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function u64be(b: Uint8Array, at: number): number {
  return u32be(b, at) * 2 ** 32 + u32be(b, at + 4);
}

interface Mp4Info {
  durationMs?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrateKbps?: number;
  parseWarnings: string[];
}

const CODEC_NAMES: Record<string, string> = {
  avc1: "h264",
  avc3: "h264",
  hev1: "hevc",
  hvc1: "hevc",
  av01: "av1",
  vp09: "vp9",
  vp08: "vp8",
  mp4v: "mpeg4",
  apcn: "prores",
  jpeg: "mjpeg",
  mp4a: "aac",
  "ac-3": "ac3",
  "ec-3": "eac3",
  alac: "alac",
  Opus: "opus",
  ".mp3": "mp3",
  twos: "pcm",
  sowt: "pcm",
};

/** Walk ISO-BMFF boxes for the moov/trak/mdia metadata (bounded, non-recursive into mdat). */
function parseIsoBmff(bytes: Uint8Array): Mp4Info {
  const info: Mp4Info = { parseWarnings: [] };
  let timescale = 0;
  let duration = 0;
  let maxGuard = 50000;

  const walk = (start: number, end: number, depth: number): void => {
    let p = start;
    while (p + 8 <= end && maxGuard-- > 0) {
      const size = u32be(bytes, p);
      const type = ascii(bytes, p + 4, 4);
      if (size < 8) return;
      const boxEnd = Math.min(p + size, end);
      if (type === "mdat") {
        p = boxEnd;
        continue;
      }
      if (depth < 6) {
        if (type === "moov" || type === "trak" || type === "mdia" || type === "minf" || type === "stbl") {
          walk(p + 8, boxEnd, depth + 1);
        } else if (type === "mvhd" || type === "mdhd") {
          const version = bytes[p + 8];
          if (version === 1) {
            timescale = u32be(bytes, p + 28);
            duration = u64be(bytes, p + 32);
          } else {
            timescale = u32be(bytes, p + 20);
            duration = u32be(bytes, p + 24);
          }
        } else if (type === "tkhd") {
          const version = bytes[p + 8];
          const base = version === 1 ? p + 8 + 4 + 32 : p + 8 + 4 + 20;
          const w = u32be(bytes, base + 52);
          const h = u32be(bytes, base + 56);
          if (w > 0 && h > 0) {
            info.width = Math.round(w / 65536);
            info.height = Math.round(h / 65536);
          }
        } else if (type === "stsd") {
          const entryType = ascii(bytes, p + 8 + 8 + 4 + 4, 4);
          const name = CODEC_NAMES[entryType] ?? entryType.replace(/[^A-Za-z0-9.]/g, "");
          const isVideo = info.width !== undefined;
          if (isVideo && !info.videoCodec) info.videoCodec = name;
          else if (!isVideo && !info.audioCodec) info.audioCodec = name;
        }
      }
      p = boxEnd;
    }
  };

  walk(0, bytes.length, 0);
  if (timescale > 0 && duration > 0) info.durationMs = Math.round((duration / timescale) * 1000);
  if (info.durationMs && bytes.length) {
    info.bitrateKbps = Math.round(((bytes.length * 8) / info.durationMs) / 1000 * 1000) / 1000;
    info.bitrateKbps = Math.round((bytes.length * 8) / (info.durationMs / 1000) / 1000);
  }
  if (info.width === undefined) info.parseWarnings.push("no tkhd track dimensions found (video track may be absent or fragmented)");
  return info;
}

/** EBML: scan for the Segment > Info Duration, and the video PixelWidth/Height. */
function parseEbml(bytes: Uint8Array): Mp4Info {
  const info: Mp4Info = { parseWarnings: [] };
  const head = ascii(bytes, 0, Math.min(bytes.length, 128)).toLowerCase();
  const tag = (name: string) => head.includes(name);
  if (tag("vp9")) info.videoCodec = "vp9";
  else if (tag("vp8")) info.videoCodec = "vp8";
  else if (tag("av1")) info.videoCodec = "av1";
  if (tag("opus")) info.audioCodec = "opus";
  else if (tag("vorbis")) info.audioCodec = "vorbis";

  // PixelWidth 0xB0, PixelHeight 0xBA — compact 8-byte big-endian payloads.
  for (let i = 0; i + 8 < bytes.length && i < 262144; i++) {
    if (bytes[i] === 0xb0 && bytes[i + 1] === 0x82 && info.width === undefined) {
      const w = (bytes[i + 2] << 8) | bytes[i + 3];
      if (w > 0) info.width = w;
    }
    if (bytes[i] === 0xba && bytes[i + 1] === 0x82 && info.height === undefined) {
      const h = (bytes[i + 2] << 8) | bytes[i + 3];
      if (h > 0) info.height = h;
    }
  }

  // Duration is a float in TimecodeScale units: 0x4489 then 4 or 8 bytes.
  const idx = bytes.indexOf(0x44);
  for (let i = 0; i + 11 < bytes.length && i < 262144; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89) {
      const size = bytes[i + 2] & 0x7f;
      if (size === 4) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + i + 3, 4);
        info.durationMs = Math.round(dv.getFloat32(0) * 1000);
        break;
      }
      if (size === 8) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + i + 3, 8);
        info.durationMs = Math.round(dv.getFloat64(0) * 1000);
        break;
      }
    }
  }
  if (idx < 0) info.parseWarnings.push("no EBML header element found");
  if (info.width === undefined) info.parseWarnings.push("PixelWidth not found in the first 256 KiB");
  return info;
}

/** RIFF/AVI: main header carries microseconds-per-frame and total frames. */
function parseAvi(bytes: Uint8Array): Mp4Info {
  const info: Mp4Info = { parseWarnings: [] };
  const hdrl = ascii(bytes, 0, Math.min(bytes.length, 1024)).indexOf("avih");
  if (hdrl >= 0) {
    const base = hdrl + 8;
    if (base + 24 <= bytes.length) {
      const microPerFrame = u32le(bytes, base);
      const totalFrames = u32le(bytes, base + 16);
      const width = u32le(bytes, base + 32);
      const height = u32le(bytes, base + 36);
      if (microPerFrame > 0 && totalFrames > 0) info.durationMs = Math.round((microPerFrame * totalFrames) / 1000);
      if (width > 0 && height > 0) {
        info.width = width;
        info.height = height;
      }
    } else {
      info.parseWarnings.push("avih chunk is truncated");
    }
  } else {
    info.parseWarnings.push("no avih main header found");
  }
  const head = ascii(bytes, 0, Math.min(bytes.length, 4096));
  if (head.includes("H264")) info.videoCodec = "h264";
  else if (head.includes("XVID")) info.videoCodec = "xvid";
  else if (head.includes("DIVX")) info.videoCodec = "divx";
  else if (head.includes("MJPG")) info.videoCodec = "mjpeg";
  if (head.includes("mp3 ") || head.includes("MP3 ")) info.audioCodec = "mp3";
  return info;
}

export function parseVideoContainer(container: VideoContainer, bytes: Uint8Array): Mp4Info {
  switch (container) {
    case "mp4":
    case "mov":
      return parseIsoBmff(bytes);
    case "webm":
    case "mkv":
      return parseEbml(bytes);
    case "avi":
      return parseAvi(bytes);
  }
}

export const videoAdapter: FormatAdapter = {
  family: "video",
  extensions: [".mp4", ".mov", ".webm", ".mkv", ".avi"],
  ops: ["read", "update"],
  limits: FAMILY_LIMITS.video,

  async read(bytes): Promise<AdapterResult<Record<string, unknown>>> {
    const head = ascii(bytes, 0, 12);
    let container: VideoContainer | null = null;
    if (head.slice(4, 8) === "ftyp") container = head.slice(8, 12).trim() === "qt" ? "mov" : "mp4";
    else if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      const isWebm = ascii(bytes, 0, Math.min(bytes.length, 128)).toLowerCase().includes("webm");
      container = isWebm ? "webm" : "mkv";
    } else if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "AVI ") container = "avi";

    if (!container) {
      return fail(
        "unsupported_format",
        "unrecognised video container: this tool understands MP4, MOV, WebM, MKV and AVI. Remux or convert to one of those first."
      );
    }

    const info = parseVideoContainer(container, bytes);
    const result: Record<string, unknown> = { container, parseWarnings: info.parseWarnings };
    if (info.durationMs !== undefined) result.durationMs = info.durationMs;
    if (info.width !== undefined) result.width = info.width;
    if (info.height !== undefined) result.height = info.height;
    if (info.videoCodec) result.videoCodec = info.videoCodec;
    if (info.audioCodec) result.audioCodec = info.audioCodec;
    if (info.bitrateKbps !== undefined) result.bitrateKbps = info.bitrateKbps;
    result.bytes = bytes.byteLength;
    return ok(result);
  },

  async create(): Promise<AdapterResult<Uint8Array>> {
    return fail(
      "invalid_op",
      "video tools cannot create a video: encoding needs a codec library this tool deliberately does not ship. Record or generate the file elsewhere, then use read/update."
    );
  },

  async update(bytes, args): Promise<AdapterResult<Uint8Array>> {
    if (typeof args.copyFrom !== "string" || args.copyFrom === "") {
      return fail("invalid_input", "video update only supports copyFrom (whole-file replacement); there is no transcoding.");
    }
    // The whole-file replacement itself happens in the handler, which reads
    // copyFrom through the same containment guard and sniffs it before use.
    return ok(bytes);
  },
};
