import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ConversationId } from "@t3tools/contracts";

import * as ConversationsModule from "../Conversations.ts";
import { Conversations } from "../Conversations.ts";
import type { Command } from "../domain/command.ts";
import { envelope, sqliteWithEngineTables } from "../testing/fixtures.ts";
import * as EngineSignals from "../EngineSignals.ts";
import * as EngineStoreModule from "../store/EngineStore.ts";
import { EngineStore } from "../store/EngineStore.ts";
import { makeWakeScheduler } from "./WakeScheduler.ts";

const engine = ConversationsModule.layer().pipe(
  Layer.provideMerge(Layer.mergeAll(EngineStoreModule.layer, EngineSignals.layer)),
  Layer.provideMerge(sqliteWithEngineTables),
);

const arm = (
  conversation: ConversationId,
  wake: Omit<Extract<Command, { _tag: "ArmWake" }>, "_tag">,
) =>
  Effect.flatMap(Conversations, (conversations) =>
    conversations.ask(envelope({ _tag: "ArmWake", ...wake }, { conversation })),
  );

/** Lets the scheduler and the actors run what the clock released. */
const settle = Effect.forEach(Array.from({ length: 100 }), () => Effect.yieldNow, {
  discard: true,
});

const advance = (millis: number) => Effect.andThen(TestClock.adjust(millis), settle);

const fired = (conversation: ConversationId) =>
  Effect.gen(function* () {
    const store = yield* EngineStore;
    const events = yield* store.events(conversation, 0);
    return {
      fires: events.filter((event) => event._tag === "WakeFired").length,
      runs: events.filter((event) => event._tag === "RunQueued").length,
    };
  });

const wakeStates = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly owner_conversation_id: string; readonly state: string }>`
    SELECT owner_conversation_id, state FROM engine_wake ORDER BY owner_conversation_id
  `;
  return Object.fromEntries(rows.map((row) => [row.owner_conversation_id, row.state]));
});

describe("WakeScheduler", () => {
  it.layer(engine)("timing", (it) => {
    it.effect("fires the earliest wake first", () =>
      Effect.gen(function* () {
        yield* arm(ConversationId.make("late"), { kind: "schedule", key: "k", dueAt: 3000 });
        yield* arm(ConversationId.make("early"), { kind: "schedule", key: "k", dueAt: 1000 });
        yield* arm(ConversationId.make("middle"), { kind: "schedule", key: "k", dueAt: 2000 });
        const scheduler = yield* makeWakeScheduler();
        yield* scheduler.start;
        yield* settle;
        const atStart = yield* wakeStates;
        yield* advance(1000);
        const at1000 = yield* wakeStates;
        yield* advance(1000);
        const at2000 = yield* wakeStates;
        assert.deepStrictEqual(
          { atStart, at1000, at2000 },
          {
            atStart: { early: "armed", late: "armed", middle: "armed" },
            at1000: { early: "fired", late: "armed", middle: "armed" },
            at2000: { early: "fired", late: "armed", middle: "fired" },
          },
        );
      }),
    );
  });

  it.layer(engine)("re-arm", (it) => {
    it.effect("re-reads when a nearer wake is armed while it sleeps", () =>
      Effect.gen(function* () {
        const far = ConversationId.make("far");
        const near = ConversationId.make("near");
        yield* arm(far, { kind: "schedule", key: "k", dueAt: 60_000 });
        const scheduler = yield* makeWakeScheduler();
        yield* scheduler.start;
        yield* settle;
        yield* arm(near, { kind: "schedule", key: "k", dueAt: 500 });
        yield* advance(500);
        assert.deepStrictEqual(yield* wakeStates, { far: "armed", near: "fired" });
      }),
    );

    it.effect("a recurring wake fires at each of its cron's times", () =>
      Effect.gen(function* () {
        const c = ConversationId.make("standup");
        yield* arm(c, { kind: "standup", key: "daily", cron: "* * * * *", text: "Stand up" });
        const scheduler = yield* makeWakeScheduler();
        yield* scheduler.start;
        yield* advance(60_000);
        const once = yield* fired(c);
        yield* advance(60_000);
        assert.deepStrictEqual(
          { once, twice: yield* fired(c) },
          { once: { fires: 1, runs: 1 }, twice: { fires: 2, runs: 2 } },
        );
      }),
    );
  });

  it.layer(engine)("crashes", (it) => {
    it.effect("fires once when the server stops right after the fire committed", () =>
      Effect.gen(function* () {
        const c = ConversationId.make("after");
        yield* arm(c, { kind: "schedule", key: "k", dueAt: 1000 });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* (yield* makeWakeScheduler()).start;
            yield* advance(1000);
          }),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* (yield* makeWakeScheduler()).start;
            yield* advance(1000);
          }),
        );
        assert.deepStrictEqual(yield* fired(c), { fires: 1, runs: 1 });
      }),
    );

    it.effect("fires once when the server stops before the fire committed", () =>
      Effect.gen(function* () {
        const c = ConversationId.make("before");
        const conversations = yield* Conversations;
        yield* arm(c, { kind: "schedule", key: "k", dueAt: 1000 });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* (yield* makeWakeScheduler()).start;
            yield* advance(1000);
          }),
        ).pipe(
          Effect.provideService(Conversations, {
            ...conversations,
            tell: () => Effect.die("the process died mid-fire"),
          }),
        );
        const afterCrash = yield* fired(c);
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* (yield* makeWakeScheduler()).start;
            yield* advance(1000);
          }),
        );
        assert.deepStrictEqual(
          { afterCrash, afterRestart: yield* fired(c) },
          { afterCrash: { fires: 0, runs: 0 }, afterRestart: { fires: 1, runs: 1 } },
        );
      }),
    );
  });
});
