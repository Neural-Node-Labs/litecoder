import { describe, it, expect } from "vitest";
import {
  getCommentSyntax,
  injectVersionHeader,
} from "./file-header-manager.js";
import type { CommentSyntax } from "./file-header-manager.js";
import type { HeaderMeta } from "../store/file-version-store.js";

/**
 * Test suite for FileHeaderManager — comment-syntax-aware header
 * injection/update.
 *
 * Design contract:
 *  - getCommentSyntax() returns the correct comment markers per extension.
 *  - getCommentSyntax() returns null for non-commentable files (JSON, binary, images, unknown).
 *  - injectVersionHeader() prepends a new header when none exists.
 *  - injectVersionHeader() updates an existing header instead of duplicating.
 *  - injectVersionHeader() inserts after shebang when present.
 *  - injectVersionHeader() handles all four comment syntaxes (//, #, <!-- -->, --).
 */

function makeMeta(overrides?: Partial<HeaderMeta>): HeaderMeta {
  return {
    version: 3,
    taskId: "TASK-TEST",
    subtaskId: "test-st-abc123",
    timestamp: "2026-01-23T10:30:00.000Z",
    ...overrides,
  };
}

describe("getCommentSyntax", () => {
  it("returns // for .ts files", () => {
    expect(getCommentSyntax("src/index.ts")).toEqual({ open: "//" });
  });

  it("returns // for .js files", () => {
    expect(getCommentSyntax("app.js")).toEqual({ open: "//" });
  });

  it("returns // for .tsx files", () => {
    expect(getCommentSyntax("component.tsx")).toEqual({ open: "//" });
  });

  it("returns // for .css files", () => {
    expect(getCommentSyntax("style.css")).toEqual({ open: "//" });
  });

  it("returns // for .scss files", () => {
    expect(getCommentSyntax("theme.scss")).toEqual({ open: "//" });
  });

  it("returns // for .java files", () => {
    expect(getCommentSyntax("Main.java")).toEqual({ open: "//" });
  });

  it("returns // for .go files", () => {
    expect(getCommentSyntax("main.go")).toEqual({ open: "//" });
  });

  it("returns // for .rs files", () => {
    expect(getCommentSyntax("lib.rs")).toEqual({ open: "//" });
  });

  it("returns // for .php files", () => {
    expect(getCommentSyntax("index.php")).toEqual({ open: "//" });
  });

  it("returns # for .py files", () => {
    expect(getCommentSyntax("main.py")).toEqual({ open: "#" });
  });

  it("returns # for .sh files", () => {
    expect(getCommentSyntax("setup.sh")).toEqual({ open: "#" });
  });

  it("returns # for .yaml files", () => {
    expect(getCommentSyntax("config.yaml")).toEqual({ open: "#" });
  });

  it("returns # for .yml files", () => {
    expect(getCommentSyntax("ci.yml")).toEqual({ open: "#" });
  });

  it("returns # for .toml files", () => {
    expect(getCommentSyntax("Cargo.toml")).toEqual({ open: "#" });
  });

  it("returns # for .rb files", () => {
    expect(getCommentSyntax("script.rb")).toEqual({ open: "#" });
  });

  it("returns # for .gitignore files", () => {
    expect(getCommentSyntax(".gitignore")).toEqual({ open: "#" });
  });

  it("returns # for .env files", () => {
    expect(getCommentSyntax(".env")).toEqual({ open: "#" });
  });

  it("returns # for .dockerignore files", () => {
    expect(getCommentSyntax(".dockerignore")).toEqual({ open: "#" });
  });

  it("returns <!-- --> for .html files", () => {
    expect(getCommentSyntax("index.html")).toEqual({ open: "<!--", close: "-->" });
  });

  it("returns <!-- --> for .md files", () => {
    expect(getCommentSyntax("README.md")).toEqual({ open: "<!--", close: "-->" });
  });

  it("returns <!-- --> for .mdx files", () => {
    expect(getCommentSyntax("doc.mdx")).toEqual({ open: "<!--", close: "-->" });
  });

  it("returns -- for .sql files", () => {
    expect(getCommentSyntax("schema.sql")).toEqual({ open: "--" });
  });

  it("returns -- for .psql files", () => {
    expect(getCommentSyntax("query.psql")).toEqual({ open: "--" });
  });

  it("returns # for Dockerfile (case-insensitive)", () => {
    expect(getCommentSyntax("Dockerfile")).toEqual({ open: "#" });
    expect(getCommentSyntax("dockerfile")).toEqual({ open: "#" });
  });

  it("returns # for Makefile", () => {
    expect(getCommentSyntax("Makefile")).toEqual({ open: "#" });
  });

  it("returns # for Gemfile", () => {
    expect(getCommentSyntax("Gemfile")).toEqual({ open: "#" });
  });

  it("returns null for .json files", () => {
    expect(getCommentSyntax("package.json")).toBeNull();
    expect(getCommentSyntax("tsconfig.json")).toBeNull();
  });

  it("returns null for .png files", () => {
    expect(getCommentSyntax("logo.png")).toBeNull();
  });

  it("returns null for .jpg files", () => {
    expect(getCommentSyntax("photo.jpg")).toBeNull();
  });

  it("returns null for .pdf files", () => {
    expect(getCommentSyntax("doc.pdf")).toBeNull();
  });

  it("returns null for .zip files", () => {
    expect(getCommentSyntax("archive.zip")).toBeNull();
  });

  it("returns null for .lock files", () => {
    expect(getCommentSyntax("yarn.lock")).toBeNull();
    expect(getCommentSyntax("package-lock.json")).toBeNull();
  });

  it("returns null for unknown extensions", () => {
    expect(getCommentSyntax("data.bin")).toBeNull();
    expect(getCommentSyntax("output.xyz")).toBeNull();
  });

  it("returns null for files with no extension (not in special list)", () => {
    expect(getCommentSyntax("LICENSE")).toBeNull();
    expect(getCommentSyntax("README")).toBeNull();
  });

  it("handles deep paths correctly", () => {
    expect(getCommentSyntax("a/b/c/d/e/file.ts")).toEqual({ open: "//" });
    expect(getCommentSyntax("../../outside.py")).toEqual({ open: "#" });
  });
});

describe("injectVersionHeader", () => {
  const syntaxJS: CommentSyntax = { open: "//" };
  const syntaxPy: CommentSyntax = { open: "#" };
  const syntaxHTML: CommentSyntax = { open: "<!--", close: "-->" };
  const syntaxSQL: CommentSyntax = { open: "--" };

  describe("new headers (no existing xcoder header)", () => {
    it("prepends a new header for JS/TS syntax", () => {
      const meta = makeMeta();
      const content = "const x = 1;\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toMatch(/^\/\/ xcoder:version 3/);
      expect(result.content).toContain("const x = 1;");
    });

    it("prepends a new header for Python syntax", () => {
      const meta = makeMeta({ version: 7 });
      const content = 'print("hello")\n';
      const result = injectVersionHeader(content, syntaxPy, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toMatch(/^# xcoder:version 7/);
    });

    it("prepends a new header for HTML/MD syntax", () => {
      const meta = makeMeta({ version: 2 });
      const content = "# Title\n\nHello\n";
      const result = injectVersionHeader(content, syntaxHTML, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toMatch(/^<!-- xcoder:version 2/);
      expect(result.content).toContain("-->");
      expect(result.content).toContain("# Title");
    });

    it("prepends a new header for SQL syntax", () => {
      const meta = makeMeta();
      const content = "SELECT * FROM users;\n";
      const result = injectVersionHeader(content, syntaxSQL, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toMatch(/^-- xcoder:version 3/);
    });

    it("includes all metadata fields", () => {
      const meta = makeMeta();
      const content = "code\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.content).toContain("xcoder:version 3");
      expect(result.content).toContain("xcoder:task TASK-TEST");
      expect(result.content).toContain("xcoder:updated 2026-01-23T10:30:00.000Z");
      expect(result.content).toContain("xcoder:subtask test-st-abc123");
    });

    it("preserves all original content after the header", () => {
      const meta = makeMeta();
      const content = "line 1\nline 2\nline 3";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.content).toContain("line 1");
      expect(result.content).toContain("line 2");
      expect(result.content).toContain("line 3");
      // xcoder header should be the first line
      expect(result.content.indexOf("xcoder:version")).toBeLessThan(
        result.content.indexOf("line 1")
      );
    });

    it("handles empty content", () => {
      const meta = makeMeta();
      const content = "";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toContain("xcoder:version 3");
    });
  });

  describe("shebang preservation", () => {
    it("inserts header after shebang line", () => {
      const meta = makeMeta();
      const content = "#!/usr/bin/env node\nconsole.log('hi');\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(true);
      const lines = result.content.split("\n");
      expect(lines[0]).toBe("#!/usr/bin/env node");
      expect(lines[1]).toContain("xcoder:version");
    });

    it("handles Python shebang", () => {
      const meta = makeMeta();
      const content = "#!/usr/bin/env python3\nimport os\n";
      const result = injectVersionHeader(content, syntaxPy, meta);
      const lines = result.content.split("\n");
      expect(lines[0]).toBe("#!/usr/bin/env python3");
      expect(lines[1]).toContain("xcoder:version");
    });

    it("does not treat shebang-like lines mid-file as special", () => {
      const meta = makeMeta();
      const content = "#!/bin/bash\necho hello\nexit 0\n";
      const result = injectVersionHeader(content, { open: "#" }, meta);
      const lines = result.content.split("\n");
      expect(lines[0]).toBe("#!/bin/bash");
      expect(lines[1]).toContain("xcoder:version");
    });
  });

  describe("updating existing headers", () => {
    it("replaces an existing single-line xcoder header (//)", () => {
      const meta = makeMeta({ version: 5, subtaskId: "new-st-999" });
      const content =
        "// xcoder:version 3 | xcoder:task TASK-OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old-st-000\n" +
        "const x = 1;\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(false);
      expect(result.content).toContain("xcoder:version 5");
      expect(result.content).toContain("new-st-999");
      expect(result.content).not.toContain("xcoder:version 3");
      expect(result.content).toContain("const x = 1;");
    });

    it("replaces an existing hash-based xcoder header (#)", () => {
      const meta = makeMeta({ version: 4 });
      const content =
        "# xcoder:version 2 | xcoder:task OLD | xcoder:updated 2025-06-01T00:00:00.000Z | xcoder:subtask old\n" +
        "import sys\n";
      const result = injectVersionHeader(content, syntaxPy, meta);
      expect(result.isNew).toBe(false);
      expect(result.content).toContain("xcoder:version 4");
      expect(result.content).not.toContain("xcoder:version 2");
    });

    it("replaces an existing HTML-comment xcoder header", () => {
      const meta = makeMeta({ version: 10 });
      const content =
        "<!-- xcoder:version 1 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old -->\n" +
        "# Title\n";
      const result = injectVersionHeader(content, syntaxHTML, meta);
      expect(result.isNew).toBe(false);
      expect(result.content).toContain("xcoder:version 10");
      expect(result.content).toContain("<!--");
      expect(result.content).toContain("-->");
      // "xcoder:version 1" shouldn't appear as a standalone version (but
      // "xcoder:version 10" contains the substring — use the version + trailing space)
      expect(result.content).not.toContain("xcoder:version 1 ");
    });

    it("replaces an existing SQL-comment xcoder header", () => {
      const meta = makeMeta({ version: 6 });
      const content =
        "-- xcoder:version 1 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old\n" +
        "SELECT 1;\n";
      const result = injectVersionHeader(content, syntaxSQL, meta);
      expect(result.isNew).toBe(false);
      expect(result.content).toContain("xcoder:version 6");
      expect(result.content).not.toContain("xcoder:version 1");
    });

    it("updates only the first xcoder header if multiple exist", () => {
      const meta = makeMeta({ version: 9 });
      // Two xcoder header lines — the second one might be in content on purpose
      const content =
        "// xcoder:version 3 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old\n" +
        "// xcoder:version 3 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old\n" +
        "actual code\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      // The first one should be updated, second one still references old
      expect(result.isNew).toBe(false);
      expect(result.content).toContain("xcoder:version 9");
      // The second header line still contains version 3 — it's part of the original "content"
      expect((result.content.match(/xcoder:version 9/g) || []).length).toBe(1);
    });

    it("recognises xcoder headers even with leading whitespace", () => {
      const meta = makeMeta({ version: 11 });
      const content =
        "   // xcoder:version 2 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old\n" +
        "code\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(false);
      expect(result.content).toContain("xcoder:version 11");
    });
  });

  describe("edge cases", () => {
    it("handles single-line content", () => {
      const meta = makeMeta();
      const content = "single line";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toContain("single line");
    });

    it("does not confuse similar but non-xcoder comments as headers", () => {
      const meta = makeMeta();
      const content =
        "// This is a normal comment about version 5\n" +
        "const x = 1;\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      // Should be treated as new header since "xcoder:version" is not present
      expect(result.isNew).toBe(true);
      expect(result.content).toContain("xcoder:version");
      expect(result.content).toContain("normal comment about version 5");
    });

    it("treats xcoder:version at the start of a line (after comment marker) as an existing header", () => {
      const meta = makeMeta({ version: 8 });
      const content =
        "// xcoder:version 1 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old\n" +
        "code\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      // The regex matches xcoder:version after comment markers at line start
      expect(result.isNew).toBe(false);
    });

    it("does NOT treat xcoder:version mid-line as an existing header", () => {
      const meta = makeMeta({ version: 8 });
      const content =
        "some text // xcoder:version 1 | xcoder:task OLD | xcoder:updated 2025-01-01T00:00:00.000Z | xcoder:subtask old\n" +
        "code\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      // The regex is anchored to start-of-line (after optional ws and comment marker)
      // Mid-line occurrences don't match, so a new header is prepended
      expect(result.isNew).toBe(true);
    });

    it("handles extremely long metadata fields", () => {
      const meta = makeMeta({
        taskId: "TASK-" + "X".repeat(200),
        subtaskId: "subtask-" + "Y".repeat(200),
      });
      const content = "code\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.content).toContain(meta.taskId);
      expect(result.content).toContain(meta.subtaskId);
    });

    it("handles content starting with a blank line", () => {
      const meta = makeMeta();
      const content = "\n\ncode\n";
      const result = injectVersionHeader(content, syntaxJS, meta);
      expect(result.isNew).toBe(true);
      expect(result.content).toContain("xcoder:version");
      expect(result.content).toContain("code");
    });
  });
});
