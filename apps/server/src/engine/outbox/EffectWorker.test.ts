import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  BootId,
  ConversationId,
  EffectId,
  effectId,
  wakeId,
  type EffectOutcome,
} from "@t3tools/contracts";

import * as ConversationsModule from "../Conversations.ts";
import { Conversations } from "../Conversations.ts";
import type { Decision, EffectClass, EffectLane } from "../domain/command.ts";
import {
  drive,
  envelope,
  opened,
  r,
  send,
  sent,
  sqliteWithEngineTables,
} from "../engine.testFixtures.ts";
import * as EngineSignals from "../EngineSignals.ts";
import * as EngineStoreModule from "../store/EngineStore.ts";
import { EngineStore } from "../store/EngineStore.ts";
import * as EffectOutboxModule from "./EffectOutbox.ts";
import { EffectOutbox } from "./EffectOutbox.ts";
import {
  EffectHandlers,
  handlersOf,
  makeEffectWorker,
  type EffectHandler,
  type HandlerResult,
} from "./EffectWorker.ts";

const boot1 = BootId.make("boot-1");
const boot2 = BootId.make("boot-2");

interface Queued {
  readonly id: string;
  readonly kind?: string;
  readonly lane?: EffectLane;
  readonly class?: EffectClass;
}

/** Commits a step that only queues effects, as `decide` would for a run. */
const enqueue = (conversation: ConversationId, effects: ReadonlyArray<Queued>) =>
  Effect.gen(function* () {
    const store = yield* EngineStore;
    const state = yield* store.load(conversation);
    const rows = effects.map((effect) => ({
      effectId: EffectId.make(effect.id),
      kind: effect.kind ?? "test.echo",
      lane: effect.lane ?? "turn",
      class: effect.class ?? "replay-safe",
      runId: null,
      payload: { id: effect.id },
    }));
    const decision: Decision = {
      _tag: "Accept",
      step: {
        events: rows.map((row) => ({
          _tag: "EffectRequested" as const,
          effectId: row.effectId,
          kind: row.kind,
          runId: null,
        })),
        effects: rows,
        details: [],
        result: { _tag: "Accepted", seq: state.headSeq + rows.length },
      },
    };
    yield* store.commit({
      envelope: envelope({ _tag: "Archive" }, { conversation }),
      decision,
      state,
      now: 0,
    });
  });

const calls: Array<string> = [];
const evidence = new Set<string>();
const echo: EffectHandler = {
  kind: "test.echo",
  adopt: (row) =>
    Effect.sync(() =>
      evidence.has(row.effectId)
        ? Option.some<EffectOutcome>({ kind: "ok", value: "adopted" })
        : Option.none(),
    ),
  run: (row) =>
    Effect.sync((): HandlerResult => {
      calls.push(row.effectId);
      return { _tag: "Done", outcome: { kind: "ok", value: "acted" } };
    }),
};
const flaky: EffectHandler = {
  kind: "test.flaky",
  run: () => Effect.succeed({ _tag: "Retry", reason: "socket busy" }),
};
const sessionOpen: EffectHandler = {
  kind: "session.open",
  run: () =>
    Effect.succeed({
      _tag: "Done",
      outcome: {
        kind: "ok",
        value: {
          sessionId: "s1",
          driver: "test",
          model: null,
          nativeRef: null,
          capabilities: { steer: false },
        },
      },
    }),
};
const providerSend: EffectHandler = {
  kind: "provider.send",
  run: () =>
    Effect.succeed({ _tag: "Done", outcome: { kind: "ok", value: { providerTurnId: "t" } } }),
};

const engine = Layer.mergeAll(
  ConversationsModule.layer(),
  EffectOutboxModule.layer,
  Layer.succeed(EffectHandlers, handlersOf(echo, flaky, sessionOpen, providerSend)),
).pipe(
  Layer.provideMerge(Layer.mergeAll(EngineStoreModule.layer, EngineSignals.layer)),
  Layer.provideMerge(sqliteWithEngineTables),
);

const rowState = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly state: string }>`
      SELECT state FROM engine_effect WHERE effect_id = ${id}
    `;
    return row?.state;
  });

describe("EffectOutbox", () => {
  it.layer(engine)("claim", (it) => {
    it.effect(
      "claims FIFO per conversation and lane, a row in backoff holding the rows behind it",
      () =>
        Effect.gen(function* () {
          const outbox = yield* EffectOutbox;
          const a = ConversationId.make("a");
          const b = ConversationId.make("b");
          yield* enqueue(a, [{ id: "a1" }, { id: "a2" }, { id: "a3", lane: "side" }]);
          yield* enqueue(b, [{ id: "b1" }]);
          const take = (now: number) =>
            outbox.claim(boot1, now).pipe(
              Effect.map(
                Option.match({
                  onNone: () => "none",
                  onSome: (row) => `${row.effectId}#${row.attempt}`,
                }),
              ),
            );
          const first = [yield* take(0), yield* take(0), yield* take(0), yield* take(0)];
          const a1 = Option.getOrThrow(yield* outbox.row(EffectId.make("a1")));
          yield* outbox.retry(a1, 0, "busy");
          const inBackoff = yield* take(50);
          const due = yield* take(100);
          yield* outbox.close(EffectId.make("a1"), "done", "test");
          const behind = yield* take(100);
          assert.deepStrictEqual(
            { first, inBackoff, due, behind },
            {
              first: ["a1#1", "a3#1", "b1#1", "none"],
              inBackoff: "none",
              due: "a1#2",
              behind: "a2#1",
            },
          );
        }),
    );
  });
});

describe("EffectWorker", () => {
  it.layer(engine)("acting", (it) => {
    it.effect("runs an effect queued twice under one id once", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const worker = yield* makeEffectWorker(boot1);
        const c = ConversationId.make("dedup");
        yield* enqueue(c, [{ id: "dedup/e/test.echo/1" }]);
        yield* enqueue(c, [{ id: "dedup/e/test.echo/1" }]);
        const [rows] = yield* sql<{ readonly n: number }>`
          SELECT count(*) AS n FROM engine_effect WHERE effect_id = 'dedup/e/test.echo/1'
        `;
        const ran = [yield* worker.runOnce, yield* worker.runOnce];
        assert.deepStrictEqual(
          {
            rows: rows!.n,
            ran,
            calls: calls.filter((id) => id === "dedup/e/test.echo/1").length,
            state: yield* rowState("dedup/e/test.echo/1"),
          },
          { rows: 1, ran: [true, false], calls: 1, state: "done" },
        );
      }),
    );

    it.effect("a handler adopts prior evidence instead of acting again", () =>
      Effect.gen(function* () {
        const store = yield* EngineStore;
        const worker = yield* makeEffectWorker(boot1);
        const c = ConversationId.make("evidence");
        evidence.add("landed");
        yield* enqueue(c, [{ id: "landed" }, { id: "fresh" }]);
        yield* worker.runOnce;
        yield* worker.runOnce;
        const outcomes = (yield* store.events(c, 0)).flatMap((event) =>
          event._tag === "EffectOutcomeRecorded" ? [[event.effectId, event.outcome]] : [],
        );
        assert.deepStrictEqual(
          { calls: calls.filter((id) => id === "landed" || id === "fresh"), outcomes },
          {
            calls: ["fresh"],
            outcomes: [
              ["landed", { kind: "ok", value: "adopted" }],
              ["fresh", { kind: "ok", value: "acted" }],
            ],
          },
        );
      }),
    );

    it.effect("a retryable failure backs off, then fails for good at the attempt limit", () =>
      Effect.gen(function* () {
        const store = yield* EngineStore;
        const worker = yield* makeEffectWorker(boot1, { maxAttempts: 2 });
        const c = ConversationId.make("flaky");
        yield* enqueue(c, [{ id: "f1", kind: "test.flaky" }]);
        const first = yield* worker.runOnce;
        const pendingAfterFirst = yield* rowState("f1");
        const early = yield* worker.runOnce;
        yield* TestClock.adjust(100);
        const second = yield* worker.runOnce;
        const last = (yield* store.events(c, 0)).at(-1);
        assert.deepStrictEqual(
          { first, pendingAfterFirst, early, second, state: yield* rowState("f1") },
          {
            first: true,
            pendingAfterFirst: "pending",
            early: false,
            second: true,
            state: "failed",
          },
        );
        expect(last).toMatchObject({
          _tag: "EffectOutcomeRecorded",
          outcome: { kind: "failed", reason: "socket busy" },
        });
      }),
    );

    it.effect("wakes on the actor's ring and carries a run from admitted to running", () =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(boot1, { concurrency: 2 });
        yield* worker.start;
        const c = ConversationId.make("e2e");
        const started = yield* conversations.subscribe(c, 0).pipe(
          Stream.takeUntil((event) => event._tag === "RunStarted"),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* conversations.ask(envelope(send("go"), { conversation: c }));
        const events = yield* Fiber.join(started);
        expect(events.map((event) => event._tag)).toEqual([
          "RunQueued",
          "ItemOpened",
          "RunAdmitted",
          "EffectRequested",
          "EffectOutcomeRecorded",
          "SessionOpened",
          "EffectRequested",
          "RunSending",
          "EffectOutcomeRecorded",
          "RunStarted",
        ]);
      }),
    );
  });

  it.layer(engine)("boot", (it) => {
    it.effect("cuts process-bound work and tells its owner; requeues replay-safe work", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* EngineStore;
        const outbox = yield* EffectOutbox;
        const live = ConversationId.make("live");
        const opening = ConversationId.make("opening");
        const side = ConversationId.make("side");
        yield* drive(store, yield* store.load(live), [
          envelope(send(), { conversation: live }),
          envelope(opened(1, live), { conversation: live }),
          envelope(sent(1, live), { conversation: live }),
        ]);
        yield* drive(store, yield* store.load(opening), [
          envelope(send(), { conversation: opening }),
        ]);
        yield* enqueue(side, [{ id: "replayable" }]);
        yield* outbox.claim(boot1, 0);

        const worker = yield* makeEffectWorker(boot2);
        const report = yield* worker.reconcileAtBoot;
        const [liveRun] = yield* sql<{ readonly state: string; readonly end_kind: string }>`
          SELECT state, json_extract(end_json, '$.kind') AS end_kind FROM engine_run WHERE run_id = ${r(1, live)}
        `;
        const [continuation] = yield* sql<{ readonly state: string }>`
          SELECT state FROM engine_wake
          WHERE wake_id = ${wakeId(live, "restart-continuation", r(1, live))}
        `;
        assert.deepStrictEqual(
          {
            report,
            liveRun: { state: liveRun!.state, end: liveRun!.end_kind },
            continuation: continuation?.state,
            cutOpening: yield* rowState(effectId(r(1, opening), "session.open", 1)),
            reopening: yield* rowState(effectId(r(1, opening), "session.open", 2)),
            replayable: yield* rowState("replayable"),
          },
          {
            report: { requeued: 1, recovered: 2 },
            liveRun: { state: "ended", end: "cut-by-restart" },
            continuation: "armed",
            cutOpening: "cut",
            reopening: "pending",
            replayable: "pending",
          },
        );
      }),
    );
  });
});
