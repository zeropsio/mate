import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CommandResult,
  ConversationId,
  EngineEvent,
  ENGINE_EVENT_VERSION,
  Item,
  RunEnd,
  effectId,
  itemId,
  requestId,
  runId,
  wakeId,
} from "./engine.ts";

const conversation = ConversationId.make("mate");
const run = runId(conversation, 3);

describe("engine ids are derived from their cause", () => {
  it.each([
    { name: "a run from its conversation and ordinal", id: run, expected: "mate/r/3" },
    { name: "an item from its run and ordinal", id: itemId(run, 7), expected: "mate/r/3/i/7" },
    { name: "a request from its run and ordinal", id: requestId(run, 2), expected: "mate/r/3/q/2" },
    {
      name: "an effect from its cause, kind and count",
      id: effectId(run, "provider.send", 1),
      expected: "mate/r/3/e/provider.send/1",
    },
    {
      name: "a wake from its owner, kind and key",
      id: wakeId(conversation, "usage-resume", run),
      expected: "mate/w/usage-resume/mate/r/3",
    },
  ])("derives $name", ({ id, expected }) => {
    expect(id).toBe(expected);
  });

  it("derives the same id twice from the same cause, so a retry converges on one row", () => {
    expect(runId(conversation, 3)).toBe(runId(conversation, 3));
    expect(effectId(run, "provider.send", 1)).toBe(effectId(run, "provider.send", 1));
  });
});

const decodeEvent = Schema.decodeUnknownSync(EngineEvent);
const decodeRunEnd = Schema.decodeUnknownSync(RunEnd);
const decodeItem = Schema.decodeUnknownSync(Item);
const decodeResult = Schema.decodeUnknownSync(CommandResult);
const encodeEvent = Schema.encodeSync(EngineEvent);
const header = {
  v: ENGINE_EVENT_VERSION,
  conversationId: "mate",
  seq: 4,
  at: 1_700_000_000_000,
  commandId: "cmd-1",
};

describe("EngineEvent decoding", () => {
  it("decodes a known event strictly and encodes it back unchanged", () => {
    const raw = { ...header, _tag: "RunStarted", runId: run, providerTurnId: "turn-9" };
    const event = decodeEvent(raw);
    expect(event._tag).toBe("RunStarted");
    expect(encodeEvent(event)).toEqual(raw);
  });

  it("decodes an event tag from a newer engine as Unknown, keeping its order and run", () => {
    const event = decodeEvent({
      ...header,
      _tag: "RunTeleported",
      runId: run,
      destination: "mars",
    });
    expect(event).toMatchObject({
      _tag: "Unknown",
      type: "RunTeleported",
      seq: 4,
      runId: run,
      conversationId: "mate",
    });
  });

  it("refuses a known event whose body is damaged instead of hiding it as Unknown", () => {
    expect(() => decodeEvent({ ...header, _tag: "RunStarted", runId: 42 })).toThrow();
  });

  it("refuses a value with no tag at all", () => {
    expect(() => decodeEvent({ ...header, runId: run })).toThrow();
  });
});

describe("forward-compatible members", () => {
  it("decodes a run end kind from a newer engine as unknown", () => {
    expect(decodeRunEnd({ kind: "abducted", by: "aliens" })).toEqual({
      kind: "unknown",
      type: "abducted",
    });
  });

  it("decodes an item kind from a newer engine as unknown, keeping its place", () => {
    const item = decodeItem({
      id: itemId(run, 1),
      conversationId: "mate",
      runId: run,
      seq: 5,
      rev: 6,
      at: 1,
      by: { kind: "mate" },
      kind: "hologram",
      frames: 3,
    });
    expect(item).toMatchObject({ kind: "unknown", type: "hologram", seq: 5, rev: 6 });
  });

  it("decodes a rejection reason from a newer engine as unknown", () => {
    expect(
      decodeResult({
        _tag: "Rejected",
        rejection: { reason: "moon-phase" },
      }),
    ).toEqual({ _tag: "Rejected", rejection: { reason: "unknown" } });
  });
});
