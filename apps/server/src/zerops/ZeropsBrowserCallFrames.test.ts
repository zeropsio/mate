import {
  EventId,
  ThreadId,
  TurnId,
  RuntimeItemId,
  ProviderDriverKind,
  type SpiEvent,
  type SpiToolCall,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { makeBrowserCallFrames } from "./ZeropsBrowserCallFrames.ts";
const frame = { type: "frame" as const, data: "A", width: 10, height: 20 };
const event = (
  type: "item.started" | "item.completed",
  id: string,
  thread = "thread",
  turn = "turn",
  result?: SpiToolCall["result"],
): SpiEvent => ({
  type,
  eventId: EventId.make(`${id}:${type}`),
  threadId: ThreadId.make(thread),
  turnId: TurnId.make(turn),
  provider: ProviderDriverKind.make("codex"),
  itemId: RuntimeItemId.make(id),
  createdAt: "2026-10-07T00:00:00Z",
  payload: { itemType: "mcp_tool_call" },
  toolCall: {
    name: "zerops_browser",
    rawName: "zerops_browser",
    ...(result === undefined ? {} : { result }),
  },
});
const result = {
  text: "done",
  failed: false,
  images: [{ data: "OWNED", mimeType: "image/png", width: 10, height: 20 }],
};

describe("source-proven browser call images", () => {
  it("queued static, manual and background viewport frames never gain the active call's identity", () => {
    const tracker = makeBrowserCallFrames();
    tracker.ingest(event("item.started", "first"));
    expect(tracker.frame(frame)).toBe(frame);
    tracker.ingest(event("item.started", "second"));
    expect(tracker.frame(frame).callId).toBeUndefined();
    expect(tracker.ingest(event("item.completed", "first"))).toMatchObject({
      completeness: "partial",
    });
    expect(tracker.ingest(event("item.completed", "second"))).toMatchObject({
      completeness: "partial",
    });
  });
  it("a call with no subscriber or captured image cannot prove absence", () => {
    const tracker = makeBrowserCallFrames();
    expect(
      tracker.ingest(
        event("item.completed", "call", "thread", "turn", { text: "done", failed: false }),
      ),
    ).toEqual({
      type: "call-result",
      callId: "call",
      threadId: "thread",
      turnId: "turn",
      revision: 1,
      completeness: "partial",
    });
  });
  it("the call's explicit result image identifies its final slot even without seeing the start", () => {
    const tracker = makeBrowserCallFrames();
    expect(tracker.ingest(event("item.completed", "call", "thread", "turn", result))).toMatchObject(
      {
        completeness: "complete",
        frame: {
          callId: "call",
          threadId: "thread",
          turnId: "turn",
          data: "OWNED",
          mimeType: "image/png",
        },
      },
    );
  });
  it("only a complete explicit empty image array proves the call image slot empty", () => {
    const tracker = makeBrowserCallFrames();
    expect(
      tracker.ingest(
        event("item.completed", "empty", "thread", "turn", {
          text: "done",
          failed: false,
          images: [],
        }),
      ),
    ).toMatchObject({ completeness: "complete", frame: null });
    expect(
      tracker.ingest(
        event("item.completed", "dropped", "thread", "turn", { ...result, imagesDropped: true }),
      ),
    ).toMatchObject({ completeness: "partial" });
  });
  it("different threads and turns with the same item id never share source revisions", () => {
    const tracker = makeBrowserCallFrames();
    for (const [thread, turn] of [
      ["first", "turn"],
      ["second", "turn"],
      ["second", "next-turn"],
    ]) {
      expect(tracker.ingest(event("item.completed", "same", thread, turn, result))).toMatchObject({
        threadId: thread,
        turnId: turn,
        revision: 1,
      });
    }
  });
  it("explicit daemon identity orders the final call image; replay cannot restart its revision", () => {
    const tracker = makeBrowserCallFrames();
    const identified = {
      ...frame,
      callId: "call",
      threadId: "thread",
      turnId: "turn",
      revision: 5,
      completeness: "complete" as const,
    };
    expect(tracker.frame(identified)).toBe(identified);
    expect(
      tracker.ingest(event("item.completed", "call", "thread", "turn", result))?.revision,
    ).toBe(6);
    expect(
      tracker.ingest(event("item.completed", "call", "thread", "turn", result)),
    ).toBeUndefined();
    tracker.ingest(event("item.started", "call"));
    expect(tracker.frame(frame).callId).toBeUndefined();
  });
});
