import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import { classifyHqCall, makeHqWire } from "./hqWire.ts";

/** One socket the test ends with a close code, after the messages it names. */
const socketClosing = (messages: ReadonlyArray<string>, code: number) => {
  const sent: string[] = [];
  let closed = false;
  const api: Pick<HqApi, "openScopeSocket"> = {
    openScopeSocket: async (on) => {
      queueMicrotask(() => {
        for (const message of messages) on.message(message);
        on.close(code);
      });
      return {
        send: (data) => void sent.push(data),
        close: () => {
          closed = true;
        },
      };
    },
  };
  return { api, sent, closed: () => closed };
};

describe("makeHqWire", () => {
  it.effect("reads a segment's messages until HQ ends it as planned, and closes its socket", () =>
    Effect.gen(function* () {
      const fake = socketClosing(["a", "b"], 4410);
      const read = yield* Effect.scoped(
        Effect.gen(function* () {
          const segment = yield* makeHqWire(fake.api).open;
          yield* segment.send({ type: "pong" });
          return yield* Stream.runCollect(segment.messages);
        }),
      );
      expect(read).toEqual(["a", "b"]);
      expect(fake.sent).toEqual(['{"type":"pong"}']);
      expect(fake.closed()).toBe(true);
    }),
  );

  it.effect.each([
    { code: 4401, outcome: "recoverable-session" },
    { code: 4403, outcome: "definitive-refusal" },
    { code: 1011, outcome: "transient" },
  ])("fails a segment HQ closed with $code as $outcome", ({ code, outcome }) =>
    Effect.gen(function* () {
      const fault = yield* Effect.flip(
        Effect.scoped(
          Effect.flatMap(makeHqWire(socketClosing([], code).api).open, (segment) =>
            Stream.runDrain(segment.messages),
          ),
        ),
      );
      expect(fault.outcome).toBe(outcome);
    }),
  );
});

describe("classifyHqCall", () => {
  const refused = (code: string) =>
    new HqError({ kind: "refused", code, status: 403, message: code });
  it.each([
    {
      name: "a session HQ no longer takes",
      cause: refused("session_required"),
      outcome: "recoverable-session",
    },
    { name: "Zerops refusing HQ", cause: refused("zerops_refused"), outcome: "definitive-refusal" },
    {
      name: "HQ unreachable",
      cause: new HqError({ kind: "unavailable", code: "network", message: "down" }),
      outcome: "transient",
    },
    { name: "anything else", cause: new Error("boom"), outcome: "transient" },
  ])("$name is $outcome", ({ cause, outcome }) => {
    expect(classifyHqCall(cause).outcome).toBe(outcome);
  });
});
