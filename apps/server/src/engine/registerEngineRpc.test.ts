/**
 * The engine's wire over the socket: unserved on a V1 Mate, and on the engine every call runs as
 * the connecting session with the Mate's own revision source.
 */
import { CommandId, ConversationId, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { inertMateEngine } from "./MateEngine.ts";
import { registerEngineRpc } from "./registerEngineRpc.ts";
import { unservedWire, type EngineWireShape, type WireCaller } from "./wire/EngineWire.ts";

const passThrough = {
  admit: <A, E, R>(_method: string, effect: Effect.Effect<A, E, R>) => effect,
};
const source = Effect.succeed({ environmentId: "env-1", epoch: 7 });
const conversationId = ConversationId.make("mate");

describe("registerEngineRpc", () => {
  it.effect("on a V1 Mate, answers the conversation's subscription and a send as unserved", () =>
    Effect.gen(function* () {
      const handlers = registerEngineRpc({
        engine: inertMateEngine,
        source,
        subject: "ana",
        ...passThrough,
      });
      const frames = yield* Stream.runCollect(
        handlers[WS_METHODS.subscribeEngineConversation]({ protocol: 1, conversationId }),
      );
      expect(frames.map((frame) => frame.type)).toEqual(["unserved"]);
      const sent = yield* handlers[WS_METHODS.engineSend]({
        protocol: 1,
        conversationId,
        commandId: CommandId.make("c1"),
        text: "Hi",
      });
      expect(sent._tag).toBe("Unserved");
    }),
  );

  it.effect("runs a send as the connecting session, at the Mate's start epoch", () =>
    Effect.gen(function* () {
      const callers: Array<WireCaller> = [];
      const wire: EngineWireShape = {
        ...unservedWire,
        send: (_input, caller) =>
          Effect.sync(() => {
            callers.push(caller);
            return { _tag: "Accepted", seq: 1 } as const;
          }),
      };
      const handlers = registerEngineRpc({
        engine: { wire },
        source,
        subject: "ana",
        ...passThrough,
      });
      yield* handlers[WS_METHODS.engineSend]({
        protocol: 1,
        conversationId,
        commandId: CommandId.make("c1"),
        text: "Hi",
      });
      expect(callers).toEqual([{ subject: "ana", environmentId: "env-1", epoch: 7 }]);
    }),
  );
});
