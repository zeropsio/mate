import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  CommandResult,
  ConversationId,
  EngineEvent,
  ENGINE_EVENT_VERSION,
  Item,
  Run,
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

const decodeEventExit = Schema.decodeUnknownExit(EngineEvent);
const decodeRunExit = Schema.decodeUnknownExit(Run);

describe("a stored event from a newer build still decodes (rule 10)", () => {
  const header = { v: 1, conversationId: "mate", seq: 1, at: 0, commandId: "x" };
  const queued = {
    ...header,
    _tag: "RunQueued",
    runId: "mate/r/1",
    ordinal: 1,
    trigger: { kind: "person", itemId: "mate/r/1/i/1" },
    joins: null,
    principal: { kind: "person", subject: "ana" },
    maintenance: false,
    text: "go",
  };
  const person = {
    kind: "person",
    text: "go",
    attachments: [],
    sendId: "x",
    delivery: { state: "queued", at: null },
  };
  const call = {
    kind: "call",
    step: "s",
    tool: { name: "Bash" },
    words: null,
    state: "running",
    endedAt: null,
  };
  const opened = (body: object, by: object = { kind: "mate" }) => ({
    ...header,
    _tag: "ItemOpened",
    runId: "mate/r/1",
    itemId: "mate/r/1/i/1",
    key: null,
    by,
    body,
  });
  const decodes = (raw: unknown) => Exit.isSuccess(decodeEventExit(raw));
  it.each([
    ["Principal", { ...queued, principal: { kind: "hq", relay: "x" } }],
    ["RunTrigger", { ...queued, trigger: { kind: "schedule", id: "x" } }],
    [
      "ItemActor",
      opened(
        { kind: "note", text: "x", streaming: false, answer: false },
        { kind: "crewmate", id: "x" },
      ),
    ],
    [
      "RunEndSource",
      {
        ...header,
        _tag: "RunEnded",
        runId: "mate/r/1",
        end: { kind: "completed" },
        source: "inferred-from-next-turn",
      },
    ],
    [
      "RequestState",
      {
        ...header,
        _tag: "RequestClosed",
        runId: "mate/r/1",
        requestId: "mate/r/1/q/1",
        state: "expired",
      },
    ],
    ["SessionCloseReason", { ...header, _tag: "SessionClosed", sessionId: "s1", reason: "idle" }],
    [
      "EffectOutcome",
      {
        ...header,
        _tag: "EffectOutcomeRecorded",
        effectId: "e",
        kind: "provider.send",
        outcome: { kind: "adopted" },
      },
    ],
    [
      "delivery.state",
      opened(
        { ...person, delivery: { state: "edited", at: null } },
        { kind: "person", principal: { kind: "person", subject: "ana" } },
      ),
    ],
    ["call.state", opened({ ...call, state: "cut" })],
  ] as const)("an event with a newer %s still decodes", (_name, raw) => {
    expect(decodes(raw)).toBe(true);
  });
  it("a run with a newer state still decodes", () => {
    const run = {
      id: "mate/r/1",
      conversationId: "mate",
      ordinal: 1,
      seq: 1,
      rev: 1,
      trigger: { kind: "person", itemId: "mate/r/1/i/1" },
      joins: null,
      principal: { kind: "person", subject: "ana" },
      state: "paused",
      maintenance: false,
      waitingOn: null,
      stopAsked: null,
      end: null,
      endSource: null,
      sessionId: null,
      providerTurnId: null,
      queuedAt: 0,
      admittedAt: null,
      startedAt: null,
      endedAt: null,
      unresponsiveSince: null,
    };
    expect(Exit.isSuccess(decodeRunExit(run))).toBe(true);
  });
});
