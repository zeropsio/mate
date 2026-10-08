import { assert, describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, ConversationId, wakeId } from "@t3tools/contracts";

import * as ConversationsModule from "../Conversations.ts";
import { Conversations } from "../Conversations.ts";
import type { Command, Envelope } from "../domain/command.ts";
import { wakeFiredCommandId } from "../domain/ids.ts";
import { envelope, sqliteWithEngineTables } from "../testing/fixtures.ts";
import * as EngineSignals from "../EngineSignals.ts";
import * as EngineStoreModule from "../store/EngineStore.ts";
import { EngineStore } from "../store/EngineStore.ts";
import { World, audit, engineLayer, fireDue, tempDb } from "../testing/world.ts";
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

// ── what the proof found at the scheduler (round 3: review 5, 11) ─────────────────────────────

const mate = ConversationId.make("mate");
let proofIds = 0;
const env = (command: Command, conversation = mate): Envelope => ({
  commandId: CommandId.make(`s-${++proofIds}`),
  conversationId: conversation,
  principal: { kind: "person", subject: "ana" },
  command,
});
const yieldMany = Effect.forEach(Array.from({ length: 300 }), () => Effect.yieldNow, {
  discard: true,
});

describe("WakeScheduler: one wake never holds another", () => {
  it.effect("a wake of a healthy conversation fires while another conversation cannot load", () =>
    Effect.gen(function* () {
      const file = tempDb("r5");
      const world = new World();
      const broken = ConversationId.make("broken");
      const healthy = ConversationId.make("healthy");
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const sql = yield* SqlClient.SqlClient;
        yield* conversations.ask(
          env({ _tag: "ArmWake", kind: "standup", key: "k", dueAt: 1_000 }, broken),
        );
        yield* conversations.ask(
          env({ _tag: "ArmWake", kind: "standup", key: "k", dueAt: 2_000 }, healthy),
        );
        // A stored event this build cannot decode.
        const payload = '{"sessionId":"s"}'; // a known event with its body damaged
        yield* sql`INSERT INTO engine_event (conversation_id, seq, type, v, at, command_id, run_id, payload_json)
          VALUES (${broken}, 2, 'SessionClosed', 1, 0, 'x', NULL, ${payload})`;
        yield* sql`UPDATE engine_conversation SET head_seq = 2 WHERE conversation_id = ${broken}`;
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      const state = yield* Effect.gen(function* () {
        yield* (yield* makeWakeScheduler()).start;
        for (let i = 0; i < 10; i++) {
          yield* TestClock.adjust(1_000);
          yield* yieldMany;
        }
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* sql<{
          readonly state: string;
        }>`SELECT state FROM engine_wake WHERE owner_conversation_id = ${healthy}`;
        return row?.state;
      }).pipe(Effect.scoped, Effect.provide(engineLayer(file, world.handlers())));
      expect(state).toBe("fired");
    }),
  );
});

describe("WakeScheduler: a wake fires once per arming", () => {
  it.effect("a wake re-armed at the time it already fired at fires again, once", () =>
    Effect.gen(function* () {
      const file = tempDb("r11a");
      const result = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        let tells = 0;
        const counting = {
          ...conversations,
          tell: (e: Envelope) =>
            Effect.andThen(
              Effect.sync(() => tells++),
              conversations.tell(e),
            ),
        };
        yield* (yield* makeWakeScheduler().pipe(Effect.provideService(Conversations, counting)))
          .start;
        yield* conversations.ask(env({ _tag: "Archive" })); // a wake then starts no run
        yield* conversations.ask(
          env({ _tag: "ArmWake", kind: "standup", key: "daily", dueAt: 1_000 }),
        );
        yield* TestClock.adjust(1_000);
        yield* yieldMany;
        // The same stand-up armed again for the same moment (a retried arm, a boot re-arm).
        yield* conversations.ask(
          env({ _tag: "ArmWake", kind: "standup", key: "daily", dueAt: 1_000 }),
        );
        tells = 0;
        yield* yieldMany; // the clock does not move
        const { events, problems } = yield* audit(mate);
        return {
          fires: events.filter((e) => e._tag === "WakeFired").length,
          problems,
          scheduler: tells > 2 ? "spinning" : "idle",
        };
      }).pipe(Effect.scoped, Effect.provide(engineLayer(file, new World().handlers())));
      expect(result).toEqual({ fires: 2, problems: [], scheduler: "idle" });
    }),
  );

  it.effect("a refused fire never drops the wake armed again after it", () =>
    Effect.gen(function* () {
      const file = tempDb("r11b");
      const problems = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const w = wakeId(mate, "standup", "daily");
        yield* conversations.ask(
          env({ _tag: "ArmWake", kind: "standup", key: "daily", dueAt: 1_000 }),
        );
        yield* conversations.ask(env({ _tag: "CancelWake", wakeId: w }));
        // The scheduler read the row before the cancel committed; its fire is refused.
        yield* conversations.tell({
          ...env({ _tag: "WakeFired", wakeId: w }),
          commandId: wakeFiredCommandId(w, 1), // the first arming's sequence
        });
        yield* conversations.ask(
          env({ _tag: "ArmWake", kind: "standup", key: "daily", dueAt: 1_000 }),
        );
        yield* TestClock.adjust(1_000);
        yield* fireDue(yield* Clock.currentTimeMillis);
        return (yield* audit(mate)).problems;
      }).pipe(Effect.provide(engineLayer(file, new World().handlers())));
      expect(problems).toEqual([]);
    }),
  );
});
