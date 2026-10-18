// xcoder:version 4 | xcoder:task task-7fc1d4 | xcoder:updated 2026-10-17T12:31:53.291Z | xcoder:subtask code-st-1a0810
// Tests for events/bus.ts — KooderEvents emitter and event types
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kooderEvents, emitKooderEvent, type KooderEvent, type KooderEventType } from "./bus.js";

describe("kooderEvents bus", () => {
  let capturedEvents: KooderEvent[];

  beforeEach(() => {
    capturedEvents = [];
  });

  afterEach(() => {
    kooderEvents.removeAllListeners();
  });

  describe("emitKooderEvent", () => {
    it("emits an event with type, taskId, and auto-generated ts", () => {
      const handler = vi.fn((ev: KooderEvent) => {
        capturedEvents.push(ev);
      });
      kooderEvents.on("event", handler);

      emitKooderEvent({ type: "agent:action", taskId: "task-001" });

      expect(handler).toHaveBeenCalledTimes(1);
      const ev = capturedEvents[0];
      expect(ev.type).toBe("agent:action");
      expect(ev.taskId).toBe("task-001");
      expect(ev.ts).toBeDefined();
      expect(typeof ev.ts).toBe("string");
      // ts should be a valid ISO string
      expect(new Date(ev.ts).toISOString()).toBe(ev.ts);
    });

    it("includes optional subtaskId when provided", () => {
      const handler = vi.fn((ev: KooderEvent) => {
        capturedEvents.push(ev);
      });
      kooderEvents.on("event", handler);

      emitKooderEvent({ type: "agent:thought", taskId: "task-001", subtaskId: "sub-42" });

      expect(capturedEvents[0].subtaskId).toBe("sub-42");
    });

    it("includes data payload when provided", () => {
      const handler = vi.fn((ev: KooderEvent) => {
        capturedEvents.push(ev);
      });
      kooderEvents.on("event", handler);

      const payload = { key: "value", nested: { x: 1 } };
      emitKooderEvent({ type: "agent:action", taskId: "task-002", data: payload });

      expect(capturedEvents[0].data).toEqual(payload);
    });

    it("supports multiple listeners", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      kooderEvents.on("event", handler1);
      kooderEvents.on("event", handler2);

      emitKooderEvent({ type: "task:intro", taskId: "task-003" });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("supports max 200 listeners", () => {
      // Test that setMaxListeners(200) was called
      expect(kooderEvents.getMaxListeners()).toBe(200);
    });
  });

  describe("event types — footer:update", () => {
    it("accepts 'footer:update' as a valid event type", () => {
      const handler = vi.fn((ev: KooderEvent) => {
        capturedEvents.push(ev);
      });
      kooderEvents.on("event", handler);

      emitKooderEvent({ type: "footer:update", taskId: "task-004", data: { stage: "code" } });

      expect(capturedEvents[0].type).toBe("footer:update");
      expect(capturedEvents[0].data).toEqual({ stage: "code" });
    });
  });

  describe("all KooderEventType values", () => {
    const allTypes: KooderEventType[] = [
      "task:intro",
      "task:outro",
      "task:dag",
      "orchestrator:note",
      "footer:update",
      "agent:thinking-start",
      "agent:thought",
      "agent:action",
      "agent:observation",
      "agent:tokens",
      "agent:final",
      "agent:crash",
      "agent:protocol-error",
      "agent:score",
      "agent:duplicate",
      "agent:exhausted",
      "debate:intro",
      "debate:turn-start",
      "debate:agent-thought",
      "debate:agent-action",
      "debate:agent-observation",
      "debate:agent-final",
      "debate:agent-tokens",
      "debate:outro",
    ];

    it.each(allTypes)("emits event of type '%s' without throwing", (type) => {
      const handler = vi.fn();
      kooderEvents.on("event", handler);

      expect(() =>
        emitKooderEvent({ type, taskId: "task-test" })
      ).not.toThrow();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe(type);
    });
  });

  describe("cleanup", () => {
    it("allows removing listeners", () => {
      const handler = vi.fn();
      kooderEvents.on("event", handler);
      kooderEvents.off("event", handler);

      emitKooderEvent({ type: "agent:action", taskId: "task-005" });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
