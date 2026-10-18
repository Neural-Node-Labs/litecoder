// xcoder:version 3 | xcoder:task task-e6370a | xcoder:updated 2026-08-12T16:39:56.617Z | xcoder:subtask code-st-cd4444
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  scanFile,
  resolveReference,
  findUniqueDeclaration,
  searchAstTool,
  updateFunctionTool,
  renameSymbolTool,
  type ScanResult,
  type ScopeDecl,
} from "./ast-tools.js";

const SAMPLE_TS = `
import { readFile } from "node:fs";
import { join } from "path";

/** doc comment */
export function login(username: string, password: string): boolean {
  const auth = authenticate(username, password);
  return auth.ok;
}

function authenticate(user: string, pass: string): { ok: boolean } {
  return { ok: user === pass };
}

export interface Session {
  token: string;
  expires: number;
}

export class AuthService {
  constructor(private readonly realm: string) {}
  login(username: string) {
    return login(username, "");
  }
}
`;

function asScan(s: ReturnType<typeof scanFile>): ScanResult {
  if ("ok" in s) {
    throw new Error(`scan failed: ${s.error}`);
  }
  return s;
}

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "ast-tools-test-"));
}

function writeFixture(dir: string, name: string, content: string): { root: string; file: string } {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return { root: dir, file };
}

describe("scanFile", () => {
  it("extracts imports, declarations, and references (AC-05)", () => {
    const scan = asScan(scanFile(SAMPLE_TS, "typescript"));
    expect(scan.imports).toEqual(["node:fs", "path"]);
    const declNames = scan.declarations.map((d) => d.name);
    expect(declNames).toContain("login");
    expect(declNames).toContain("authenticate");
    expect(declNames).toContain("Session");
    expect(declNames).toContain("AuthService");
    const refs = scan.references.map((r) => r.name);
    expect(refs).toContain("login");
    expect(refs).toContain("authenticate");
    // Import binding names are NOT references.
    expect(refs).not.toContain("readFile");
    expect(refs).not.toContain("join");
  });

  it("returns a typed error for unterminated strings (never throws)", () => {
    const s = scanFile("function x() { const s = 'oops;", "typescript");
    expect("ok" in s).toBe(true);
    if ("ok" in s) {
      expect(s.error).toContain("unterminated");
    }
  });
});

describe("resolveReference / shadowing (AC-10)", () => {
  it("a shadowed symbol resolves to the inner declaration, not a false positive", () => {
    const source = `
const value = 1;
function f() {
  const value = 2;
  return value;
}
`;
    const scan = asScan(scanFile(source, "typescript"));
    const decls = scan.declarations.filter((d) => d.name === "value");
    expect(decls.length).toBe(2);
    const innerRef = scan.references.find((r) => r.name === "value" && r.startLine > 4);
    expect(innerRef).toBeDefined();
    const resolved = resolveReference(innerRef!, scan.declarations);
    expect(resolved).not.toBeNull();
    expect(resolved!.startLine).toBe(4); // inner declaration, not line 2
  });
});

describe("findUniqueDeclaration (AC-13)", () => {
  it("no_match for a missing name", () => {
    const scan = asScan(scanFile(SAMPLE_TS, "typescript"));
    const res = findUniqueDeclaration("nope", scan.declarations);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("no_match");
    }
  });

  it("not_unique with candidate lines when duplicated", () => {
    const source = `function dup() { return 1; }
function dup() { return 2; }`;
    const scan = asScan(scanFile(source, "typescript"));
    const res = findUniqueDeclaration("dup", scan.declarations);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("not_unique");
      expect(res.candidates!.length).toBe(2);
    }
  });
});

describe("searchAstTool (AC-10)", () => {
  it("finds function declarations across the workspace", async () => {
    const dir = tempDir();
    const { root } = writeFixture(dir, "src/a.ts", SAMPLE_TS);
    const res = await searchAstTool(root, { query: "function login", pathGlob: "src/**/*.ts" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.total).toBe(1);
      expect(res.matches[0].name).toBe("login");
    }
  });

  it("call query ignores strings/comments/templates — no false positives (AC-10)", async () => {
    const dir = tempDir();
    const source = `
let log = 0;
const s = "log is here";
// log appears in a comment
const t = \`template log\`;
log = log + 1;
`;
    const { root } = writeFixture(dir, "src/s.ts", source);
    const res = await searchAstTool(root, { query: "call log", pathGlob: "src/**/*.ts" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const lines = res.matches.map((m) => m.line);
      expect(lines).toContain(6); // the real reference: `log = log + 1`
      expect(lines).not.toContain(3); // string line
      expect(lines).not.toContain(4); // comment line
      expect(lines).not.toContain(5); // template line
    }
  });

  it("rejects an invalid query with a typed error", async () => {
    const res = await searchAstTool(process.cwd(), { query: "wat*" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid_query");
    }
  });

  it("no matches is ok with a note for non-TS globs", async () => {
    const dir = tempDir();
    const { root } = writeFixture(dir, "src/a.py", "def login(): pass\n");
    const res = await searchAstTool(root, { query: "function login", pathGlob: "src/**/*.py" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.total).toBe(0);
    }
  });
});

describe("updateFunctionTool (AC-13)", () => {
  it("replaces a unique function's body in place", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/login.ts", SAMPLE_TS);
    const res = await updateFunctionTool(root, {
      path: path.relative(root, file),
      functionName: "authenticate",
      newCode: "function authenticate(user: string, pass: string): { ok: boolean } {\n  return { ok: true };\n}",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const content = readFileSync(file, "utf8");
      expect(content).toContain("return { ok: true };");
      expect(content).not.toContain("user === pass");
    }
  });

  it("no_match typed for a missing function", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/login.ts", SAMPLE_TS);
    const res = await updateFunctionTool(root, {
      path: path.relative(root, file),
      functionName: "notHere",
      newCode: "function notHere() {}",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("no_match");
    }
  });

  it("not_unique typed with candidates for duplicated names", async () => {
    const dir = tempDir();
    const source = `function dup() { return 1; }
function dup() { return 2; }`;
    const { root, file } = writeFixture(dir, "src/dup.ts", source);
    const res = await updateFunctionTool(root, {
      path: path.relative(root, file),
      functionName: "dup",
      newCode: "function dup() { return 3; }",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("not_unique");
    }
  });

  it("unsupported_language for non-TS files", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.py", "def x(): pass\n");
    const res = await updateFunctionTool(root, {
      path: path.relative(root, file),
      functionName: "x",
      newCode: "def x(): return 1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("unsupported_language");
    }
  });
});

describe("renameSymbolTool (AC-14)", () => {
  it("renames references and declaration, leaves strings/comments/props untouched", async () => {
    const dir = tempDir();
    const source = `
// oldName appears in comments — untouched
const s = "oldName appears in strings — untouched";

export function oldName(a: number) {
  const b = oldName(a - 1);
  return b + oldName;
}
const v = oldName;
obj.oldName; // property access — untouched
`;
    const { root, file } = writeFixture(dir, "src/r.ts", source);
    const res = await renameSymbolTool(root, {
      path: path.relative(root, file),
      name: "oldName",
      newName: "newName",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.count).toBeGreaterThanOrEqual(4);
      const content = readFileSync(file, "utf8");
      expect(content).toContain("function newName");
      expect(content).toContain("const b = newName(a - 1)");
      expect(content).not.toContain("oldName(a - 1)");
      expect(content).toContain('"oldName appears in strings');
      expect(content).toContain("// oldName appears in comments");
      expect(content).toContain("obj.oldName;");
    }
  });

  it("unsupported_language for .py", async () => {
    const dir = tempDir();
    const { root, file } = writeFixture(dir, "src/a.py", "x = 1\n");
    const res = await renameSymbolTool(root, {
      path: path.relative(root, file),
      name: "x",
      newName: "y",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("unsupported_language");
    }
  });
});
