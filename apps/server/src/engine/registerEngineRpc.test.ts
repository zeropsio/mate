/**
 * The engine's wire over the socket: every call runs as the connecting session with the Mate's own
 * revision source.
 */
import { CommandId, ConversationId, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { registerEngineRpc } from "./registerEngineRpc.ts";
import { type EngineWireShape, type WireCaller } from "./wire/EngineWire.ts";
import { unservedWire } from "./testing/inertEngine.ts";

const passThrough = {
  admit: <A, E, R>(_method: string, effect: Effect.Effect<A, E, R>) => effect,
};
const source = Effect.succeed({ environmentId: "env-1", epoch: 7 });
const conversationId = ConversationId.make("mate");

describe("registerEngineRpc", () => {
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
