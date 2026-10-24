import { assert, describe, it } from "@effect/vitest";
import { type CommandResult, ConversationId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { DeliveryUnrecorded } from "../engine/MateEngine.ts";
import { makeChiefRestart } from "./ZeropsChiefRestart.ts";

const C1 = ConversationId.make("c1");
const C2 = ConversationId.make("c2");

/**
 * The engine as the test holds it: its conversations, and every command delivered through a fake
 * `MateEngineService.deliver`, as `<conversation> <command id> <reason> <fresh> <seed> <principal>`.
 * A conversation in `refusing` answers `Rejected`; one in `unrecorded` fails to record.
 */
const engineRig = () => {
  const conversations = [C1, C2];
  const refusing = new Set<ConversationId>();
  const unrecorded = new Set<ConversationId>();
  const delivered: Array<string> = [];
  const restart = makeChiefRestart({
    conversations: Effect.sync(() => [...conversations]),
    deliver: (conversationId, command, commandId, principal) =>
      Effect.gen(function* () {
        delivered.push(
          `${conversationId} ${commandId} ${command.reason} ${command.fresh} ${command.seed} ${principal.kind}`,
        );
        if (unrecorded.has(conversationId))
          return yield* new DeliveryUnrecorded({ conversationId, message: "busy store" });
        return (
          refusing.has(conversationId)
            ? { _tag: "Rejected", rejection: { reason: "archived" } }
            : { _tag: "Accepted", seq: 1 }
        ) satisfies CommandResult;
      }),
  });
  return { restart, refusing, unrecorded, delivered };
};

describe("ZeropsChiefRestart", () => {
  it.effect("the first state a server hears restarts nothing, whichever Chief it names", () =>
    Effect.gen(function* () {
      const { restart, delivered } = engineRig();
      const heard = yield* restart;
      yield* heard.heard("P_MATE");
      yield* heard.heard("P_MATE");
      assert.deepStrictEqual(delivered, []);
      yield* heard.heard(null);
      assert.deepStrictEqual(delivered, [
        "c1 chief:c1:none chief false null engine",
        "c2 chief:c2:none chief false null engine",
      ]);
    }),
  );

  // The engine records the rotation at once and closes the session between turns: an idle one
  // at its next run, a busy one once its turn settles (`decide.rotate.test.ts`).
  it.effect(
    "a moved Chief mark stops every idle provider session at once, and a busy one when its turn settles",
    () =>
      Effect.gen(function* () {
        const { restart, delivered } = engineRig();
        const heard = yield* restart;
        yield* heard.heard(null);
        yield* heard.heard("P_OTHER");
        assert.deepStrictEqual(delivered, [
          "c1 chief:c1:P_OTHER chief false null engine",
          "c2 chief:c2:P_OTHER chief false null engine",
        ]);
      }),
  );

  it.effect("lets a waiting session go when it ended on its own before its turn settled", () =>
    Effect.gen(function* () {
      const { restart, refusing, unrecorded, delivered } = engineRig();
      const heard = yield* restart;
      yield* heard.heard(null);
      // One conversation ended (archived) and refuses; another cannot record now: neither holds
      // the rest back, and neither is asked again.
      refusing.add(C1);
      unrecorded.add(C2);
      yield* heard.heard("P_OTHER");
      yield* heard.heard("P_OTHER");
      assert.deepStrictEqual(delivered, [
        "c1 chief:c1:P_OTHER chief false null engine",
        "c2 chief:c2:P_OTHER chief false null engine",
      ]);
    }),
  );
});
