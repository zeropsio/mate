import { expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { CommandId, ConversationId, EffectId, effectId, type SessionId } from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";
import type { Decision, EffectClass, EffectLane, ProviderSignal } from "../domain/command.ts";
import { signalsCommandId } from "../domain/ids.ts";
import { EngineSignals, type Doorbell } from "../EngineSignals.ts";
import { EngineStore } from "../store/EngineStore.ts";
import {
  conversation,
  drive,
  envelope,
  opened,
  prepared,
  r,
  send,
  sent,
  turn,
} from "../testing/fixtures.ts";
import { tallyDomain, tallyEffectId, tallyOwner } from "../testing/tallyOwner.ts";
import { World, audit, engineLayer, fireDue, newBoot, tempDb } from "../testing/world.ts";
import { EffectOutbox, OWNER_RETRY } from "./EffectOutbox.ts";
import {
  handlersOf,
  makeEffectWorker,
  type EffectHandler,
  type HandlerResult,
} from "./EffectWorker.ts";

interface Queued {
  readonly id: string;
  readonly kind?: string;
  readonly lane?: EffectLane;
  readonly class?: EffectClass;
}

/** Commits a step that only queues effects, at time 0, as `decide` would for a run. */
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

const rowState = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly state: string }>`
      SELECT state FROM engine_effect WHERE effect_id = ${id}
    `;
    return row?.state;
  });

const done = (value?: unknown): HandlerResult => ({
  _tag: "Done",
  outcome: value === undefined ? { kind: "ok" } : { kind: "ok", value },
});

/**
 * Runs `effect` in a test-clock wake 1 ms on: `TestClock.adjust` returns once it, and every fiber
 * it forks or resumes (the worker's), has suspended.
 */
const settled = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.andThen(Effect.sleep(1), effect).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    yield* TestClock.adjust(1);
    return yield* Fiber.join(fiber);
  });

/** Opens a store write's failure: every event insert aborts until `free`. */
const busy = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) =>
    sql`CREATE TRIGGER busy BEFORE INSERT ON engine_event BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY'); END`,
);
const free = Effect.flatMap(SqlClient.SqlClient, (sql) => sql`DROP TRIGGER busy`);

/** The crew queues one effect of `kind` on `lane`; its id. */
const askCrew = (key: string, kind: string, lane: string) =>
  Effect.gen(function* () {
    const crew = (yield* Conversations).owner(tallyDomain);
    yield* crew.ask({
      commandId: CommandId.make(`ask-${key}`),
      conversationId: tallyOwner,
      principal: { kind: "crew", startedBy: "ana" },
      command: { _tag: "Ask", kind, lane, key },
    });
    return tallyEffectId(key, kind);
  });

/** A batch of the agent's signals on a session of the world. */
const signalled = (session: string, batch: number, ...signals: ReadonlyArray<ProviderSignal>) =>
  envelope(
    { _tag: "ProviderSignals", sessionId: session as SessionId, signals },
    { id: signalsCommandId(session as SessionId, batch) },
  );
const firstTurnEnded: ProviderSignal = {
  kind: "turn-ended",
  turn: turn(1),
  outcome: { kind: "completed" },
  source: "agent",
};

// witness: apps/server/src/engine/store/EngineStore.ts | ON CONFLICT (effect_id) DO NOTHING → ON CONFLICT (effect_id) DO UPDATE SET state = 'pending'
it.effect(
  "EO+3: An effect queued twice under one id runs once; breaks: a deploy or a message goes twice",
  () => {
    const acts: Array<string> = [];
    const echo: EffectHandler = {
      kind: "test.echo",
      run: (row) => Effect.sync(() => (acts.push(row.effectId), done("acted"))),
    };
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const worker = yield* makeEffectWorker(newBoot());
      const c = ConversationId.make("dedup");
      const id = "dedup/e/test.echo/1";
      yield* enqueue(c, [{ id }]);
      yield* enqueue(c, [{ id }]);
      const ran = [yield* worker.runOnce, yield* worker.runOnce];
      // Queued once more after it ran.
      yield* enqueue(c, [{ id }]);
      ran.push(yield* worker.runOnce);
      const [rows] = yield* sql<{ readonly n: number }>`
        SELECT count(*) AS n FROM engine_effect WHERE effect_id = ${id}
      `;
      expect({ rows: rows!.n, ran, acts, state: yield* rowState(id) }).toEqual({
        rows: 1,
        ran: [true, false, false],
        acts: [id],
        state: "done",
      });
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf(echo))));
  },
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | onSome: (outcome) => Effect.succeed<HandlerResult>({ _tag: "Done", outcome }), → onSome: () => act,
it.effect(
  "EO+4: A handler that finds evidence of its act adopts it instead of acting again; breaks: a restart repeats an act that already happened",
  () => {
    const world = new World();
    return Effect.gen(function* () {
      const store = yield* EngineStore;
      const worker = yield* makeEffectWorker(newBoot());
      const c = ConversationId.make("evidence");
      world.landed.add("landed");
      yield* enqueue(c, [
        { id: "landed", kind: "test.replay" },
        { id: "fresh", kind: "test.replay" },
      ]);
      yield* worker.runOnce;
      yield* worker.runOnce;
      const outcomes = (yield* store.events(c, 0)).flatMap((event) =>
        event._tag === "EffectOutcomeRecorded" ? [[event.effectId, event.outcome]] : [],
      );
      expect({ acts: [...world.acts], outcomes }).toEqual({
        acts: [["fresh", 1]],
        outcomes: [
          ["landed", { kind: "ok", value: "adopted" }],
          ["fresh", { kind: "ok", value: "acted" }],
        ],
      });
    }).pipe(Effect.provide(engineLayer(":memory:", world.handlers())));
  },
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | if (row.attempt >= policy.maxAttempts) { → if (row.attempt > policy.maxAttempts) {
it.effect(
  "EO+5: A conversation's retryable failure backs off and fails for good at its attempt limit; breaks: a run waits forever on an effect that cannot succeed",
  () => {
    const flaky: EffectHandler = {
      kind: "test.flaky",
      run: () => Effect.succeed({ _tag: "Retry", reason: "socket busy" }),
    };
    return Effect.gen(function* () {
      const store = yield* EngineStore;
      const worker = yield* makeEffectWorker(newBoot());
      const c = ConversationId.make("flaky");
      yield* enqueue(c, [{ id: "f1", kind: "test.flaky" }]);
      const first = yield* worker.runOnce;
      // Five tries, `min(30 s, 100 ms · 2^(n − 1))` after try n: 100, 200, 400 and 800 ms.
      const tries: Array<{
        readonly early: boolean;
        readonly due: boolean;
        readonly state: string | undefined;
      }> = [];
      for (const backoff of [100, 200, 400, 800]) {
        const state = yield* rowState("f1");
        yield* TestClock.adjust(backoff - 1);
        const early = yield* worker.runOnce;
        yield* TestClock.adjust(1);
        tries.push({ early, due: yield* worker.runOnce, state });
      }
      yield* TestClock.adjust(60_000);
      const after = yield* worker.runOnce;
      const last = (yield* store.events(c, 0)).at(-1);
      expect({
        first,
        tries,
        after,
        state: yield* rowState("f1"),
        last: last?._tag === "EffectOutcomeRecorded" ? last.outcome : last?._tag,
      }).toEqual({
        first: true,
        tries: Array.from({ length: 4 }, () => ({ early: false, due: true, state: "pending" })),
        after: false,
        state: "failed",
        last: { kind: "failed", reason: "socket busy" },
      });
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf(flaky))));
  },
);

// witness: apps/server/src/engine/outbox/EffectOutbox.ts | WHERE class = 'replay-safe' AND state = 'running' → WHERE class = 'replay-safe' AND state = 'pending'
it.effect(
  "EO+6: At boot, process-bound work the restart cut is cut and its owner told, and replay-safe work is queued again; breaks: a send goes to a session that died with the process",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* EngineStore;
      const outbox = yield* EffectOutbox;
      const live = ConversationId.make("live");
      const opening = ConversationId.make("opening");
      const side = ConversationId.make("side");
      // A run talking to its session; a run whose session was asked for and never opened.
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
      // Replay-safe work the first boot was running.
      yield* enqueue(side, [{ id: "replayable" }]);
      const claimed = yield* outbox.claim(newBoot(), 0);

      const worker = yield* makeEffectWorker(newBoot());
      const report = yield* worker.reconcileAtBoot();
      const [liveRun] = yield* sql<{ readonly state: string; readonly end_kind: string }>`
        SELECT state, json_extract(end_json, '$.kind') AS end_kind FROM engine_run
        WHERE run_id = ${r(1, live)}
      `;
      expect({
        claimed: Option.map(claimed, (row) => row.effectId),
        report,
        liveRun,
        unopened: yield* rowState(effectId(r(1, opening), "session.open", 1)),
        replayable: yield* rowState("replayable"),
      }).toEqual({
        claimed: Option.some("replayable"),
        report: { requeued: 1, recovered: 2, deferred: [] },
        liveRun: { state: "ended", end_kind: "cut-by-restart" },
        unopened: "cut",
        replayable: "pending",
      });
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf()))),
);

// witness: apps/server/src/engine/outbox/EffectOutbox.ts | SELECT conversation_id FROM engine_session WHERE state = 'open' → SELECT conversation_id FROM engine_session WHERE state = 'closed'
it.effect(
  "EO+7: The first message after a restart opens a new session and reaches the agent; breaks: the message waits on the dead session",
  () =>
    Effect.gen(function* () {
      const file = tempDb("eo7");
      const world = new World();
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(envelope(send("first")));
        for (let i = 0; i < 3; i++) yield* worker.runOnce; // admission, session, send
        yield* conversations.tell(signalled("w1", 1, firstTurnEnded));
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      world.crash();
      const after = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* worker.reconcileAtBoot();
        yield* conversations.ask(envelope(send("after the restart")));
        for (let i = 0; i < 6; i++) yield* worker.runOnce;
        const { state, events } = yield* audit(conversation);
        return {
          asked: events
            .flatMap((e) => (e._tag === "EffectRequested" ? [e.kind] : []))
            .filter((kind) => kind === "session.open" || kind === "provider.send")
            .slice(2),
          run: state.runs[r(2)]?.end?.kind ?? state.runs[r(2)]?.state,
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

// witness: apps/server/src/engine/outbox/EffectOutbox.ts | const untried = row.state === "pending" && row.attempt === 0; → const untried = row.state === "pending" && row.attempt === 1;
it.effect(
  "EO+8: A message accepted on an open session before a restart reaches the agent after it; breaks: the message is lost with the session",
  () =>
    Effect.gen(function* () {
      const file = tempDb("eo8");
      const world = new World();
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(envelope(send("first")));
        for (let i = 0; i < 3; i++) yield* worker.runOnce; // admission, session, send
        yield* conversations.tell(signalled("w1", 1, firstTurnEnded));
        yield* conversations.ask(envelope(send("second")));
        yield* worker.runOnce; // the second is admitted: its send is queued on w1
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
    }),
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | if (Option.isNone(due) || due.value.outcome === null) return false; → if (Option.isNone(due) || due.value.outcome !== null) return false;
it.effect(
  "EO+9: An outcome that failed to record is recorded later, and its lane moves on; breaks: the lane stays held for good",
  () => {
    const world = new World();
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const conversations = yield* Conversations;
      const worker = yield* makeEffectWorker(newBoot());
      yield* conversations.ask(envelope(send("go")));
      yield* worker.runOnce; // the admission
      // The session opens, and its outcome cannot be recorded: the store is busy.
      yield* busy;
      yield* Effect.exit(worker.runOnce);
      yield* free;
      // Told again after `backoffMs(1)`; then the send behind it goes.
      yield* TestClock.adjust(100);
      for (let i = 0; i < 4; i++) yield* worker.runOnce;
      const rows = yield* sql<{ readonly kind: string; readonly state: string }>`
        SELECT kind, state FROM engine_effect ORDER BY rowid
      `;
      expect({
        run: (yield* audit(conversation)).state.runs[r(1)]?.state,
        rows: rows.map((x) => `${x.kind}:${x.state}`),
        opened: world.acts.get(effectId(r(1), "session.open", 1)),
      }).toEqual({
        run: "running",
        rows: ["run.prepare:done", "session.open:done", "provider.send:done"],
        opened: 1,
      });
    }).pipe(Effect.provide(engineLayer(":memory:", world.handlers())));
  },
);

/** Whether a ring reached `bell` since it was armed. */
const heard = (bell: Doorbell) =>
  Effect.gen(function* () {
    const waiting = yield* bell.wait.pipe(Effect.forkChild({ startImmediately: true }));
    const rang = waiting.pollUnsafe() !== undefined;
    yield* Fiber.interrupt(waiting);
    return rang;
  });

// witness: apps/server/src/engine/outbox/EffectWorker.ts | yield* rung(outbox.settleLater(row, yield* Clock.currentTimeMillis)); → yield* outbox.settleLater(row, yield* Clock.currentTimeMillis);
it.effect(
  "EO+10: Every write that changes what the worker may claim rings its bell: an outcome, a backoff, a settle put off, a stray row closed, rows queued; breaks: work waits for an unrelated wake",
  () => {
    const echo: EffectHandler = { kind: "test.echo", run: () => Effect.succeed(done()) };
    const flaky: EffectHandler = {
      kind: "test.flaky",
      run: () => Effect.succeed({ _tag: "Retry", reason: "socket busy" }),
    };
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const conversations = yield* Conversations;
      const bell = yield* (yield* EngineSignals).effects.consumer;
      const worker = yield* makeEffectWorker(newBoot());
      const rings = <A, E>(write: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          yield* bell.arm;
          yield* Effect.exit(write);
          return yield* heard(bell);
        });
      // Each step below makes one write the worker may claim by: an outcome, a backoff, a settle
      // put off, a row closed, rows queued. The rows are queued without a ring.
      yield* enqueue(ConversationId.make("settles"), [{ id: "settles/e/test.echo/1" }]);
      const settledOutcome = yield* rings(worker.runOnce);
      yield* enqueue(ConversationId.make("retries"), [
        { id: "retries/e/test.flaky/1", kind: "test.flaky" },
      ]);
      const retried = yield* rings(worker.runOnce);
      yield* enqueue(ConversationId.make("later"), [{ id: "later/e/test.echo/1" }]);
      yield* busy;
      const settledLater = yield* rings(worker.runOnce);
      yield* free;
      // A row its owner never queued: the settle is rejected and the worker closes the row.
      yield* sql`
        INSERT INTO engine_effect (
          effect_id, conversation_id, owner_kind, lane, kind, class, run_id, payload_json,
          state, attempt, available_at, cause_id, created_seq
        ) VALUES (
          'stray/e/test.echo/1', 'stray', 'conversation', 'turn', 'test.echo', 'replay-safe',
          NULL, 'null', 'pending', 0, 0, 'stray', 1
        )
      `;
      const closed = yield* rings(worker.runOnce);
      const queued = yield* rings(conversations.ask(envelope(send("go"))));
      expect({
        settledOutcome,
        retried,
        settledLater,
        closed,
        queued,
        rows: {
          settles: yield* rowState("settles/e/test.echo/1"),
          retries: yield* rowState("retries/e/test.flaky/1"),
          later: yield* rowState("later/e/test.echo/1"),
          stray: yield* rowState("stray/e/test.echo/1"),
        },
      }).toEqual({
        settledOutcome: true,
        retried: true,
        settledLater: true,
        closed: true,
        queued: true,
        rows: { settles: "done", retries: "pending", later: "settling", stray: "done" },
      });
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf(echo, flaky))));
  },
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | onNone: () => Effect.never, → onNone: () => Effect.sleep(30_000),
it.effect(
  "EO+11: An idle worker claims nothing until a row is due or the bell rings, and sleeps exactly to the next due row; breaks: a periodic wake polls the outbox",
  () => {
    const quiet: Array<number> = [];
    const later: Array<number> = [];
    const echo: EffectHandler = {
      kind: "test.echo",
      run: () => Effect.map(Clock.currentTimeMillis, (now) => (quiet.push(now), done())),
    };
    const notYet: EffectHandler = {
      kind: "test.later",
      run: (row) =>
        Effect.map(
          Clock.currentTimeMillis,
          (now): HandlerResult => (
            later.push(now),
            row.attempt === 1 ? { _tag: "Retry", reason: "not yet" } : done()
          ),
        ),
    };
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const signals = yield* EngineSignals;
      const worker = yield* makeEffectWorker(newBoot());
      yield* settled(worker.start);
      // A row no writer rang for: only a wake that looks without a reason would find it.
      yield* sql`
        INSERT INTO engine_effect (
          effect_id, conversation_id, owner_kind, lane, kind, class, run_id, payload_json,
          state, attempt, available_at, cause_id, created_seq
        ) VALUES (
          'quiet/e/test.echo/1', 'quiet', 'conversation', 'turn', 'test.echo', 'replay-safe',
          NULL, 'null', 'pending', 0, 0, 'quiet', 1
        )
      `;
      yield* TestClock.adjust(10 * 60_000);
      const whileIdle = [...quiet];
      yield* settled(signals.effects.ring);
      const rung = quiet.length;
      // A crew effect fails once: it is due again after the crew's first delay.
      yield* settled(askCrew("git-ana", "test.later", "git/ana"));
      const delay = OWNER_RETRY.delayMs(1);
      const triedAt = later[0]!;
      yield* TestClock.adjust(delay - 1);
      const beforeDue = [...later];
      yield* TestClock.adjust(1);
      expect({ whileIdle, rung, beforeDue, atDue: later }).toEqual({
        whileIdle: [],
        rung: 1,
        beforeDue: [triedAt],
        atDue: [triedAt, triedAt + delay],
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(engineLayer(":memory:", handlersOf(echo, notYet), [tallyDomain])),
    );
  },
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | if (!(yield* sweepOnce(Number.POSITIVE_INFINITY))) break; → if (!(yield* sweepOnce(now))) break;
it.effect(
  "EO+12: An outcome decided before a restart is recorded at boot before anything is cut; breaks: finished work is cut and done again",
  () =>
    Effect.gen(function* () {
      const file = tempDb("eo12");
      const world = new World();
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const worker = yield* makeEffectWorker(newBoot());
        yield* conversations.ask(envelope(send("go")));
        yield* worker.runOnce; // the admission
        // The session opens; its outcome cannot be recorded, then the process dies.
        yield* busy;
        yield* Effect.exit(worker.runOnce);
        yield* free;
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      world.crash();
      const opening = yield* Effect.gen(function* () {
        const worker = yield* makeEffectWorker(newBoot());
        yield* worker.reconcileAtBoot();
        const { events, problems } = yield* audit(conversation);
        const recorded = events.find(
          (e) => e._tag === "EffectOutcomeRecorded" && e.kind === "session.open",
        );
        return {
          outcome: recorded?._tag === "EffectOutcomeRecorded" ? recorded.outcome.kind : null,
          acts: world.acts.get(effectId(r(1), "session.open", 1)),
          problems,
        };
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      expect(opening).toEqual({ outcome: "ok", acts: 1, problems: [] });
    }),
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | row.class === "process-bound" → row.class !== "process-bound"
it.effect(
  "EO+13: A send whose handler died after the message went out is not sent again; breaks: the agent gets the message twice",
  () => {
    const world = new World();
    const dying = handlersOf(...world.handlers().values(), {
      kind: "provider.send",
      run: (row) =>
        Effect.sync(() => world.act(row)).pipe(Effect.andThen(Effect.die("reply did not parse"))),
    });
    return Effect.gen(function* () {
      const conversations = yield* Conversations;
      const worker = yield* makeEffectWorker(newBoot());
      yield* conversations.ask(envelope(send("deploy")));
      yield* worker.runOnce; // run.prepare
      yield* worker.runOnce; // session.open
      for (let i = 0; i < 6; i++) {
        yield* worker.runOnce;
        yield* TestClock.adjust(30_000);
      }
      expect({
        sends: [...world.acts].filter(([id]) => id.includes("provider.send")).map(([, n]) => n),
        state: yield* rowState(effectId(r(1), "provider.send", 1)),
      }).toEqual({ sends: [1], state: "failed" });
    }).pipe(Effect.provide(engineLayer(":memory:", dying)));
  },
);

/** A crew effect that holds its fiber until `release`. */
const holding = (release: Deferred.Deferred<void>): EffectHandler => ({
  kind: "test.hold",
  run: () => Effect.as(Deferred.await(release), done()),
});

const crewSettled = Effect.flatMap(Conversations, (conversations) =>
  conversations.owner(tallyDomain).state(tallyOwner),
).pipe(Effect.map((crew) => [...crew.settled].sort()));

// witness: apps/server/src/engine/outbox/EffectWorker.ts | const OWNER_FIBERS = 8; → const OWNER_FIBERS = 1;
it.effect(
  "EO+14: A long crew effect on one lane never holds another lane; breaks: one crewmate's check blocks another's Git",
  () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const echo: EffectHandler = { kind: "test.echo", run: () => Effect.succeed(done()) };
      yield* Effect.gen(function* () {
        const long = yield* askCrew("check-ana", "test.hold", "check/ana");
        const behind = yield* askCrew("check-ana-2", "test.echo", "check/ana");
        const other = yield* askCrew("git-bo", "test.echo", "git/bo");
        const worker = yield* makeEffectWorker(newBoot());
        yield* settled(worker.start);
        // Handlers are uninterruptible: let the held one go if an assertion fails.
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
        const whileHeld = {
          long: yield* rowState(long),
          behind: yield* rowState(behind),
          other: yield* rowState(other),
        };
        yield* settled(Deferred.succeed(release, undefined));
        expect({ whileHeld, settled: yield* crewSettled }).toEqual({
          whileHeld: { long: "running", behind: "pending", other: "done" },
          settled: [long, behind, other].sort(),
        });
      }).pipe(
        Effect.scoped,
        Effect.provide(engineLayer(":memory:", handlersOf(holding(release), echo), [tallyDomain])),
      );
    }),
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | const OWNER_FIBERS = 8; → const OWNER_FIBERS = 9;
it.effect(
  "EO+15: The crew runs at most 8 effects at once, and its cap never holds a conversation's effect; breaks: a busy crew stalls every conversation",
  () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const echo: EffectHandler = { kind: "test.echo", run: () => Effect.succeed(done()) };
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Nine crewmates' checks, each on its own lane, all held by one release.
        const held: Array<string> = [];
        for (let n = 1; n <= 9; n++) {
          held.push(yield* askCrew(`check-${n}`, "test.hold", `check/${n}`));
        }
        yield* enqueue(ConversationId.make("mate"), [{ id: "mate/e/test.echo/1" }]);
        const worker = yield* makeEffectWorker(newBoot());
        yield* settled(worker.start);
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
        const crew = yield* sql<{ readonly state: string; readonly n: number }>`
          SELECT state, count(*) AS n FROM engine_effect WHERE owner_kind = 'crew'
          GROUP BY state ORDER BY state
        `;
        const whileHeld = {
          crew: crew.map((row) => `${row.state}:${row.n}`),
          conversation: yield* rowState("mate/e/test.echo/1"),
        };
        yield* settled(Deferred.succeed(release, undefined));
        expect({ whileHeld, settled: yield* crewSettled }).toEqual({
          whileHeld: { crew: ["pending:1", "running:8"], conversation: "done" },
          settled: [...held].sort(),
        });
      }).pipe(
        Effect.scoped,
        Effect.provide(engineLayer(":memory:", handlersOf(holding(release), echo), [tallyDomain])),
      );
    }),
);

// witness: apps/server/src/engine/outbox/EffectWorker.ts | commandId: recoveredCommandId(boot, owner.conversationId), → commandId: recoveredCommandId("boot" as BootId, owner.conversationId),
it.effect(
  "EO+16: Each boot tells a crew once that it restarted, so it reconciles what it holds; breaks: a crew keeps work the restart cut",
  () =>
    Effect.gen(function* () {
      yield* askCrew("git-ana", "test.echo", "git/ana");
      yield* (yield* makeEffectWorker(newBoot())).reconcileAtBoot();
      const second = yield* makeEffectWorker(newBoot());
      yield* second.reconcileAtBoot();
      yield* second.reconcileAtBoot();
      const crew = yield* (yield* Conversations).owner(tallyDomain).state(tallyOwner);
      expect(crew.recoveries).toBe(2);
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf(), [tallyDomain]))),
);

/** Runs each row as it comes due, the clock moving straight to the next due row, until none is left. */
const runUntilIdle = Effect.gen(function* () {
  const outbox = yield* EffectOutbox;
  const worker = yield* makeEffectWorker(newBoot());
  for (let step = 0; step < 100; step++) {
    while (yield* worker.runOnce) {
      // everything due now
    }
    const next = yield* outbox.nextAvailableAt();
    if (Option.isNone(next)) return;
    yield* TestClock.adjust(Math.max(0, next.value - (yield* Clock.currentTimeMillis)));
  }
});

// witness: apps/server/src/engine/outbox/EffectWorker.ts | const policy = result.patient === true ? policies.owner : retryPolicyOf(row, policies); → const policy = retryPolicyOf(row, policies);
it.effect(
  "EO+17: A conversation's effect that waits on a crewmate's copy rides out the outage a crew effect rides out; breaks: a brief ssh outage fails the person's step",
  () => {
    // The copy cannot be read for its first six tries: more than a conversation's five.
    const copy: EffectHandler = {
      kind: "test.copy",
      run: (row) =>
        Effect.succeed<HandlerResult>(
          row.attempt < 7
            ? { _tag: "Retry", reason: "The crewmate's copy cannot be read now.", patient: true }
            : done(),
        ),
    };
    return Effect.gen(function* () {
      yield* enqueue(ConversationId.make("mate"), [
        { id: "mate/e/test.copy/1", kind: "test.copy", lane: "side" },
      ]);
      yield* runUntilIdle;
      expect(yield* rowState("mate/e/test.copy/1")).toBe("done");
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf(copy))));
  },
);

// witness: apps/server/src/engine/outbox/EffectOutbox.ts | delayMs: (attempt) => Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)), → delayMs: (attempt) => Math.min(60_000, 100 * 2 ** Math.max(0, attempt - 1)),
it.effect(
  "EO+18: A crew effect rides out a minute's outage that fails a conversation's ordinary effect for good; breaks: the crew gives up on a container restart, or a person waits minutes on a dead effect",
  () => {
    // ssh is refused for the first minute.
    const outage: EffectHandler = {
      kind: "test.outage",
      run: () =>
        Effect.map(Clock.currentTimeMillis, (now): HandlerResult =>
          now < 60_000 ? { _tag: "Retry", reason: "ssh: connection refused" } : done(),
        ),
    };
    return Effect.gen(function* () {
      const crewEffect = yield* askCrew("git-ana", "test.outage", "git/ana");
      yield* enqueue(ConversationId.make("mate"), [
        { id: "mate/e/test.outage/1", kind: "test.outage", lane: "side" },
      ]);
      yield* runUntilIdle;
      expect({
        crew: yield* rowState(crewEffect),
        conversation: yield* rowState("mate/e/test.outage/1"),
      }).toEqual({ crew: "done", conversation: "failed" });
    }).pipe(Effect.provide(engineLayer(":memory:", handlersOf(outage), [tallyDomain])));
  },
);
