import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ConversationId, itemId, runId } from "./engine.ts";
import {
  EngineAnswer,
  EngineCallResult,
  EngineConversationFrame,
  EngineRowsFrame,
} from "./engineWire.ts";

const conversation = ConversationId.make("mate");
const run = runId(conversation, 1);
const decodeFrame = Schema.decodeUnknownSync(EngineConversationFrame);
const encodeFrame = Schema.encodeUnknownSync(EngineConversationFrame);

const base = (n: number) => ({
  id: itemId(run, n),
  conversationId: conversation,
  runId: run,
  seq: n,
  rev: n,
  at: 1,
  by: { kind: "mate" },
});

const changes = (items: ReadonlyArray<unknown>) => ({
  type: "changes",
  epoch: 3,
  from: 0,
  to: 9,
  runs: [],
  items,
  requests: [],
});

describe("an older client reads a newer engine's wire", () => {
  it("decodes an unknown record kind as an unknown item that keeps its place", () => {
    const frame = decodeFrame(
      changes([
        { ...base(1), kind: "note", text: "Done.", streaming: false, answer: true },
        { ...base(2), kind: "chart", series: [1, 2, 3], summary: "CPU over the hour" },
      ]),
    );
    expect(frame.type).toBe("changes");
    if (frame.type !== "changes") return;
    expect(frame.items.map((item) => item.kind)).toEqual(["note", "unknown"]);
    expect(frame.items[1]).toMatchObject({
      kind: "unknown",
      type: "chart",
      seq: 2,
      summary: "CPU over the hour",
    });
  });

  it("drops a damaged record alone, never the frame", () => {
    const frame = decodeFrame(
      changes([
        { ...base(1), kind: "note", text: 42, streaming: false, answer: true },
        { ...base(2), kind: "note", text: "Kept.", streaming: false, answer: false },
      ]),
    );
    if (frame.type !== "changes") throw new Error(frame.type);
    expect(frame.items.map((item) => item.id)).toEqual([itemId(run, 2)]);
  });

  it.each([
    { name: "a conversation frame", decode: decodeFrame },
    { name: "a rows frame", decode: Schema.decodeUnknownSync(EngineRowsFrame) },
  ])("decodes $name of a type it does not know as unknown", ({ decode }) => {
    expect(decode({ type: "presence", who: ["ana"] })).toEqual({
      type: "unknown",
      was: "presence",
    });
  });

  it("reads a reset reason it does not know as unknown", () => {
    expect(decodeFrame({ type: "reset", reason: "compacted" })).toEqual({
      type: "reset",
      reason: "unknown",
    });
  });

  it("reads an answer kind it does not know as unknown, so the server can refuse it", () => {
    expect(Schema.decodeUnknownSync(EngineAnswer)({ kind: "vault", said: "put" })).toEqual({
      kind: "unknown",
      type: "vault",
    });
  });
});

describe("the wire's frames round-trip", () => {
  it("encodes and decodes live text keyed by its item", () => {
    const frame = {
      type: "live.append",
      itemId: itemId(run, 4),
      stream: "text",
      offset: 5,
      text: " world",
    } as const;
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("carries a client the protocols it can update to, as a call's answer", () => {
    const unserved = {
      _tag: "Unserved",
      unserved: {
        type: "unserved",
        reason: "protocol",
        protocols: [1],
        message: "Update Zerops Mate to keep talking to this Mate.",
      },
    } as const;
    expect(Schema.decodeUnknownSync(EngineCallResult)(unserved)).toEqual(unserved);
  });
});
