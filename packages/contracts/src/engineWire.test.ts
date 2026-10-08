import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ConversationId, itemId, runId } from "./engine.ts";
import {
  ConversationHeader,
  EngineAnswer,
  EngineAnswerInput,
  EngineAssignAgentInput,
  EngineCallResult,
  EngineConversationFrame,
  EngineDismissInput,
  EngineRowsFrame,
  EngineSendInput,
  EngineSetRuntimeModeInput,
  EngineSwitchModelInput,
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

const decodeAnswerInput = Schema.decodeUnknownSync(EngineAnswerInput);
const encodeAnswerInput = Schema.encodeSync(EngineAnswerInput);
const decodeDismissInput = Schema.decodeUnknownSync(EngineDismissInput);

describe("a question's answer and its dismissal", () => {
  const picture = {
    type: "image",
    id: "img-1",
    name: "question-preview.png",
    mimeType: "image/png",
    sizeBytes: 2048,
  } as const;
  const call = { protocol: 1, conversationId: "mate", commandId: "c1", requestId: "mate/r/1/q/1" };

  it("an answer carries the pictures attached to each question, by reference", () => {
    const input = {
      ...call,
      answer: {
        kind: "input",
        answers: { target: "Inspect the preview shown here" },
        attachmentsByQuestionId: { target: [picture] },
      },
      summary: "Answered",
    };
    const decoded = decodeAnswerInput(input);
    expect(decoded).toEqual(input);
    expect(encodeAnswerInput(decoded)).toEqual(input);
  });

  it("an answer in words alone carries no pictures", () => {
    const input = { ...call, answer: { kind: "input", answers: { target: "stage" } }, summary: "" };
    expect(decodeAnswerInput(input).answer).toEqual(input.answer);
  });

  it("a dismissal names the request it closes, under its own command id", () => {
    expect(decodeDismissInput(call)).toEqual(call);
  });
});

describe("a conversation's settings on the wire", () => {
  const call = { protocol: 1, conversationId: "mate", commandId: "c1" };
  const roundTrips = (schema: Schema.Codec<unknown, unknown>, input: unknown) => {
    const decoded = Schema.decodeUnknownSync(schema)(input);
    expect(decoded).toEqual(input);
    expect(Schema.encodeUnknownSync(schema)(decoded)).toEqual(input);
  };

  it("a send carries files by the id they were uploaded under, beside pictures, and its interaction mode", () => {
    roundTrips(EngineSendInput, {
      ...call,
      text: "Read the spec and plan it",
      attachments: [
        { type: "image", id: "img-1", name: "a.png", mimeType: "image/png", sizeBytes: 10 },
        { type: "file", id: "file-1", name: "spec.pdf", mimeType: "application/pdf", sizeBytes: 9 },
      ],
      interactionMode: "plan",
    });
  });

  it("a model switch carries the model's options; one without them keeps the conversation's", () => {
    roundTrips(EngineSwitchModelInput, {
      ...call,
      model: "claude-opus-4-5",
      options: [{ id: "effort", value: "max" }],
    });
    roundTrips(EngineSwitchModelInput, { ...call, model: "claude-opus-4-5" });
  });

  it("a runtime mode and an agent pick are calls of their own", () => {
    roundTrips(EngineSetRuntimeModeInput, { ...call, runtimeMode: "approval-required" });
    roundTrips(EngineAssignAgentInput, { ...call, instanceId: "codex", model: "gpt-5.4" });
  });

  it("an older client reads a header that names the runtime and interaction modes", () => {
    const header = {
      conversationId: "mate",
      agent: null,
      archived: false,
      model: null,
      session: null,
      pausedUntil: null,
      queued: 0,
      runtimeMode: "approval-required",
      interactionMode: "plan",
    };
    roundTrips(ConversationHeader, header);
  });
});
