import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ConversationId, type EngineEvent } from "@t3tools/contracts";

import { makeConversationActor } from "./ConversationActor.ts";
import * as ConversationsModule from "./Conversations.ts";
import { Conversations } from "./Conversations.ts";
import { envelope, r, send, sqliteWithEngineTables } from "./testing/fixtures.ts";
import * as EngineSignals from "./EngineSignals.ts";
import { EngineStore, makeEngineStore } from "./store/EngineStore.ts";

let loads = 0;
const countingStore = Layer.effect(
  EngineStore,
  Effect.map(makeEngineStore(), (store) =>
    EngineStore.of({
      ...store,
      load: (conversation) => Effect.suspend(() => (loads++, store.load(conversation))),
    }),
  ),
);

const engine = ConversationsModule.layer({ idleTimeToLive: "1 minute" }).pipe(
  Layer.provideMerge(Layer.mergeAll(countingStore, EngineSignals.layer)),
  Layer.provideMerge(sqliteWithEngineTables),
);

const PRODUCERS = 50;
const PER_PRODUCER = 4;

describe("Conversations", () => {
  it.layer(engine)("the registry", (it) => {
    it.effect("keeps every producer's order under 50 concurrent producers", () =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const c = ConversationId.make("busy");
        const total = 4 + 2 * (PRODUCERS * PER_PRODUCER - 1);
        const watcher = yield* conversations
          .subscribe(c, 0)
          .pipe(Stream.take(total), Stream.runCollect, Effect.forkScoped);
        yield* Effect.forEach(
          Array.from({ length: PRODUCERS }, (_, p) => p),
          (p) =>
            Effect.forEach(
              Array.from({ length: PER_PRODUCER }, (_, i) => i),
              (i) => conversations.ask(envelope(send(`${p}-${i}`), { conversation: c })),
              { discard: true },
            ),
          { concurrency: "unbounded", discard: true },
        );
        const seen = yield* Fiber.join(watcher);
        const texts = seen.flatMap((event) =>
          event._tag === "ItemOpened" && event.body.kind === "person" ? [event.body.text] : [],
        );
        const byProducer = Array.from({ length: PRODUCERS }, (_, p) =>
          texts.filter((text) => text.startsWith(`${p}-`)),
        );
        expect(seen.map((event) => event.seq)).toEqual(seen.map((_, index) => index + 1));
        expect(texts).toHaveLength(PRODUCERS * PER_PRODUCER);
        for (const [p, mine] of byProducer.entries()) {
          expect(mine).toEqual(Array.from({ length: PER_PRODUCER }, (_, i) => `${p}-${i}`));
        }
      }),
    );

    it.effect("rehydrates an evicted conversation from the store and carries on", () =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const c = ConversationId.make("sleepy");
        const first = yield* conversations.ask(envelope(send("one"), { conversation: c }));
        const loadsAfterFirst = loads;
        yield* conversations.ask(envelope(send("two"), { conversation: c }));
        const whileWarm = loads;
        yield* TestClock.adjust("2 minutes");
        const second = yield* conversations.ask(envelope(send("three"), { conversation: c }));
        assert.deepStrictEqual(
          {
            first: first.runId,
            second: second.runId,
            warmLoads: whileWarm - loadsAfterFirst,
            reloads: loads - whileWarm,
          },
          { first: r(1, c), second: r(3, c), warmLoads: 0, reloads: 1 },
        );
      }),
    );

    it.effect("refuses a command by its rule and keeps serving", () =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const c = ConversationId.make("idle");
        const refused = yield* Effect.flip(
          conversations.ask(envelope({ _tag: "Stop" }, { conversation: c })),
        );
        const accepted = yield* conversations.ask(envelope(send(), { conversation: c }));
        expect(refused).toMatchObject({
          _tag: "CommandRejected",
          rejection: { reason: "run-not-running" },
        });
        expect(accepted.runId).toBe(r(1, c));
      }),
    );

    it.effect("a late subscriber gets the record after its cursor, then what commits next", () =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const c = ConversationId.make("late");
        yield* conversations.ask(envelope(send("before"), { conversation: c }));
        const watcher = yield* conversations
          .subscribe(c, 2)
          .pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped);
        yield* conversations.ask(envelope(send("after"), { conversation: c }));
        const seen: ReadonlyArray<EngineEvent> = yield* Fiber.join(watcher);
        expect(seen.map((event) => event.seq)).toEqual([3, 4, 5, 6]);
      }),
    );
  });

  it.layer(sqliteWithEngineTables)("the actor's mailbox", (it) => {
    it.effect("holds at most its capacity; a producer past it waits and nothing is dropped", () =>
      Effect.gen(function* () {
        const gate = yield* Latch.make(false);
        const store = yield* makeEngineStore();
        const gated = EngineStore.of({
          ...store,
          commit: (input) => Effect.andThen(gate.await, store.commit(input)),
        });
        const signals = {
          effects: yield* EngineSignals.makeDoorbell,
          wakes: yield* EngineSignals.makeDoorbell,
        };
        const c = ConversationId.make("narrow");
        const actor = yield* makeConversationActor(c, gated, signals, { mailboxCapacity: 2 });
        const producers = yield* Effect.forEach([1, 2, 3, 4, 5], (n) =>
          Effect.forkScoped(actor.ask(envelope(send(`m${n}`), { conversation: c }))),
        );
        yield* Effect.addFinalizer(() => gate.open);
        for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
        const held = yield* actor.mailboxSize;
        const doneWhileBlocked = producers.filter((fiber) => fiber.pollUnsafe() !== undefined);
        yield* gate.open;
        const results = yield* Fiber.joinAll(producers);
        assert.deepStrictEqual(
          {
            held,
            doneWhileBlocked: doneWhileBlocked.length,
            runs: results.map((result) => result.runId),
          },
          {
            held: 2,
            doneWhileBlocked: 0,
            runs: [1, 2, 3, 4, 5].map((n) => r(n, c)),
          },
        );
      }),
    );
  });
});
