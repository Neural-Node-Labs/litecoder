// xcoder:version 2 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:48:03.925Z | xcoder:subtask test-st-bfa3d9
import { z } from "zod";

/**
 * Public request schemas for the six document/media tools (design C13).
 *
 * Every tool is a discriminated union on a closed `op` enum. Validating here —
 * before any adapter sees an argument — is what keeps unvalidated model output
 * from reaching a parser (bylaw PRM-07/PRM-08), and it is the single source that
 * the porting handoff's JSON Schema is generated from.
 */

export const MAX_PATH_LENGTH = 512;

const relPath = z
  .string()
  .min(1, "path must not be empty")
  .max(MAX_PATH_LENGTH, `path must be at most ${MAX_PATH_LENGTH} characters`)
  .refine((p) => !p.includes("\u0000"), "path must not contain NUL")
  .refine((p) => !/^[a-zA-Z]:[\\/]/.test(p), "path must be workspace-relative, not a drive-absolute path")
  .refine((p) => !/^[\\/]{2}/.test(p), "path must be workspace-relative, not a UNC path");

const overwrite = z.boolean().optional();

/** A spreadsheet cell: string, number, boolean, or null for blank. */
export const cellValue = z.union([z.string().max(32000), z.number(), z.boolean(), z.null()]);

export const excelInput = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("read"),
    path: relPath,
    sheet: z.string().max(64).optional(),
    range: z.string().regex(/^[A-Z]{1,3}[1-9]\d*(:[A-Z]{1,3}[1-9]\d*)?$/, "range must look like A1 or A1:C20").optional(),
    maxCells: z.number().int().positive().max(200000).optional(),
  }),
  z.object({
    op: z.literal("create"),
    path: relPath,
    sheets: z
      .array(
        z.object({
          name: z.string().min(1).max(31),
          rows: z.array(z.array(cellValue).max(200)).max(2000),
        })
      )
      .min(1)
      .max(20),
    overwrite,
  }),
  z.object({
    op: z.literal("update"),
    path: relPath,
    edits: z
      .array(
        z.union([
          z.object({ sheet: z.string().min(1).max(31), cell: z.string().min(1).max(12), value: cellValue }),
          z.object({ sheet: z.string().min(1).max(31), row: z.number().int().positive(), values: z.array(cellValue).max(200) }),
        ])
      )
      .min(1)
      .max(5000),
    overwrite,
  }),
]);

export const wordInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), path: relPath, includeOutline: z.boolean().optional() }),
  z.object({
    op: z.literal("create"),
    path: relPath,
    paragraphs: z
      .array(z.object({ text: z.string().max(20000), style: z.enum(["Normal", "Heading1", "Heading2", "Heading3", "Quote"]).optional() }))
      .min(1)
      .max(5000),
    overwrite,
  }),
  z.object({
    op: z.literal("update"),
    path: relPath,
    append: z.array(z.object({ text: z.string().max(20000), style: z.string().max(40).optional() })).max(2000).optional(),
    replace: z
      .array(z.object({ find: z.string().min(1).max(4000), replace: z.string().max(20000), all: z.boolean().optional() }))
      .max(200)
      .optional(),
    insertAfter: z
      .array(z.object({ index: z.number().int().nonnegative(), text: z.string().max(20000), style: z.string().max(40).optional() }))
      .max(500)
      .optional(),
    overwrite,
  }),
]);

export const pdfMetadata = z
  .object({
    title: z.string().max(512).optional(),
    author: z.string().max(512).optional(),
    subject: z.string().max(512).optional(),
    keywords: z.string().max(512).optional(),
  })
  .optional();

export const pdfInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), path: relPath, maxPages: z.number().int().positive().max(500).optional() }),
  z.object({
    op: z.literal("create"),
    path: relPath,
    pages: z.array(z.object({ text: z.string().max(20000) })).min(1).max(500),
    metadata: pdfMetadata,
    overwrite,
  }),
  z.object({
    op: z.literal("update"),
    path: relPath,
    appendPages: z.array(z.object({ text: z.string().max(20000) })).max(500).optional(),
    mergeFrom: relPath.optional(),
    metadata: pdfMetadata,
    overwrite,
  }),
]);

export const imageInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), path: relPath, includeExif: z.literal(true).optional() }),
  z.object({
    op: z.literal("create"),
    path: relPath,
    format: z.enum(["png", "jpg"]),
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/, "background must be #rrggbb").optional(),
    overwrite,
  }),
  z.object({
    op: z.literal("update"),
    path: relPath,
    copyFrom: relPath.optional(),
    setMetadata: z.object({ format: z.enum(["png", "jpg"]).optional() }).optional(),
    overwrite,
  }),
]);

export const slidesInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), path: relPath }),
  z.object({
    op: z.literal("create"),
    path: relPath,
    slides: z
      .array(z.object({ title: z.string().max(2000), bullets: z.array(z.string().max(2000)).max(50).optional() }))
      .min(1)
      .max(200),
    overwrite,
  }),
  z.object({
    op: z.literal("update"),
    path: relPath,
    slide: z.number().int().positive(),
    setText: z.array(z.object({ placeholder: z.string().max(64).optional(), text: z.string().max(20000) })).min(1).max(50),
    overwrite,
  }),
]);

export const videoInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), path: relPath }),
  z.object({ op: z.literal("update"), path: relPath, copyFrom: relPath, overwrite }),
]);

/** Tool name → request schema. The handler dispatches through this table. */
export const INPUT_SCHEMAS = {
  excel: excelInput,
  word: wordInput,
  pdf: pdfInput,
  image: imageInput,
  slides: slidesInput,
  video: videoInput,
} as const;

export type ExcelInput = z.infer<typeof excelInput>;
export type WordInput = z.infer<typeof wordInput>;
export type PdfInput = z.infer<typeof pdfInput>;
export type ImageInput = z.infer<typeof imageInput>;
export type SlidesInput = z.infer<typeof slidesInput>;
export type VideoInput = z.infer<typeof videoInput>;

export type DocumentInput = ExcelInput | WordInput | PdfInput | ImageInput | SlidesInput | VideoInput;

/** Parse an untrusted input, returning a typed failure instead of throwing. */
export function parseToolInput(
  tool: keyof typeof INPUT_SCHEMAS,
  input: unknown
): { ok: true; value: DocumentInput } | { ok: false; error: string } {
  const schema = INPUT_SCHEMAS[tool];
  if (!schema) return { ok: false, error: `unknown document tool: ${tool}` };
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as DocumentInput };
  const issues = parsed.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: issues };
}
