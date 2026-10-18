// xcoder:version 2 | xcoder:task task-0684a6 | xcoder:updated 2026-08-03T10:25:10.547Z | xcoder:subtask test-st-5ed700
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks so vi.mock factory can reference them ──
const mockConfirm = vi.hoisted(() => vi.fn());
const mockIsCancel = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  confirm: mockConfirm,
  isCancel: mockIsCancel,
}));

import { confirmInterrupt } from "./confirm-interrupt.js";

describe("confirmInterrupt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: confirm returns true, isCancel returns false
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);
  });

  // ── Happy path: Yes ──
  it("returns true when the user confirms Yes", async () => {
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);

    const result = await confirmInterrupt();
    expect(result).toBe(true);
  });

  // ── Happy path: No ──
  it("returns false when the user answers No", async () => {
    mockConfirm.mockResolvedValue(false);
    mockIsCancel.mockReturnValue(false);

    const result = await confirmInterrupt();
    expect(result).toBe(false);
  });

  // ── Cancel (symbol) ──
  it("returns false when the user cancels", async () => {
    const cancelSymbol = Symbol("cancel");
    mockConfirm.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockReturnValue(true);

    const result = await confirmInterrupt();
    expect(result).toBe(false);
  });

  // ── Error path ──
  it("returns false when @clack/prompts throws an error (safe default)", async () => {
    mockConfirm.mockRejectedValue(new Error("non-TTY or prompt failure"));

    const result = await confirmInterrupt();
    expect(result).toBe(false);
  });

  // ── Correct message/options passed to clack.confirm ──
  it("passes the correct message and options to clack.confirm", async () => {
    mockConfirm.mockResolvedValue(true);

    await confirmInterrupt();

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "Do you want to interrupt the current run?",
      active: "Yes",
      inactive: "No",
      initialValue: false,
    });
  });

  // ── isCancel check: returns false regardless of the symbol's type ──
  it("returns false when clack.confirm returns a non-boolean, non-cancel value", async () => {
    // Edge: some versions of clack might return undefined or null
    mockConfirm.mockResolvedValue(null);
    mockIsCancel.mockImplementation((_v: unknown) => {
      // If the input isn't the cancel symbol, it should return false
      return false;
    });

    const result = await confirmInterrupt();
    expect(result).toBe(false);
  });

  // ── Guarantee: never throws ──
  it("never throws — returns false on any unexpected condition", async () => {
    mockConfirm.mockResolvedValue(undefined as any);
    mockIsCancel.mockReturnValue(false);

    // Should not throw
    const result = await confirmInterrupt();
    expect(typeof result).toBe("boolean");
  });
});
