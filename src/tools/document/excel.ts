// xcoder:version 3 | xcoder:task task-3df952 | xcoder:updated 2026-10-24T05:26:35.636Z | xcoder:subtask code-st-39dbde
import { attrOf, escapeXmlAttr, runsText, textOfTag, XML_DECL } from "./xml-text.js";
import { readZip, toText, utf8, writeZip, type OoxmlPackage } from "./ooxml-zip.js";
import { FAMILY_LIMITS, chargeUnits } from "./limits.js";
import { fail, ok, type AdapterResult, type FormatAdapter, type OpBudget } from "./types.js";

/**
 * Excel (.xlsx) adapter (design C7).
 *
 * Reads and writes the OOXML parts directly: `xl/workbook.xml` for sheet names
 * and order, `xl/sharedStrings.xml` for the string table, and
 * `xl/worksheets/sheetN.xml` for cell values. No formula evaluation, no styling
 * round-trip, no macros — a macro-enabled workbook is read-only here.
 */

type Cell = string | number | boolean | null;

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Column letters → 1-based index ("A" → 1, "AA" → 27). */
export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1-based index → column letters. */
export function indexToCol(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]{1,3})([1-9]\d*)$/.exec(ref);
  if (!m) return null;
  return { col: colToIndex(m[1]), row: Number(m[2]) };
}

/** Decode the shared string table into plain strings. */
function readSharedStrings(pkg: OoxmlPackage): string[] {
  const part = pkg.get("xl/sharedStrings.xml");
  if (!part) return [];
  return textOfTag(toText(part.data), "si");
}

interface SheetRef {
  name: string;
  part: string;
}

function readSheetRefs(pkg: OoxmlPackage): SheetRef[] {
  const wb = pkg.get("xl/workbook.xml");
  if (!wb) return [];
  const wbXml = toText(wb.data);
  const rels = pkg.get("xl/_rels/workbook.xml.rels");
  const relXml = rels ? toText(rels.data) : "";
  const targets = new Map<string, string>();
  for (const tag of relXml.match(/<Relationship\s[^>]*\/?>/g) ?? []) {
    const id = attrOf(tag, "Relationship", "Id");
    const target = attrOf(tag, "Relationship", "Target");
    if (id && target) targets.set(id, target.replace(/^\.?\//, ""));
  }
  const out: SheetRef[] = [];
  for (const tag of wbXml.match(/<sheet\s[^>]*\/?>/g) ?? []) {
    const name = attrOf(tag, "sheet", "name") ?? `Sheet${out.length + 1}`;
    const rid = attrOf(tag, "sheet", "r:id") ?? attrOf(tag, "sheet", "relationshipId");
    const target = rid ? targets.get(rid) : undefined;
    const part = target ? `xl/${target.replace(/^xl\//, "")}` : `xl/worksheets/sheet${out.length + 1}.xml`;
    out.push({ name, part });
  }
  return out;
}

function cellValueFromXml(cellTag: string, shared: string[]): Cell {
  const type = attrOf(cellTag, "c", "t");
  const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellTag);
  if (!vMatch) {
    // Spreadsheet text runs are the unprefixed <t> element (never <w:t>).
    const inline = textOfTag(cellTag, "t").join("");
    return inline === "" ? null : inline;
  }
  const raw = vMatch[1];
  if (type === "s") {
    const idx = Number(raw);
    return Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : null;
  }
  if (type === "b") return raw === "1";
  if (type === "str" || type === "e" || type === "inlineStr") return raw;
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

/** Sparse grid: row number → cell map. Preserves the file's real coordinates. */
type Grid = Map<number, Map<number, Cell>>;

function readGrid(xml: string, shared: string[], budget: OpBudget): AdapterResult<Grid> {
  const grid: Grid = new Map();
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowAttr = attrOf(rowMatch[0], "row", "r");
    const rowIndex = rowAttr ? Number(rowAttr) : grid.size + 1;
    if (!Number.isFinite(rowIndex) || rowIndex < 1) continue;
    const cells = new Map<number, Cell>();
    const cellRe = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const tagged = cellMatch[0];
      const ref = attrOf(tagged, "c", "r");
      const parsed = ref ? parseRef(ref) : null;
      if (!parsed) continue;
      cells.set(parsed.col, cellValueFromXml(tagged, shared));
      const charged = chargeUnits(budget, 1);
      if (!charged.ok) return charged;
    }
    grid.set(rowIndex, cells);
  }
  return ok(grid);
}

function gridToRows(grid: Grid): { rows: Cell[][]; rowCount: number; colCount: number } {
  let maxRow = 0;
  let maxCol = 0;
  for (const [r, cells] of grid) {
    if (r > maxRow) maxRow = r;
    for (const c of cells.keys()) if (c > maxCol) maxCol = c;
  }
  const rows: Cell[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const cells = grid.get(r) ?? new Map<number, Cell>();
    const row: Cell[] = [];
    for (let c = 1; c <= maxCol; c++) row.push(cells.get(c) ?? null);
    rows.push(row);
  }
  return { rows, rowCount: maxRow, colCount: maxCol };
}

function rangeBounds(range: string | undefined): { from: { col: number; row: number }; to: { col: number; row: number } } | null {
  if (!range) return null;
  const [a, b] = range.split(":");
  const from = parseRef(a);
  const to = b ? parseRef(b) : from;
  if (!from || !to) return null;
  return {
    from: { col: Math.min(from.col, to.col), row: Math.min(from.row, to.row) },
    to: { col: Math.max(from.col, to.col), row: Math.max(from.row, to.row) },
  };
}

/** Serialise one cell as a typed value or inline text. */
export function cellXml(col: number, row: number, value: Cell): string {
  const ref = `${indexToCol(col)}${row}`;
  if (value === null || value === undefined) return `<c r="${ref}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = escapeXmlAttr(String(value)).replace(/\u0000/g, "");
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(rows: Cell[][]): string {
  const body: string[] = [];
  rows.forEach((row, rIdx) => {
    const rowNumber = rIdx + 1;
    if (!row || row.length === 0) return;
    const cells = row.map((value, cIdx) => cellXml(cIdx + 1, rowNumber, value ?? null)).join("");
    body.push(`<row r="${rowNumber}">${cells}</row>`);
  });
  return XML_DECL + `<worksheet xmlns="${NS_MAIN}"><sheetData>${body.join("")}</sheetData></worksheet>`;
}

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  "</Types>";

function buildPackage(sheets: { name: string; rows: Cell[][] }[], existing?: OoxmlPackage): OoxmlPackage {
  const pkg: OoxmlPackage = new Map();
  const put = (name: string, xml: string) =>
    pkg.set(name, { name, method: 8, crc32: 0, compressedSize: 0, uncompressedSize: 0, data: utf8(xml) });

  if (existing) {
    for (const [name, entry] of existing) pkg.set(name, entry);
  } else {
    put("[Content_Types].xml", CONTENT_TYPES);
    put(
      "_rels/.rels",
      XML_DECL +
        `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    );
  }

  const overrides: string[] = [];
  const rels: string[] = [];
  const sheetTags: string[] = [];
  sheets.forEach((sheet, i) => {
    const n = i + 1;
    put(`xl/worksheets/sheet${n}.xml`, sheetXml(sheet.rows));
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
    rels.push(`<Relationship Id="rId${n}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    sheetTags.push(`<sheet name="${escapeXmlAttr(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`);
  });

  put(
    "xl/workbook.xml",
    XML_DECL + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheetTags.join("")}</sheets></workbook>`
  );
  put("xl/_rels/workbook.xml.rels", XML_DECL + `<Relationships xmlns="${NS_PKG_REL}">${rels.join("")}</Relationships>`);

  const ct = existing?.get("[Content_Types].xml");
  const base = ct ? toText(ct.data).replace("</Types>", "") : CONTENT_TYPES.replace("</Types>", "");
  put("[Content_Types].xml", `${base}${overrides.join("")}</Types>`);
  return pkg;
}

export const excelAdapter: FormatAdapter = {
  family: "excel",
  extensions: [".xlsx", ".xlsm"],
  ops: ["read", "create", "update"],
  limits: FAMILY_LIMITS.excel,

  async read(bytes, args): Promise<AdapterResult<Record<string, unknown>>> {
    const opened = readZip(bytes);
    if (!opened.ok) return opened;
    const pkg = opened.value;
    if (pkg.has("xl/vbaProject.bin")) {
      return fail("unsupported_feature", "this workbook contains VBA macros; macro workbooks are read as plain data and cannot be updated by this tool.");
    }
    const shared = readSharedStrings(pkg);
    const refs = readSheetRefs(pkg);
    if (refs.length === 0) return fail("corrupt_input", "xl/workbook.xml declares no worksheets.");

    const budget: OpBudget = {
      deadline: Date.now() + excelAdapter.limits.timeoutMs,
      maxBytes: excelAdapter.limits.maxOutputBytes,
      maxUnits: excelAdapter.limits.maxUnits,
      unitsUsed: 0,
    };
    const only = typeof args.sheet === "string" ? args.sheet : undefined;
    const bounds = rangeBounds(typeof args.range === "string" ? args.range : undefined);
    const maxCells = typeof args.maxCells === "number" ? args.maxCells : excelAdapter.limits.maxUnits;

    const out: Record<string, unknown>[] = [];
    let truncated = false;
    for (const ref of refs) {
      if (only && ref.name !== only) continue;
      const part = pkg.get(ref.part);
      if (!part) continue;
      const grid = readGrid(toText(part.data), shared, budget);
      if (!grid.ok) return grid;
      let rows: Cell[][] = gridToRows(grid.value).rows;
      if (bounds) {
        rows = rows.slice(bounds.from.row - 1, bounds.to.row).map((row) => row.slice(bounds.from.col - 1, bounds.to.col));
      }
      const cellCount = rows.reduce((n, r) => n + r.length, 0);
      if (cellCount > maxCells) {
        const kept: Cell[][] = [];
        let used = 0;
        for (const row of rows) {
          if (used + row.length > maxCells) break;
          kept.push(row);
          used += row.length;
        }
        rows = kept;
        truncated = true;
      }
      out.push({
        name: ref.name,
        rowCount: rows.length,
        colCount: rows.reduce((n, r) => Math.max(n, r.length), 0),
        rows,
        truncated,
      });
    }
    if (out.length === 0) {
      return fail("invalid_input", `no worksheet named "${only}" — available: ${refs.map((r) => r.name).join(", ")}.`);
    }
    return ok({ format: "xlsx", sheets: out, truncated });
  },

  async create(args): Promise<AdapterResult<Uint8Array>> {
    const raw = Array.isArray(args.sheets) ? args.sheets : [];
    if (raw.length === 0) return fail("invalid_input", "create needs at least one sheet.");
    const sheets = raw.map((s, i) => {
      const sheet = s as { name?: unknown; rows?: unknown };
      return {
        name: typeof sheet.name === "string" && sheet.name ? sheet.name.slice(0, 31) : `Sheet${i + 1}`,
        rows: Array.isArray(sheet.rows) ? (sheet.rows as Cell[][]) : [],
      };
    });
    const total = sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + (Array.isArray(r) ? r.length : 0), 0), 0);
    if (total > excelAdapter.limits.maxUnits) {
      return fail("limit_exceeded", `${total} cells requested, above the ${excelAdapter.limits.maxUnits}-cell limit.`);
    }
    return writeZip(buildPackage(sheets));
  },

  async update(bytes, args): Promise<AdapterResult<Uint8Array>> {
    const opened = readZip(bytes);
    if (!opened.ok) return opened;
    const pkg = opened.value;
    if (pkg.has("xl/vbaProject.bin")) {
      return fail("unsupported_feature", "refusing to rewrite a macro-enabled workbook: the VBA project would be invalidated. Remove the macros first.");
    }
    const shared = readSharedStrings(pkg);
    const refs = readSheetRefs(pkg);
    const edits = Array.isArray(args.edits) ? (args.edits as Record<string, unknown>[]) : [];
    if (edits.length === 0) return fail("invalid_input", "update needs at least one edit.");

    const touched = new Map<string, Grid>();
    const budget: OpBudget = {
      deadline: Date.now() + excelAdapter.limits.timeoutMs,
      maxBytes: excelAdapter.limits.maxOutputBytes,
      maxUnits: excelAdapter.limits.maxUnits,
      unitsUsed: 0,
    };

    for (const edit of edits) {
      const sheetName = typeof edit.sheet === "string" ? edit.sheet : refs[0]?.name;
      const ref = refs.find((r) => r.name === sheetName);
      if (!ref) return fail("invalid_input", `no worksheet named "${sheetName}" — available: ${refs.map((r) => r.name).join(", ")}.`);
      let grid = touched.get(ref.name);
      if (!grid) {
        const part = pkg.get(ref.part);
        const parsed = part ? readGrid(toText(part.data), shared, budget) : ok<Grid>(new Map());
        if (!parsed.ok) return parsed;
        grid = parsed.value;
        touched.set(ref.name, grid);
      }
      if (typeof edit.cell === "string") {
        const pos = parseRef(edit.cell);
        if (!pos) return fail("invalid_input", `"${edit.cell}" is not a cell reference like B7.`);
        const row = grid.get(pos.row) ?? new Map<number, Cell>();
        row.set(pos.col, (edit.value ?? null) as Cell);
        grid.set(pos.row, row);
        const charged = chargeUnits(budget, 1);
        if (!charged.ok) return charged;
      } else if (Array.isArray(edit.values)) {
        const rowNumber = Number(edit.row);
        if (!Number.isInteger(rowNumber) || rowNumber < 1) {
          return fail("invalid_input", `row must be a positive integer, got "${String(edit.row)}".`);
        }
        const row = grid.get(rowNumber) ?? new Map<number, Cell>();
        (edit.values as Cell[]).forEach((value, i) => row.set(i + 1, value ?? null));
        grid.set(rowNumber, row);
        const charged = chargeUnits(budget, (edit.values as Cell[]).length);
        if (!charged.ok) return charged;
      } else {
        return fail("invalid_input", "each edit needs either {sheet,cell,value} or {sheet,row,values}.");
      }
    }

    for (const [name, grid] of touched) {
      const ref = refs.find((r) => r.name === name);
      if (!ref) continue;
      const { rows } = gridToRows(grid);
      pkg.set(ref.part, { name: ref.part, method: 8, crc32: 0, compressedSize: 0, uncompressedSize: 0, data: utf8(sheetXml(rows)) });
    }
    return writeZip(pkg);
  },
};
