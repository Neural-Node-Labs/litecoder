// xcoder:version 12 | xcoder:task task-7f2823 | xcoder:updated 2026-08-03T09:37:38.426Z | xcoder:subtask code-st-e8e2bf
import { describe, it, expect } from "vitest";
import {
  stripXmlTags,
  sanitizeControlCharacters,
  extractOutermostJson,
  normalizeReactShape,
  parseReactMessage,
} from "./react-contract.js";

// ── stripXmlTags ──

describe("stripXmlTags", () => {
  it("returns input unchanged when there are no XML tags", () => {
    const input = '{"thought": "hello", "action": null, "final_answer": {"summary": "x", "deliverable": null}}';
    expect(stripXmlTags(input)).toBe(input);
  });

  it("strips <thought>...</thought> envelope (lowercase)", () => {
    const input = "<thought>\nsome content\n</thought>";
    expect(stripXmlTags(input)).toBe("some content");
  });

  it("strips <thinking>...</thinking> envelope", () => {
    const input = "<thinking>process notes</thinking>";
    expect(stripXmlTags(input)).toBe("process notes");
  });

  it("strips <response>...</response> envelope", () => {
    const input = "<response>here is the answer</response>";
    expect(stripXmlTags(input)).toBe("here is the answer");
  });

  it("strips <answer>...</answer> envelope", () => {
    const input = "<answer>42</answer>";
    expect(stripXmlTags(input)).toBe("42");
  });

  it("handles case-insensitive tag names", () => {
    expect(stripXmlTags("<Thought>content</Thought>")).toBe("content");
    expect(stripXmlTags("<THINKING>content</THINKING>")).toBe("content");
    expect(stripXmlTags("<Response>content</Response>")).toBe("content");
    expect(stripXmlTags("<Answer>content</Answer>")).toBe("content");
  });

  it("handles tags with whitespace inside angle brackets", () => {
    expect(stripXmlTags("< thought >content</ thought >")).toBe("content");
    expect(stripXmlTags("<  thinking  >x</  thinking  >")).toBe("x");
  });

  it("only strips outer tags, not nested ones", () => {
    const input = "<thought>outer <thought>inner</thought> still outer</thought>";
    const result = stripXmlTags(input);
    // Only outermost tags removed; inner tags preserved
    expect(result).toBe("outer <thought>inner</thought> still outer");
  });

  it("handles input with only opening tag (no closing tag)", () => {
    const input = "<thought>unclosed content";
    // Opening tag stripped, content kept
    expect(stripXmlTags(input)).toBe("unclosed content");
  });

  it("handles input with only a closing tag (no opening tag)", () => {
    const input = "content</thought>";
    // No opening tag matched, so closing tag is preserved
    expect(stripXmlTags(input)).toBe("content</thought>");
  });

  it("handles whitespace-only input", () => {
    expect(stripXmlTags("   ")).toBe("");
  });

  it("handles empty string", () => {
    expect(stripXmlTags("")).toBe("");
  });

  it("does not treat non-matching tags as XML envelopes", () => {
    const input = "<code>some code</code>";
    expect(stripXmlTags(input)).toBe("<code>some code</code>");
  });

  it("does not strip tags in the middle of content", () => {
    const input = "text <thought> mid</thought> more";
    // Only outer tags at start/end are stripped
    expect(stripXmlTags(input)).toBe("text <thought> mid</thought> more");
  });

  it("strips opening tag even when JSON content follows", () => {
    const input = `<thought>\n{"thought": "x"}\n</thought>`;
    expect(stripXmlTags(input)).toBe('{"thought": "x"}');
  });

  it("asymmetric handling of tags with attributes — DEFECT-0003: closing tag stripped, opening preserved", () => {
    // Known defect (see defects/defect0003.md): opening tag with attributes
    // is not matched by XML_TAG_PATTERN, but closing tag IS matched by
    // XML_CLOSE_PATTERN, leading to partial stripping.
    // This test encodes current behaviour; the fix should make both tags
    // preserved when attributes are present on the opening tag.
    const input = "<thought class='x'>content</thought>";
    // Fixed: both tags preserved when opening tag has attributes
    expect(stripXmlTags(input)).toBe("<thought class='x'>content</thought>");
  });

  it("handles tag-like content that starts with < but is not an envelope tag", () => {
    const input = "<div>not an envelope</div>";
    expect(stripXmlTags(input)).toBe("<div>not an envelope</div>");
  });
});

// ── extractOutermostJson ──

describe("extractOutermostJson", () => {
  it("extracts a simple JSON object", () => {
    const input = '{"key": "value"}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("extracts JSON object from surrounding text", () => {
    const input = 'prefix text {"key": "value"} suffix text';
    expect(extractOutermostJson(input)).toBe('{"key": "value"}');
  });

  it("extracts nested JSON object", () => {
    const input = '{"outer": {"inner": 42}}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("finds outermost balanced braces when multiple exist", () => {
    const input = '{"a": {"b": 1}} extra {"c": 2}';
    // Should return only the first outermost block
    expect(extractOutermostJson(input)).toBe('{"a": {"b": 1}}');
  });

  it("handles braces inside JSON strings", () => {
    const input = '{"text": "this has {braces} inside"}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("handles escaped quotes inside JSON strings", () => {
    const input = '{"text": "she said \\"hello\\""}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("handles escaped backslash before quote", () => {
    const input = '{"path": "C:\\\\Users"}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("returns empty string when no braces are found", () => {
    expect(extractOutermostJson("just plain text")).toBe("");
    expect(extractOutermostJson("")).toBe("");
    expect(extractOutermostJson("[]")).toBe("");
  });

  it("handles unbalanced opening brace (no closing brace)", () => {
    const input = '{"incomplete": true';
    expect(extractOutermostJson(input)).toBe("");
  });

  it("handles unbalanced closing brace before opening brace", () => {
    const input = '} stray closing {"key": 1}';
    // The stray } resets, so we pick up the actual object
    expect(extractOutermostJson(input)).toBe('{"key": 1}');
  });

  it("handles complex real-world model output with prose before JSON", () => {
    const input = `I'll search for that file now.

{"thought": "searching", "action": {"tool": "grep", "input": {"pattern": "test"}}}`;
    expect(extractOutermostJson(input)).toBe(
      '{"thought": "searching", "action": {"tool": "grep", "input": {"pattern": "test"}}}'
    );
  });

  it("handles complex JSON with arrays and nested objects", () => {
    const input = '{"arr": [1, 2, 3], "obj": {"nested": true}}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("extracts only the first outermost JSON block when multiple exist", () => {
    const input = '{"first": 1} some text {"second": 2}';
    expect(extractOutermostJson(input)).toBe('{"first": 1}');
  });

  it("handles unbalanced closing brace resetting after first block ends", () => {
    const input = '{"first": 1} stray } {"second": 2}';
    expect(extractOutermostJson(input)).toBe('{"first": 1}');
  });

  it("handles closing brace inside a JSON string (escaped or literal)", () => {
    // A literal } inside a string should not decrement the counter
    const input = '{"text": "value with } inside"}';
    expect(extractOutermostJson(input)).toBe(input);
  });

  it("handles escaped backslash-quote fusion inside string", () => {
    const input = '{"text": "escape \\\\\\"fake end"}';
    // The pattern \\\" is an escaped backslash followed by an escaped quote
    // Both the backslash and the quote are consumed, string continues
    expect(extractOutermostJson(input)).toBe(input);
  });
});

// ── sanitizeControlCharacters ──

describe("sanitizeControlCharacters", () => {
  it("returns input unchanged when there are no control characters", () => {
    const input = '{"key": "value"}';
    expect(sanitizeControlCharacters(input)).toBe(input);
  });

  it("escapes a literal newline inside a string value", () => {
    const input = '{"content": "line one\nline two"}';
    expect(sanitizeControlCharacters(input)).toBe(
      '{"content": "line one\\nline two"}'
    );
  });

  it("escapes literal tab and carriage return inside a string value", () => {
    const input = '{"a": "x\ty\rz"}';
    expect(sanitizeControlCharacters(input)).toBe('{"a": "x\\ty\\rz"}');
  });

  it("escapes other control characters via \\u escapes", () => {
    const input = '{"a": "x\u0001y"}';
    expect(sanitizeControlCharacters(input)).toBe('{"a": "x\\u0001y"}');
  });

  it("leaves whitespace between JSON tokens (outside strings) untouched", () => {
    const input = '{\n  "a": 1,\n  "b": 2\n}';
    expect(sanitizeControlCharacters(input)).toBe(input);
  });

  it("leaves prose newlines before the JSON block untouched", () => {
    const input = 'Here is my plan:\nline two\n{"a": 1}';
    expect(sanitizeControlCharacters(input)).toBe(input);
  });

  it("does not double-escape an already-escaped newline", () => {
    const input = '{"a": "already\\nescaped"}';
    expect(sanitizeControlCharacters(input)).toBe(input);
  });

  it("handles multiple multi-line string values", () => {
    const input = '{"a": "one\ntwo", "b": "three\nfour"}';
    expect(sanitizeControlCharacters(input)).toBe(
      '{"a": "one\\ntwo", "b": "three\\nfour"}'
    );
  });

  it("round-trips through JSON.parse after sanitizing", () => {
    const input = '{"thought": "hi", "action": {"tool": "write_file", "input": {"content": "# Title\nBody text\nmore body"}}, "final_answer": null}';
    const sanitized = sanitizeControlCharacters(input);
    expect(() => JSON.parse(sanitized)).not.toThrow();
    const parsed = JSON.parse(sanitized);
    expect(parsed.action.input.content).toBe("# Title\nBody text\nmore body");
  });

  it("handles empty string", () => {
    expect(sanitizeControlCharacters("")).toBe("");
  });
});

// ── parseReactMessage layered recovery integration tests ──

describe("parseReactMessage layered recovery", () => {
  it("parses JSON wrapped in XML thought tags", () => {
    const body = JSON.stringify({
      thought: "I should search the workspace",
      action: { tool: "search_workspace", input: { query: "src" } },
      final_answer: null,
    });
    const raw = `<thought>\n${body}\n</thought>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("I should search the workspace");
    }
  });

  it("parses JSON wrapped in XML thinking tags", () => {
    const body = JSON.stringify({
      thought: "done",
      action: null,
      final_answer: { summary: "x", deliverable: null, files_touched: [] },
    });
    const raw = `<thinking>\n${body}\n</thinking>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("done");
    }
  });

  it("parses JSON wrapped in XML response tags", () => {
    const body = JSON.stringify({
      thought: "final",
      action: null,
      final_answer: { summary: "y", deliverable: null, files_touched: [] },
    });
    const raw = `<response>${body}</response>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("final");
    }
  });

  it("parses JSON wrapped in XML answer tags", () => {
    const body = JSON.stringify({
      thought: "answer",
      action: null,
      final_answer: { summary: "z", deliverable: null, files_touched: [] },
    });
    const raw = `<answer>${body}</answer>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("answer");
    }
  });

  it("recovers JSON with prose prefix (via outermost extraction)", () => {
    const body = JSON.stringify({
      thought: "recovered",
      action: { tool: "glob", input: {} },
      final_answer: null,
    });
    const raw = `Here is my response:\n${body}`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("recovered");
    }
  });

  it("returns thought-only for pure prose with no JSON (Layer 4a)", () => {
    // Layer 4a recovers prose-only responses as thought-only messages.
    // This turns "I just want to talk" into a valid message with no action
    // and no final_answer, so agents can handle it naturally.
    const raw = "this is completely invalid and has no JSON at all";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("this is completely invalid and has no JSON at all");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("returns thought-only for XML-enveloped prose with no extractable JSON (Layer 4b)", () => {
    // Layer 4b recovers XML-wrapped pure prose as thought-only messages.
    // This covers the case where the model wraps prose in XML tags without
    // any JSON block inside.
    const raw = "<thought>Just thinking out loud, no JSON here</thought>";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("Just thinking out loud, no JSON here");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("fails when recovery produces JSON that fails schema validation", () => {
    // XML tags + prose that forces outermost-JSON extraction.
    // The extracted JSON is valid JSON but missing required fields.
    const raw = '<thought>Some prose prefix {"notAThought": "hmm"} some suffix</thought>';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("parsed via recovery, but failed schema validation");
    }
  });

  it("handles XML tags + prose prefix combined", () => {
    const body = JSON.stringify({
      thought: "combined",
      action: { tool: "read_file", input: { path: "x.ts" } },
      final_answer: null,
    });
    const raw = `Let me think about this...<thought>\n${body}\n</thought>`;
    const result = parseReactMessage(raw);
    // XML stripping handles outer tags, then outermost JSON extraction
    // finds the JSON after removing the enclosing tags
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("combined");
    }
  });

  it("still works with original markdown-fence wrapped JSON", () => {
    const body = JSON.stringify({
      thought: "fenced",
      action: null,
      final_answer: { summary: "a", deliverable: null, files_touched: [] },
    });
    const raw = `\`\`\`json\n${body}\n\`\`\``;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("fenced");
    }
  });

  it("includes recovery note in error for irrecoverable input", () => {
    const raw = "{ broken";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("layers attempted");
      expect(result.error).toContain("[raw preview:");
    }
  });

  it("does not report recovery when first attempt succeeds", () => {
    const body = JSON.stringify({
      thought: "clean",
      action: { tool: "glob", input: {} },
      final_answer: null,
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("clean");
    }
  });

  it("handles the exact protocol_error.log failure: XML-wrapped JSON", () => {
    // Reproduce the exact failure from logs
    const raw = `<thought>\nThe debate report references several files: src/protoco./react-contract.ts is key. I need to read it, along with any test files, to understand the current implementation and the proposed fix. Then I'll read the rest of the debate to extract the agreed-upon solution. Let me explore the source and see what exists.\n</thought>\n\n\`\`\`json\n{\n  "thought": "exploring workspace",
  "action": {\n    "tool": "read_file",\n    "input": {\n      "path": "src/protoco./react-contract.ts"\n    }\n  },\n  "final_answer": null\n}\n\`\`\``;
    const result = parseReactMessage(raw);
    // This should recover via xml stripping + fence removal
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("exploring workspace");
      expect(result.message.action?.tool).toBe("read_file");
    }
  });

  it("handles truncated empty response from protocol_error.log", () => {
    const raw = "";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("layers attempted");
    }
  });

  it("auto-recovers valid JSON that is missing the thought field (Layer 5) (Zod Required error)", () => {
    // Layer 5 auto-thought recovery: missing thought with valid action → auto-generates thought → ok:true
    const body = JSON.stringify({
      action: { tool: "grep", input: { pattern: "x" } },
      final_answer: null,
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("[auto]");
      expect(result.message.action?.tool).toBe("grep");
    }
  });

  it("rejects JSON with both action and final_answer present (superRefine)", () => {
    const body = JSON.stringify({
      thought: "both present",
      action: { tool: "grep", input: {} },
      final_answer: { summary: "x", deliverable: null, files_touched: [] },
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("exactly one");
    }
  });

  it("rejects JSON with both action and final_answer null (superRefine)", () => {
    const body = JSON.stringify({
      thought: "both null",
      action: null,
      final_answer: null,
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("exactly one");
    }
  });

  it("auto-recovers JSON with empty thought string (Layer 5)", () => {
    // Layer 5: empty thought + valid action → auto-generates thought → ok:true
    const body = JSON.stringify({
      thought: "",
      action: { tool: "glob", input: {} },
      final_answer: null,
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("[auto]");
      expect(result.message.action?.tool).toBe("glob");
    }
  });

  it("accepts valid final_answer message shape", () => {
    const body = JSON.stringify({
      thought: "done",
      action: null,
      final_answer: { summary: "all good", deliverable: { result: 42 }, files_touched: [] },
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.final_answer?.summary).toBe("all good");
    }
  });

  it("accepts JSON with extra unknown fields (Zod strips by default)", () => {
    const body = JSON.stringify({
      thought: "extra",
      action: { tool: "search_workspace", input: { query: "x" } },
      final_answer: null,
      extra_field: "should be ignored",
    });
    const result = parseReactMessage(body);
    // Zod schema ignores unknown fields by default unless .strict()
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("extra");
    }
  });
});

// ── normalizeReactShape unit tests ──

describe("normalizeReactShape", () => {
  // ── AC-1: prose prefix backfills missing thought ──
  it("prose prefix backfills missing thought", () => {
    const raw = "Let me check that for you.\n{\"action\": {\"tool\": \"grep\", \"input\": {}}}";
    const json = JSON.parse('{"action": {"tool": "grep", "input": {}}}');
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    expect((result.normalized as Record<string, unknown>).thought).toBe(
      "Let me check that for you."
    );
  });

  // ── AC-1b: empty thought backfilled from prose ──
  it("prose prefix backfills empty thought string", () => {
    const raw = "Here is the answer.\n{\"thought\": \"\", \"action\": {\"tool\": \"x\", \"input\": {}}}";
    const json = JSON.parse('{"thought": "", "action": {"tool": "x", "input": {}}}');
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    expect((result.normalized as Record<string, unknown>).thought).toBe(
      "Here is the answer."
    );
  });

  // ── AC-1c: null thought backfilled from prose ──
  it("prose prefix backfills null thought", () => {
    const raw = "Some prose.\n{\"thought\": null, \"action\": {\"tool\": \"x\", \"input\": {}}}";
    const json = JSON.parse('{"thought": null, "action": {"tool": "x", "input": {}}}');
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    expect((result.normalized as Record<string, unknown>).thought).toBe(
      "Some prose."
    );
  });

  // ── AC-2: prose prefix does NOT overwrite existing thought ──
  it("prose prefix does not overwrite existing thought", () => {
    const raw = "Ignore this prose.\n{\"thought\": \"preserved\", \"action\": {\"tool\": \"grep\", \"input\": {}}}";
    const json = JSON.parse(
      '{"thought": "preserved", "action": {"tool": "grep", "input": {}}}'
    );
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(false);
    expect((result.normalized as Record<string, unknown>).thought).toBe(
      "preserved"
    );
  });

  // ── AC-3: bare tool wrapped in action ──
  it("bare tool wrapped in action", () => {
    const raw = '{"tool": "grep", "input": {"pattern": "x"}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.tool).toBeUndefined();
    expect(norm.input).toBeUndefined();
    expect(norm.action).toBeDefined();
    const action = norm.action as Record<string, unknown>;
    expect(action.tool).toBe("grep");
    expect(action.input).toEqual({ pattern: "x" });
  });

  // ── AC-3b: bare tool with only tool key (no input) ──
  it("bare tool with only tool key wrapped", () => {
    const raw = '{"tool": "search_workspace"}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const action = (result.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(action.tool).toBe("search_workspace");
    expect(action.input).toBeUndefined();
  });

  // ── AC-4: bare tool + prose thought combined ──
  it("bare tool + prose thought combined", () => {
    const raw = "Searching now.\n{\"tool\": \"grep\", \"input\": {}}";
    const json = JSON.parse('{"tool": "grep", "input": {}}');
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("Searching now.");
    expect(norm.action).toBeDefined();
  });

  // ── AC-5: nested thought hoisted ──
  it("nested thought hoisted", () => {
    const raw =
      '{"action": {"tool": "grep", "input": {}, "thought": "finding files"}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("finding files");
    const action = norm.action as Record<string, unknown>;
    expect(action.thought).toBeUndefined();
    expect(action.tool).toBe("grep");
  });

  // ── AC-6: nested thought does not overwrite top-level ──
  it("nested thought does not overwrite top-level thought", () => {
    const raw =
      '{"thought": "top level", "action": {"tool": "grep", "input": {}, "thought": "nested"}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("top level");
    // nested thought should remain since we didn't hoist
    const action = norm.action as Record<string, unknown>;
    expect(action.thought).toBe("nested");
  });

  // ── AC-7: combined: action with nested thought + prose (prose wins) ──
  it("combined: prose wins over nested thought in action", () => {
    // LLM emits prose prefix + action object that has a nested `thought`.
    // Step 1 backfills thought from prose; Step 3 sees top-level thought
    // already present → guard prevents hoisting, so prose wins.
    const raw =
      "Prose reasoning.\n{\"action\": {\"tool\": \"grep\", \"input\": {}, \"thought\": \"nested\"}}";
    const json = JSON.parse(
      '{"action": {"tool": "grep", "input": {}, "thought": "nested"}}'
    );
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    // Prose prefix wins: thought is from prose, not from nested
    expect(norm.thought).toBe("Prose reasoning.");
    // Action is preserved with tool and input, but thought is hoisted...
    // wait: Step 1 sets thought from prose, Step 3 sees existing thought → skip.
    // So action.thought remains.
    const action = norm.action as Record<string, unknown>;
    expect(action.tool).toBe("grep");
    expect(action.thought).toBe("nested"); // not hoisted because top-level exists
  });

  // ── AC-8: bare final_answer NOT auto-wrapped ──
  it("bare final_answer shape NOT auto-wrapped", () => {
    const raw =
      '{"summary": "done", "deliverable": null, "files_touched": []}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // No normalization should apply — passes through
    expect(result.applied).toBe(false);
    // Original keys should be intact
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.summary).toBe("done");
    expect(norm.action).toBeUndefined();
  });

  // ── AC-8b: bare object with tool AND summary is NOT auto-wrapped (summary is final_answer guard) ──
  it("bare object with tool AND summary is NOT auto-wrapped (final_answer guard)", () => {
    // When summary (a final_answer key) is present, the guard prevents
    // bare-tool wrapping to avoid destroying a potential final_answer shape
    const raw = '{"tool": "grep", "input": {}, "summary": "searching"}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // Has summary → final_answer guard fires → no wrap
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.tool).toBe("grep");
    expect(norm.summary).toBe("searching");
    expect(norm.action).toBeUndefined();
  });

  // ── AC-9: well-formed message passes through unchanged ──
  it("well-formed message passes through unchanged", () => {
    const raw = JSON.stringify({
      thought: "valid thought",
      action: { tool: "grep", input: { pattern: "x" } },
      final_answer: null,
    });
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("valid thought");
    expect((norm.action as Record<string, unknown>).tool).toBe("grep");
  });

  // ── AC-10: empty thought still fails schema after normalization ──
  it("empty thought + no prose still empty (normalization won't rescue)", () => {
    const raw =
      '{"thought": "", "action": {"tool": "grep", "input": {}}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // No prose prefix to backfill, thought remains empty
    // Normalization does not magically create a thought
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("");
  });

  // ── AC-10b: both null still fails schema ──
  it("both-null still fails schema after normalization", () => {
    const raw =
      '{"thought": "x", "action": null, "final_answer": null}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // Normalization doesn't touch action/final_answer
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.action).toBeNull();
    expect(norm.final_answer).toBeNull();
  });

  // ── AC-10c: both present still fails schema ──
  it("both-present still fails schema after normalization", () => {
    const raw = JSON.stringify({
      thought: "x",
      action: { tool: "grep", input: {} },
      final_answer: { summary: "y", deliverable: null, files_touched: [] },
    });
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // Normalization doesn't touch action/final_answer
    expect(result.applied).toBe(false);
  });

  // ── Edge case: non-object input ──
  it("returns unchanged for non-object input", () => {
    const result = normalizeReactShape("", "string value");
    expect(result.applied).toBe(false);
    expect(result.normalized).toBe("string value");
  });

  // ── Edge case: null input ──
  it("returns unchanged for null input", () => {
    const result = normalizeReactShape("", null);
    expect(result.applied).toBe(false);
    expect(result.normalized).toBeNull();
  });

  // ── Edge case: prose with no braces ──
  it("returns unchanged when raw has no opening brace", () => {
    const raw = "just prose";
    const json = JSON.parse('{"thought": "ok", "action": {"tool": "x", "input": {}}}');
    const result = normalizeReactShape("just prose", json);
    // No '{' to find prose before → no backfill
    // But the input is already valid so applied stays false
    expect(result.applied).toBe(false);
  });

  // ── Edge case: action key already exists, no bare-tool wrap ──
  it("does not auto-wrap when action key already exists", () => {
    const raw =
      '{"tool": "should-be-ignored", "action": {"tool": "grep", "input": {}}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // action key exists, so guard prevents bare-tool wrap
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    // tool at top level remains (schema will strip or reject it)
    expect(norm.tool).toBe("should-be-ignored");
    expect(norm.action).toBeDefined();
  });

  // ── AC-12: command→tool alias: command renamed to tool inside action ──
  it("renames action.command to action.tool when tool is absent", () => {
    const raw =
      '{"thought": "searching", "action": {"command": "grep", "input": {"pattern": "x"}}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    const action = norm.action as Record<string, unknown>;
    expect(action.tool).toBe("grep");
    expect(action.command).toBeUndefined();
    expect(action.input).toEqual({ pattern: "x" });
  });

  // ── AC-12b: command→tool alias: no-op when tool already present ──
  it("does not rename when tool key already exists alongside command", () => {
    const raw =
      '{"thought": "x", "action": {"command": "grep", "tool": "read_file", "input": {}}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(false);
    const action = (result.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(action.tool).toBe("read_file"); // preserved, not overwritten
    expect(action.command).toBe("grep");   // left as-is
  });

  // ── AC-12c: command→tool alias: no-op when command is empty string ──
  it("does not rename when action.command is an empty string", () => {
    const raw =
      '{"thought": "x", "action": {"command": "", "input": {}}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(false);
    const action = (result.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(action.command).toBe("");
    expect(action.tool).toBeUndefined();
  });

  // ── AC-12d: command→tool alias: no-op when action.command is absent ──
  it("no-op when action has no command key", () => {
    const raw =
      '{"thought": "x", "action": {"tool": "grep", "input": {}}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(false);
    const action = (result.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(action.tool).toBe("grep");
  });

  // ── AC-12e: command→tool alias: only targets action.command, not bare-command ──
  it("does not rename bare-command at top level (only action.command)", () => {
    // bare-tool wrap (Step 2) handles bare-tool, not bare-command.
    // Step 4 only looks inside action objects — a top-level `command`
    // key should be left untouched by Step 4.
    const raw = '{"thought": "test", "command": "search"}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    // No normalization should apply to bare-command
    // (Step 2 only auto-wraps bare-tool, not bare-command)
    expect(result.applied).toBe(false);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.command).toBe("search");
    expect(norm.tool).toBeUndefined();
  });

  // ── AC-12f: command→tool alias: combined with prose backfill ──
  it("command→tool alias combined with prose backfill", () => {
    const raw =
      "Let me find that.\n{\"action\": {\"command\": \"grep\", \"input\": {\"pattern\": \"todo\"}}}";
    const json = JSON.parse(
      '{"action": {"command": "grep", "input": {"pattern": "todo"}}}'
    );
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("Let me find that.");
    const action = norm.action as Record<string, unknown>;
    expect(action.tool).toBe("grep");
    expect(action.command).toBeUndefined();
  });

  // ── AC-12g: command→tool alias: null/array action untouched ──
  it("does not touch null or non-object action values", () => {
    const rawNull =
      '{"thought": "x", "action": null}';
    const jsonNull = JSON.parse(rawNull);
    const resultNull = normalizeReactShape(rawNull, jsonNull);
    expect(resultNull.applied).toBe(false);

    const rawArr =
      '{"thought": "x", "action": ["not an object"]}';
    const jsonArr = JSON.parse(rawArr);
    const resultArr = normalizeReactShape(rawArr, jsonArr);
    expect(resultArr.applied).toBe(false);
  });

  // ── AC-12h: command→tool alias: non-string command values NOT renamed ──
  it("does not rename when action.command is not a string", () => {
    // numeric command
    const rawNum =
      '{"thought": "x", "action": {"command": 42, "input": {}}}';
    const jsonNum = JSON.parse(rawNum);
    const resultNum = normalizeReactShape(rawNum, jsonNum);
    expect(resultNum.applied).toBe(false);
    const actionNum = (resultNum.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(actionNum.command).toBe(42);
    expect(actionNum.tool).toBeUndefined();

    // null command
    const rawNull =
      '{"thought": "x", "action": {"command": null, "input": {}}}';
    const jsonNull = JSON.parse(rawNull);
    const resultNull = normalizeReactShape(rawNull, jsonNull);
    expect(resultNull.applied).toBe(false);
    const actionNull = (resultNull.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(actionNull.command).toBeNull();
    expect(actionNull.tool).toBeUndefined();

    // boolean command
    const rawBool =
      '{"thought": "x", "action": {"command": true, "input": {}}}';
    const jsonBool = JSON.parse(rawBool);
    const resultBool = normalizeReactShape(rawBool, jsonBool);
    expect(resultBool.applied).toBe(false);
    const actionBool = (resultBool.normalized as Record<string, unknown>)
      .action as Record<string, unknown>;
    expect(actionBool.command).toBe(true);
    expect(actionBool.tool).toBeUndefined();
  });

  // ── AC-12i: Combined nested-thought hoist + command→tool alias (iteration 62 pattern) ──
  it("combines nested-thought hoisting with command→tool alias in one pass", () => {
    // Reproduces the real-world payload from protocol_error.log iteration 62:
    // {action: {command: "grep", thought: "finding it", timeoutMs: 60000}}
    const raw =
      '{"action": {"command": "grep", "thought": "finding it", "timeoutMs": 60000}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true);
    const norm = result.normalized as Record<string, unknown>;
    // Step 3: nested thought hoisted to top level
    expect(norm.thought).toBe("finding it");
    // Step 4: command renamed to tool
    const action = norm.action as Record<string, unknown>;
    expect(action.tool).toBe("grep");
    expect(action.command).toBeUndefined();
    // Extra keys preserved
    expect(action.timeoutMs).toBe(60000);
    // Nested thought removed from action
    expect(action.thought).toBeUndefined();
  });

  // ── AC-12j: Combined nested-thought hoist + command→tool alias when tool also present ──
  it("hoists thought but does NOT rename command when tool already exists", () => {
    // When tool key already present, Step 4 guard prevents rename, but Step 3 still hoists
    const raw =
      '{"action": {"command": "grep", "tool": "read_file", "thought": "searching"}}';
    const json = JSON.parse(raw);
    const result = normalizeReactShape(raw, json);
    expect(result.applied).toBe(true); // true because thought was hoisted
    const norm = result.normalized as Record<string, unknown>;
    expect(norm.thought).toBe("searching");
    const action = norm.action as Record<string, unknown>;
    expect(action.tool).toBe("read_file"); // preserved, not overwritten by command
    expect(action.command).toBe("grep"); // preserved
    expect(action.thought).toBeUndefined(); // removed from action after hoist
  });
});

// ── normalizeReactShape integration tests via parseReactMessage ──

describe("parseReactMessage normalization integration", () => {
  it("normalization + auto-recovery note (AC-11 updated)", () => {
    // Normalization runs (bare tool → action wrap) AND Layer 5 auto-thought
    // recovery generates [auto] thought, so the message succeeds.
    const raw = '{"tool": "grep", "input": {}}';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("[auto]");
    }
  });

  it("full round-trip: prose + bare tool → valid message", () => {
    const raw = "Looking this up.\n{\"tool\": \"grep\", \"input\": {\"pattern\": \"test\"}}";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Looking this up.");
      expect(result.message.action?.tool).toBe("grep");
      expect(result.message.action?.input).toEqual({ pattern: "test" });
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("full round-trip: nested thought hoisting → valid message", () => {
    const raw =
      '{"action": {"tool": "grep", "input": {}, "thought": "finding it"}}';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("finding it");
      expect(result.message.action?.tool).toBe("grep");
      // The hoisted thought should not still be in action
    }
  });

  it("full round-trip: XML-wrapped with prose prefix + bare tool", () => {
    const raw =
      "<thought>Let me check the code.\n{\"tool\": \"read_file\", \"input\": {\"path\": \"x.ts\"}}</thought>";
    const result = parseReactMessage(raw);
    // XML stripped, then prose backfill + bare tool wrap
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Let me check the code.");
      expect(result.message.action?.tool).toBe("read_file");
    }
  });

  it("no normalization applied for well-formed message", () => {
    const body = JSON.stringify({
      thought: "all good",
      action: { tool: "search_workspace", input: {} },
      final_answer: null,
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("all good");
    }
  });

  it("recovery + normalization combined: xml + prose + bare tool", () => {
    // This forces XML stripping, then outermost-JSON extraction,
    // then normalization backfills thought and wraps bare tool
    const body = '{"tool": "glob", "input": {}}';
    const raw = `<thinking>Let me search.\n${body}</thinking>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Let me search.");
      expect(result.message.action?.tool).toBe("glob");
    }
  });

  it("full round-trip: prose + command→tool alias → valid message", () => {
    // Prose prefix provides thought, command gets renamed to tool
    const raw =
      "Let me find that.\n{\"action\": {\"command\": \"grep\", \"input\": {\"pattern\": \"test\"}}}";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Let me find that.");
      expect(result.message.action?.tool).toBe("grep");
      expect(result.message.action?.input).toEqual({ pattern: "test" });
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("full round-trip: combined hoist + command→tool alias (iteration 62)", () => {
    // Real-world payload: action with nested thought + command + extra key
    const raw =
      '{"action": {"command": "grep", "thought": "searching", "timeoutMs": 60000}}';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("searching");
      expect(result.message.action?.tool).toBe("grep");
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("full round-trip: prose + markdown-fenced JSON with command→tool alias", () => {
    // Simulates the production pattern from iterations 51-53:
    // prose commentary + ```json {action...} ``` with no thought key
    const raw =
      "Let me search the codebase for that pattern.\n```json\n{\"action\": {\"command\": \"grep\", \"input\": {\"pattern\": \"todo\"}}}\n```";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // NOTE: Known limitation — extractProsePrefix captures inline markdown
      // fence markers when they appear between prose and JSON.
      // See defects/defect0005.md for the tracking issue.
      expect(result.message.thought).toContain("Let me search the codebase");
      expect(result.message.action?.tool).toBe("grep");
      expect(result.message.action?.input).toEqual({ pattern: "todo" });
    }
  });

  it("full round-trip: prose + markdown-fenced JSON with bare tool (iteration 51-53 pattern)", () => {
    // Prose commentary + ```json {tool, input}``` — no action wrapper, no thought
    const raw =
      "Let me check the file structure.\n```json\n{\"tool\": \"glob\", \"input\": {\"pattern\": \"src/**/*.ts\"}}\n```";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // NOTE: Known limitation — extractProsePrefix captures inline markdown
      // fence markers when they appear between prose and JSON.
      // See defects/defect0005.md for the tracking issue.
      expect(result.message.thought).toContain("Let me check the file structure.");
      expect(result.message.action?.tool).toBe("glob");
      expect(result.message.action?.input).toEqual({ pattern: "src/**/*.ts" });
    }
  });

  it("recovers a write_file action whose content has literal (unescaped) newlines — reproduces the task-789d88 design-st-0e1a36 spiral", () => {
    // The model tried to write multi-line markdown as a JSON string value
    // using literal newlines instead of \n escapes, which JSON.parse
    // rejects outright ("Bad control character in string literal") before
    // any other layer even gets a chance to run.
    const raw =
      '{"thought":"writing the design doc","action":{"tool":"write_file","input":{"path":".scratch/design.md","content":"# Design\nSection one text here.\nSection two text here."}},"final_answer":null}';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.action?.tool).toBe("write_file");
      const input = result.message.action?.input as { content: string };
      expect(input.content).toBe(
        "# Design\nSection one text here.\nSection two text here."
      );
    }
  });

  it("recovers control characters even when recovery also needed XML-strip + outermost extraction", () => {
    const raw =
      '<thinking>Writing the file now.\n{"thought":"go","action":{"tool":"write_file","input":{"content":"a\nb"}},"final_answer":null}</thinking>';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const input = result.message.action?.input as { content: string };
      expect(input.content).toBe("a\nb");
    }
  });

  it("whitespace-only thought string gets backfilled from prose", () => {
    // Model emits thought: "   " (whitespace only) — should be backfilled
    const raw =
      "Here is the answer.\n{\"thought\": \"   \", \"action\": {\"tool\": \"read_file\", \"input\": {\"path\": \"x.ts\"}}}";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Here is the answer.");
      expect(result.message.action?.tool).toBe("read_file");
    }
  });
});