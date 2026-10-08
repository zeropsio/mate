import { assert, describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import {
  BootId,
  CommandId,
  ConversationId,
  EffectId,
  effectId,
  wakeId,
  type EffectOutcome,
  type SessionId,
  type TurnHandle,
} from "@t3tools/contracts";

import * as ConversationsModule from "../Conversations.ts";
import { Conversations } from "../Conversations.ts";
import type {
  Command,
  Decision,
  EffectClass,
  EffectLane,
  Envelope,
  ProviderSignal,
} from "../domain/command.ts";
import { CONTINUE_TEXT } from "../domain/decide.ts";
import { signalsCommandId } from "../domain/ids.ts";
import {
  drive,
  envelope,
  opened,
  prepared,
  r,
  send,
  sent,
  sqliteWithEngineTables,
} from "../testing/fixtures.ts";
import * as EngineSignals from "../EngineSignals.ts";
import { OwnerDomains } from "../owners.ts";
import * as EngineStoreModule from "../store/EngineStore.ts";
import { EngineStore, EngineStoreError } from "../store/EngineStore.ts";
import { tallyDomain, tallyEffectId, tallyOwner } from "../testing/tallyOwner.ts";
import { World, audit, engineLayer, fireDue, newBoot, tempDb } from "../testing/world.ts";
import * as EffectOutboxModule from "./EffectOutbox.ts";
import { EffectOutbox, type EffectPool } from "./EffectOutbox.ts";
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
const runPrepare: EffectHandler = {
  kind: "run.prepare",
  run: () => Effect.succeed({ _tag: "Done", outcome: { kind: "ok" } }),
};
const providerSend: EffectHandler = {
  kind: "provider.send",
  run: () =>
    Effect.succeed({ _tag: "Done", outcome: { kind: "ok", value: { providerTurnId: "t" } } }),
};

const engine = Layer.mergeAll(
  ConversationsModule.layer(),
  EffectOutboxModule.layer,
  Layer.succeed(EffectHandlers, handlersOf(echo, flaky, runPrepare, sessionOpen, providerSend)),
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

describe("EffectOutbox: lanes", () => {
  it.layer(engine)("control", (it) => {
    it.effect("a Stop or an answer is claimed while the send before it is still in flight", () =>
      Effect.gen(function* () {
        const outbox = yield* EffectOutbox;
        const c = ConversationId.make("lanes");
        yield* enqueue(c, [
          { id: "send", lane: "turn", class: "process-bound" },
          { id: "next-send", lane: "turn", class: "process-bound" },
          { id: "interrupt", lane: "control", class: "process-bound" },
          { id: "answer", lane: "control", class: "process-bound" },
        ]);
        const take = outbox
          .claim(boot1, 0)
          .pipe(Effect.map(Option.match({ onNone: () => "none", onSome: (row) => row.effectId })));
        const claimed = [yield* take, yield* take, yield* take];
        assert.deepStrictEqual(claimed, ["send", "interrupt", "none"]);
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
          envelope(prepared(1, live), { conversation: live }),
          envelope(opened(1, live), { conversation: live }),
          envelope(sent(1, live), { conversation: live }),
        ]);
        yield* drive(store, yield* store.load(opening), [
          envelope(send(), { conversation: opening }),
          envelope(prepared(1, opening), { conversation: opening }),
        ]);
        yield* enqueue(side, [{ id: "replayable" }]);
        yield* outbox.claim(boot1, 0);

        const worker = yield* makeEffectWorker(boot2);
        const report = yield* worker.reconcileAtBoot();
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
            report: { requeued: 1, recovered: 2, deferred: [] },
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

// ── what the proof found at the worker and at boot (round 3: review 1, 3, 4; F1, F4) ─────────

const mate = ConversationId.make("mate");
const ana = { kind: "person", subject: "ana" } as const;
let proofIds = 0;
const env = (command: Command, id?: string): Envelope => ({
  commandId: CommandId.make(id ?? `w-${++proofIds}`),
  conversationId: mate,
  principal: ana,
  command,
});
let proofBatches = 0;
const signalsFrom = (session: string, ...list: ReadonlyArray<ProviderSignal>) =>
  env(
    { _tag: "ProviderSignals", sessionId: session as SessionId, signals: list },
    signalsCommandId(session as SessionId, ++proofBatches),
  );
const ended: ProviderSignal = {
  kind: "turn-ended",
  turn: "mate/r/1" as TurnHandle,
  outcome: { kind: "completed" },
  source: "agent",
};
const yieldMany = Effect.forEach(Array.from({ length: 300 }), () => Effect.yieldNow, {
  discard: true,
});

describe("EffectWorker: a restart", () => {
  it.effect("the first message after a restart opens a new session and reaches the agent", () =>
    Effect.gen(function* () {
      const file = tempDb("r1");
      const world = new World();
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(env({ _tag: "Send", text: "first" }));
        for (let i = 0; i < 3; i++) yield* worker.runOnce; // capture, session, send
        yield* conversations.tell(signalsFrom("w1", ended));
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      world.crash();
      const after = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* worker.reconcileAtBoot();
        yield* conversations.ask(env({ _tag: "Send", text: "after the restart" }));
        for (let i = 0; i < 6; i++) yield* worker.runOnce;
        const { state, events } = yield* audit(mate);
        return {
          asked: events
            .flatMap((e) => (e._tag === "EffectRequested" ? [e.kind] : []))
            .filter((kind) => kind === "session.open" || kind === "provider.send")
            .slice(2),
          run: state.runs[r(2, mate)]?.end?.kind ?? state.runs[r(2, mate)]?.state,
          received: world.received.map((x) => x.text),
        };
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      expect(after).toEqual({
        asked: ["session.open", "provider.send"],
        run: "running",
        received: ["first", "after the restart"],
      });
    }),
  );

  it.effect("a message accepted on an open session reaches the agent across a restart", () =>
    Effect.gen(function* () {
      const file = tempDb("f1");
      const world = new World();
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(env({ _tag: "Send", text: "first" }));
        for (let i = 0; i < 3; i++) yield* worker.runOnce; // capture, session, send
        yield* conversations.tell(signalsFrom("w1", ended));
        yield* conversations.ask(env({ _tag: "Send", text: "second" }));
        yield* worker.runOnce; // the first run releases its capture
        yield* worker.runOnce; // the second is captured: its send is queued on w1
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      world.crash();
      const received = yield* Effect.gen(function* () {
        const worker = yield* makeEffectWorker(newBoot());
        yield* worker.reconcileAtBoot();
        for (let i = 0; i < 6; i++) {
          yield* fireDue(yield* Clock.currentTimeMillis);
          yield* worker.runOnce;
        }
        return world.received.map((x) => x.text);
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      expect(received).toEqual(["first", "second"]);
      expect(CONTINUE_TEXT).toBe("Continue where you left off.");
    }),
  );
});

describe("EffectWorker: the worker", () => {
  it.effect("a lane held by a running effect lets the worker sleep, not spin", () =>
    Effect.gen(function* () {
      const file = tempDb("r3");
      const world = new World();
      const claims = yield* Effect.gen(function* () {
        const outbox = yield* EffectOutbox;
        const store = yield* EngineStore;
        let count = 0;
        const state = yield* store.load(mate);
        const rows = ["a/e/test.replay/1", "a/e/test.replay/2"].map((id) => ({
          effectId: EffectId.make(id),
          kind: "test.replay",
          lane: "turn" as const,
          class: "replay-safe" as const,
          runId: null,
          payload: {},
        }));
        yield* store.commit({
          envelope: env({ _tag: "Archive" }),
          decision: {
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
              result: { _tag: "Accepted", seq: 2 },
            },
          },
          state,
          now: 0,
        });
        const boot = newBoot();
        yield* outbox.claim(boot, 0);
        const counting = {
          ...outbox,
          claim: (b: typeof boot, now: number, pool?: EffectPool) =>
            Effect.andThen(
              Effect.sync(() => count++),
              outbox.claim(b, now, pool),
            ),
        };
        // Four fibers in all: two for the conversations, two for the other owners.
        const worker = yield* makeEffectWorker(boot, {
          concurrency: 2,
          ownerConcurrency: 2,
        }).pipe(Effect.provideService(EffectOutbox, counting));
        yield* worker.start;
        yield* yieldMany;
        return count;
      }).pipe(Effect.scoped, Effect.provide(engineLayer(file, world.handlers())));
      expect(claims).toBeLessThanOrEqual(8);
    }),
  );

  it.effect("an outcome that failed to record is recorded later, and its lane moves on", () =>
    Effect.gen(function* () {
      const file = tempDb("r4");
      const world = new World();
      let failing = 0;
      const fault = () =>
        failing > 0
          ? Effect.suspend(
              () => (
                failing--,
                Effect.fail(
                  new EngineStoreError({ operation: "commit", cause: new Error("SQLITE_BUSY") }),
                )
              ),
            )
          : Effect.void;
      const result = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(env({ _tag: "Send", text: "go" }));
        yield* worker.runOnce; // the capture
        failing = 4; // the session's outcome: the first try and the worker's three immediate retries
        yield* Effect.exit(worker.runOnce);
        for (let i = 0; i < 3; i++) {
          yield* TestClock.adjust(60_000);
          yield* worker.runOnce;
        }
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          readonly kind: string;
          readonly state: string;
        }>`SELECT kind, state FROM engine_effect ORDER BY rowid`;
        return {
          run: (yield* audit(mate)).state.runs[r(1, mate)]?.state,
          rows: rows.map((x) => `${x.kind}:${x.state}`),
        };
      }).pipe(Effect.provide(engineLayer(file, world.handlers(), { fault: () => fault() })));
      expect(result).toEqual({
        run: "running",
        rows: ["run.prepare:done", "session.open:done", "provider.send:done"],
      });
    }),
  );

  it.effect("an outcome decided before a restart is recorded at boot, before anything is cut", () =>
    Effect.gen(function* () {
      const file = tempDb("settling");
      const world = new World();
      let failing = 0;
      const fault = () =>
        failing > 0
          ? Effect.fail(
              new EngineStoreError({ operation: "commit", cause: new Error("SQLITE_BUSY") }),
            )
          : Effect.void;
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(env({ _tag: "Send", text: "go" }));
        yield* worker.runOnce; // the capture
        failing = 1; // the store refuses every commit from now on, then the process dies
        yield* Effect.exit(worker.runOnce);
      }).pipe(Effect.provide(engineLayer(file, world.handlers(), { fault: () => fault() })));
      world.crash();
      const opening = yield* Effect.gen(function* () {
        const worker = yield* makeEffectWorker(newBoot());
        yield* worker.reconcileAtBoot();
        const { events, problems } = yield* audit(mate);
        const recorded = events.find(
          (e) => e._tag === "EffectOutcomeRecorded" && e.kind === "session.open",
        );
        return {
          outcome: recorded?._tag === "EffectOutcomeRecorded" ? recorded.outcome.kind : null,
          acts: world.acts.get(effectId(r(1, mate), "session.open", 1)),
          problems,
        };
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      expect(opening).toEqual({ outcome: "ok", acts: 1, problems: [] });
    }),
  );

  it.effect("a send whose handler died after the message went out is not sent again", () =>
    Effect.gen(function* () {
      const world = new World();
      const dying = handlersOf(...world.handlers().values(), {
        kind: "provider.send",
        run: (row) =>
          Effect.sync(() => world.act(row)).pipe(Effect.andThen(Effect.die("reply did not parse"))),
      });
      const acts = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(env({ _tag: "Send", text: "deploy" }));
        yield* worker.runOnce; // run.prepare
        yield* worker.runOnce; // session.open
        for (let i = 0; i < 6; i++) {
          yield* worker.runOnce;
          yield* TestClock.adjust(30_000);
        }
        return [...world.acts].filter(([id]) => id.includes("provider.send")).map(([, n]) => n);
      }).pipe(Effect.provide(engineLayer(tempDb("f4"), dying)));
      expect(acts).toEqual([1]);
    }),
  );
});

// ── another owner kind: the crew's lanes, fibers and retries ───────────────────────────────────

describe("EffectWorker: another owner kind", () => {
  const crewPrincipal = { kind: "crew", startedBy: "ana" } as const;
  const askCrew = (key: string, kind: string, lane: string) =>
    Effect.gen(function* () {
      const crew = (yield* Conversations).owner(tallyDomain);
      yield* crew.ask({
        commandId: CommandId.make(`ask-${key}`),
        conversationId: tallyOwner,
        principal: crewPrincipal,
        command: { _tag: "Ask", kind, lane, key },
      });
      return tallyEffectId(key, kind);
    });

  /** A crew check that holds its fiber until the test lets it go. */
  const holding = (release: Deferred.Deferred<void>): EffectHandler => ({
    kind: "test.hold",
    run: () =>
      Effect.as(Deferred.await(release), {
        _tag: "Done",
        outcome: { kind: "ok" },
      } satisfies HandlerResult),
  });
  /** Fails until its seventh try: an ssh connection that comes back after a minute. */
  const outage: EffectHandler = {
    kind: "test.outage",
    run: (row) =>
      Effect.succeed<HandlerResult>(
        row.attempt < 7
          ? { _tag: "Retry", reason: "ssh: connection refused" }
          : { _tag: "Done", outcome: { kind: "ok" } },
      ),
  };

  const withCrew = (handlers: ReadonlyArray<EffectHandler>) =>
    Layer.mergeAll(
      ConversationsModule.layer(),
      EffectOutboxModule.layer,
      Layer.succeed(EffectHandlers, handlersOf(echo, ...handlers)),
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          EngineStoreModule.layer,
          EngineSignals.layer,
          Layer.succeed(OwnerDomains, [tallyDomain]),
        ),
      ),
      Layer.provideMerge(sqliteWithEngineTables),
    );

  it.effect("a long effect on one lane never holds another lane", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const states = yield* Effect.gen(function* () {
        const long = yield* askCrew("check-ana", "test.hold", "check/ana");
        const behind = yield* askCrew("check-ana-2", "test.echo", "check/ana");
        const other = yield* askCrew("git-bo", "test.echo", "git/bo");
        const worker = yield* makeEffectWorker(boot1, { concurrency: 1, ownerConcurrency: 2 });
        yield* worker.start;
        yield* yieldMany;
        const whileHeld = {
          long: yield* rowState(long),
          behind: yield* rowState(behind),
          other: yield* rowState(other),
        };
        yield* Deferred.succeed(release, undefined);
        yield* yieldMany;
        const crew = yield* (yield* Conversations).owner(tallyDomain).state(tallyOwner);
        return { whileHeld, settled: [...crew.settled].sort() };
      }).pipe(Effect.scoped, Effect.provide(withCrew([holding(release)])));
      expect(states).toEqual({
        whileHeld: { long: "running", behind: "pending", other: "done" },
        settled: [
          tallyEffectId("check-ana", "test.hold"),
          tallyEffectId("check-ana-2", "test.echo"),
          tallyEffectId("git-bo", "test.echo"),
        ].sort(),
      });
    }),
  );

  it.effect("crew's cap leaves conversation effects running", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const states = yield* Effect.gen(function* () {
        const long = yield* askCrew("check-ana", "test.hold", "check/ana");
        const capped = yield* askCrew("git-bo", "test.echo", "git/bo");
        yield* enqueue(mate, [{ id: "mate/e/test.echo/1", lane: "turn" }]);
        const worker = yield* makeEffectWorker(boot1, { concurrency: 1, ownerConcurrency: 1 });
        yield* worker.start;
        yield* yieldMany;
        const whileHeld = {
          crewLong: yield* rowState(long),
          crewCapped: yield* rowState(capped),
          conversation: yield* rowState("mate/e/test.echo/1"),
        };
        yield* Deferred.succeed(release, undefined);
        yield* yieldMany;
        return { whileHeld, capped: yield* rowState(capped) };
      }).pipe(Effect.scoped, Effect.provide(withCrew([holding(release)])));
      expect(states).toEqual({
        whileHeld: { crewLong: "running", crewCapped: "pending", conversation: "done" },
        capped: "done",
      });
    }),
  );

  it.effect("a crew effect rides out a minute's outage that fails a conversation's for good", () =>
    Effect.gen(function* () {
      const states = yield* Effect.gen(function* () {
        const crewEffect = yield* askCrew("git-ana", "test.outage", "git/ana");
        yield* enqueue(mate, [{ id: "mate/e/test.outage/1", kind: "test.outage", lane: "side" }]);
        const worker = yield* makeEffectWorker(boot1);
        for (let tick = 0; tick < 40; tick++) {
          while (yield* worker.runOnce) {
            // everything due now
          }
          yield* TestClock.adjust(5_000);
        }
        return {
          crew: yield* rowState(crewEffect),
          conversation: yield* rowState("mate/e/test.outage/1"),
        };
      }).pipe(Effect.provide(withCrew([outage])));
      expect(states).toEqual({ crew: "done", conversation: "failed" });
    }),
  );
});
