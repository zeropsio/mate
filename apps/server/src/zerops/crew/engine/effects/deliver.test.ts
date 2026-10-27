import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ConversationId, type Principal } from "@t3tools/contracts";

import { Conversations } from "../../../../engine/Conversations.ts";
import { handlersOf } from "../../../../engine/outbox/EffectWorker.ts";
import { EngineStore } from "../../../../engine/store/EngineStore.ts";
import { engineLayer, tempDb } from "../../../../engine/testing/world.ts";
import { attempt, effectRow, okValue } from "../../testing/crewEffectFixture.ts";
import { crewDeliveryLayer, makeDeliver, type DeliverPayload } from "./deliver.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const BACKEND = ConversationId.make("crew-backend");
const ANA: Principal = { kind: "person", subject: "ana" };

const PAYLOAD: DeliverPayload = {
  handle: "backend",
  conversationId: BACKEND,
  principal: ANA,
  command: { _tag: "Send", text: "Task #1: add the score API" },
};

const row = (attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.deliver, PAYLOAD, {
    effectId: "crew/main/e/crew.deliver/1",
    attempt: attemptNumber,
  });

/** One server lifetime over the database file: nothing in memory survives the next one. */
const lifetime = (file: string) =>
  Layer.provideMerge(crewDeliveryLayer, engineLayer(file, handlersOf()));

const tags = Effect.map(
  Effect.flatMap(EngineStore, (store) => store.events(BACKEND, 0)),
  (events) => events.map((event) => event._tag),
);

describe("crew.deliver", () => {
  it.effect("delivers a task card to the crewmate's conversation as a run of the person's", () =>
    Effect.gen(function* () {
      const handler = yield* makeDeliver;
      const delivered = okValue(yield* attempt(handler, row())) as { readonly runId?: string };
      const record = yield* tags;
      assert.deepStrictEqual(
        { runId: typeof delivered.runId, queued: record.filter((tag) => tag === "RunQueued") },
        { runId: "string", queued: ["RunQueued"] },
      );
    }).pipe(Effect.provide(lifetime(tempDb("crew-deliver")))),
  );

  it.effect(
    "a delivery the restart cut after its step committed is answered by its receipt, once",
    () => {
      const file = tempDb("crew-deliver-crash");
      return Effect.gen(function* () {
        // The first lifetime delivered; the server died before the effect settled.
        const first = yield* Effect.gen(function* () {
          const result = yield* attempt(yield* makeDeliver, row(1));
          return { result, record: yield* tags };
        }).pipe(Effect.provide(lifetime(file)));
        const again = yield* Effect.gen(function* () {
          const result = yield* attempt(yield* makeDeliver, row(2));
          return { result, record: yield* tags };
        }).pipe(Effect.provide(lifetime(file)));
        assert.deepStrictEqual(again, first);
      });
    },
  );

  it.effect("a command the conversation refuses fails the delivery for good, in its words", () =>
    Effect.gen(function* () {
      const handler = yield* makeDeliver;
      const conversations = yield* Conversations;
      yield* conversations.tell({
        commandId: "archive" as never,
        conversationId: BACKEND,
        principal: ANA,
        command: { _tag: "Archive" },
      });
      const refused = yield* attempt(handler, row());
      assert.deepStrictEqual(
        { refused, record: yield* tags },
        {
          refused: {
            _tag: "Done",
            outcome: { kind: "failed", reason: "archived", refused: true },
          },
          record: ["ConversationArchived"],
        },
      );
    }).pipe(Effect.provide(lifetime(tempDb("crew-deliver-refused")))),
  );
});
