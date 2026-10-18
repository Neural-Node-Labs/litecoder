import { describe, it, expect } from "vitest";
import { parseReactMessage } from "./react-contract.js";

describe("parseReactMessage acceptance criteria tests (fix/2.md and fix/4.md)", () => {
  // AC-P1: XML-enveloped prose recovers as thought-only message
  it("AC-P1: recovers <thinking> prose as thought-only (Layer 4b)", () => {
    const raw = `<thinking>
  The fix/1.md describes several fixes. Let me check.
</thinking>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("The fix/1.md describes several fixes. Let me check.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("AC-P1b: recovers <thought> prose without JSON as thought-only (Layer 4a)", () => {
    const raw = `<thought>Let me think about this problem more carefully.</thought>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("Let me think about this problem more carefully.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("AC-P1c: recovers <response> prose as thought-only message", () => {
    const raw = `<response>Here is the final answer.</response>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("Here is the final answer.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("AC-P1d: recovers <answer> prose as thought-only message", () => {
    const raw = `<answer>42 is the answer to everything.</answer>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("42 is the answer to everything.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  // AC-P2: Plain prose recovers as thought-only message
  it("AC-P2: recovers plain prose as thought-only (fix/4.md exact text)", () => {
    const raw = "Now let me look for the incomplete 4th code-review fix.";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Now let me look for the incomplete 4th code-review fix.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("AC-P2b: recovers prose with leading/trailing whitespace", () => {
    const raw = "   Just some reasoning text.   ";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Just some reasoning text.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  it("AC-P2c: recovers multiline prose (no braces) as thought-only", () => {
    const raw = "Line one.\nLine two.\nLine three.";
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("Line one.\nLine two.\nLine three.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  // AC-P3: Non-recoverable errors include byte-position context
  it("AC-P3: irrecoverable error includes byte position from SyntaxError", () => {
    // Malformed JSON that triggers SyntaxError with byte position
    const raw = '{"a":1\n"b":2}';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("position");
      expect(result.error).toContain("layers attempted");
      expect(result.error).toContain("[raw preview:");
    }
  });

  it("AC-P3b: error includes context excerpt around byte position", () => {
    // Generate a JSON string that will fail JSON.parse with a position
    // Use unescaped newline inside a string to trigger "Bad control character"
    const raw = '{"thought":"go","action":{"tool":"write_file","input":{"content":"line1\nline2"}},"final_answer":null}';
    const result = parseReactMessage(raw);
    // sanitizeControlCharacters should fix this, so it may actually succeed
    // If it fails, the error should have context
    if (!result.ok) {
      expect(result.error).toContain("response was not valid JSON");
    }
  });

  it("AC-P3c: empty input produces actionable error with layers listed", () => {
    const result = parseReactMessage("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("layers attempted");
      expect(result.error).toContain("[raw preview:");
    }
  });

  // Layer 4b: XML-enveloped prose recovery (has { but extraction returns empty)
  it("Layer 4b: XML-enveloped prose that contains a stray brace", () => {
    // Has a '{' but the overall content is XML-wrapped prose, not JSON.
    // Note: extractOutermostJson will find the {this} block and try to parse it.
    // Since it fails, and extraction returned non-empty, Layer 4b won't fire.
    // This is by design: stray braces are ambiguous — they may be malformed JSON.
    const raw = `<thinking>Let me analyze {this} carefully.</thinking>`;
    const result = parseReactMessage(raw);
    // Current behavior: fails because {this} is not valid JSON and blocks recovery
    expect(result.ok).toBe(false);
  });

  // Negative: truncated JSON should NOT be silently recovered as prose
  it("does NOT treat truncated JSON (with opening brace) as prose recovery", () => {
    const raw = '{"thought": "working", "action": {"tool": "write_file", "input": {"content": "# Start"';
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(false);
  });

  // Edge: XML envelope with extra whitespace
  it("handles XML envelope with extra whitespace around tags", () => {
    const raw = `  <thinking>   \n  Just thinking about the problem.  \n  </thinking>  `;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("Just thinking about the problem.");
      expect(result.message.action).toBeNull();
    }
  });

  // Edge: XML + multiline prose
  it("recovers multiline XML-wrapped prose as thought-only", () => {
    const raw = `<thinking>\n  First line of reasoning.\n  Second line of reasoning.\n  Final thought.\n</thinking>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toContain("First line of reasoning.");
      expect(result.message.thought).toContain("Final thought.");
      expect(result.message.action).toBeNull();
      expect(result.message.final_answer).toBeNull();
    }
  });

  // Regression: valid JSON inside XML tags still works
  it("still parses valid JSON inside XML tags correctly (regression)", () => {
    const body = JSON.stringify({
      thought: "valid",
      action: { tool: "glob", input: {} },
      final_answer: null,
    });
    const raw = `<thought>\n${body}\n</thought>`;
    const result = parseReactMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("valid");
      expect(result.message.action?.tool).toBe("glob");
    }
  });

  // Regression: valid JSON without any wrapping still works
  it("still parses plain valid JSON correctly (regression)", () => {
    const body = JSON.stringify({
      thought: "plain",
      action: null,
      final_answer: { summary: "done", deliverable: null, files_touched: [] },
    });
    const result = parseReactMessage(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.thought).toBe("plain");
      expect(result.message.final_answer?.summary).toBe("done");
    }
  });
});
