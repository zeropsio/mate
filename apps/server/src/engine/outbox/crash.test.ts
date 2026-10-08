// @effect-diagnostics globalConsoleInEffect:off - the crash table prints when asked.
/**
 * Crash injection: a conversation is played move by move in one process lifetime over a SQLite
 * file; the process "dies" at a chosen boundary — after a move, while a handler is mid-act, after
 * a handler's outcome but before its record, or inside a commit at each stage — and a new
 * lifetime boots on the same file, reconciles, fires what is due and drains the outbox. Then the
 * invariants are checked against the file and the world.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  CommandId,
  ConversationId,
  type BootId,
  type Principal,
  type RequestId,
  type SessionId,
  type TurnHandle,
} from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";
import type { Command, Envelope, ProviderSignal } from "../domain/command.ts";
import { signalsCommandId } from "../domain/ids.ts";
import { makeEffectWorker } from "./EffectWorker.ts";
import { EngineStore, EngineStoreError, type CommitStage } from "../store/EngineStore.ts";
import { World, audit, engineLayer, fireDue, newBoot, tempDb } from "../testing/world.ts";

const c = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };

type Move =
  | { readonly kind: "ask"; readonly command: Command; readonly id: string }
  | { readonly kind: "signals"; readonly signals: ReadonlyArray<ProviderSignal> }
  | { readonly kind: "work" };

const turnOf = (run: number) => `${c}/r/${run}` as TurnHandle;
const turnEnded = (run: number | TurnHandle): ProviderSignal => ({
  kind: "turn-ended",
  turn: typeof run === "number" ? turnOf(run) : run,
  outcome: { kind: "completed" },
  source: "agent",
});
const script: ReadonlyArray<Move> = [
  { kind: "ask", command: { _tag: "Send", text: "go" }, id: "send-1" },
  { kind: "work" }, // run.prepare
  { kind: "work" }, // session.open
  { kind: "work" }, // provider.send
  {
    kind: "signals",
    signals: [
      {
        kind: "item-opened",
        turn: turnOf(1),
        key: "n1",
        by: { kind: "mate" },
        body: { kind: "note", text: "on it", streaming: true, answer: false },
      },
    ],
  },
  {
    kind: "signals",
    signals: [
      {
        kind: "request-opened",
        key: "q1",
        ask: { kind: "approval", requestKind: "command", detail: "deploy" },
      },
    ],
  },
  {
    kind: "ask",
    command: {
      _tag: "Answer",
      requestId: `${c}/r/1/q/1` as RequestId,
      answer: "yes",
      summary: "yes",
    },
    id: "answer-1",
  },
  { kind: "work" }, // provider.respond
  { kind: "signals", signals: [turnEnded(1)] },
  // A setting only a new session runs with: the next run closes the session and reopens it.
  {
    kind: "ask",
    command: { _tag: "SetRuntimeMode", runtimeMode: "approval-required" },
    id: "mode-1",
  },
  { kind: "ask", command: { _tag: "Send", text: "again" }, id: "send-2" },
  { kind: "work" }, // workspace.finish of the first run
  { kind: "work" }, // run.prepare
  { kind: "work" }, // session.close (settings)
  { kind: "work" }, // session.open
  { kind: "work" }, // provider.send
  { kind: "signals", signals: [turnEnded(2)] },
  // The crew rotates the session between turns; the next run opens a fresh one, seeded.
  {
    kind: "ask",
    command: { _tag: "RotateSession", reason: "context", fresh: true, seed: "the state packet" },
    id: "rotate-1",
  },
  { kind: "work" }, // workspace.finish of the second run
  { kind: "ask", command: { _tag: "Send", text: "after the rotation" }, id: "send-3" },
  { kind: "work" }, // run.prepare
  { kind: "work" }, // session.close, the session the rotation replaces
  { kind: "work" }, // session.open, fresh
  { kind: "work" }, // provider.send
  { kind: "signals", signals: [turnEnded(3)] },
];

type Crash =
  | { readonly at: number; readonly how: "after" }
  | { readonly at: number; readonly how: "mid-effect" }
  | { readonly at: number; readonly how: "outcome-unrecorded" }
  | { readonly at: number; readonly how: "mid-commit"; readonly stage: CommitStage };

const STAGES: ReadonlyArray<CommitStage> = [
  "receipt",
  "events",
  "projections",
  "outbox",
  "settle",
  "snapshot",
];

const crashes: ReadonlyArray<Crash> = script.flatMap((move, at): ReadonlyArray<Crash> => [
  { at, how: "after" },
  ...(move.kind === "work"
    ? [{ at, how: "mid-effect" } as const, { at, how: "outcome-unrecorded" } as const]
    : []),
  ...STAGES.map((stage) => ({ at, how: "mid-commit", stage }) as const),
]);

const label = (crash: Crash) =>
  `${String(crash.at).padStart(2)} ${describeMove(script[crash.at]!)} — ${crash.how}${crash.how === "mid-commit" ? `@${crash.stage}` : ""}`;
const describeMove = (move: Move) =>
  move.kind === "ask"
    ? move.command._tag
    : move.kind === "signals"
      ? move.signals.map((s) => s.kind).join("+")
      : "worker";

interface Played {
  /** Person texts the engine accepted: each must reach the agent once. */
  readonly accepted: Array<string>;
  session: string | null;
  /** The runtime mode change was accepted. */
  modeSet: boolean;
}

/** Plays the script up to the crash in one lifetime; returns when the process "dies". */
const playUntilCrash = (file: string, world: World, crash: Crash, played: Played) => {
  let commits = 0;
  let armed = false;
  // A fault fires inside the commit the crash names, at its stage; the transaction rolls back.
  const fault = (stage: CommitStage) =>
    armed && crash.how === "mid-commit" && stage === crash.stage && commits++ === 0
      ? Effect.fail(new EngineStoreError({ operation: "commit", cause: new Error("process died") }))
      : Effect.void;
  return Effect.gen(function* () {
    const conversations = yield* Conversations;
    const boot = newBoot();
    const outcomeLost = crash.how === "outcome-unrecorded";
    const worker = yield* makeEffectWorker(boot).pipe(
      Effect.provideService(Conversations, {
        ...conversations,
        tell: (e: Envelope) =>
          outcomeLost && armed && e.command._tag === "EffectSettled"
            ? Effect.die("process died before the outcome was recorded")
            : conversations.tell(e),
      }),
    );
    let batch = 0;
    for (let i = 0; i <= crash.at; i++) {
      const move = script[i]!;
      armed = i === crash.at;
      if (armed && crash.how === "mid-effect") {
        // The handler acts, then the process dies before it returns.
        const acted = yield* Deferred.make<void>();
        const before = [...world.acts.values()].reduce((a, b) => a + b, 0);
        for (const kind of [
          "run.prepare",
          "session.open",
          "provider.send",
          "provider.respond",
          "provider.interrupt",
          "workspace.finish",
        ])
          world.hangAfterAct.add(kind);
        yield* Effect.forkDetach(worker.runOnce);
        for (let spin = 0; spin < 1000; spin++) {
          if ([...world.acts.values()].reduce((a, b) => a + b, 0) > before) break;
          yield* Effect.yieldNow;
        }
        yield* Deferred.succeed(acted, undefined);
        return;
      }
      const exit = yield* Effect.exit<unknown, unknown, never>(
        move.kind === "ask"
          ? conversations.ask({
              commandId: CommandId.make(move.id),
              conversationId: c,
              principal: ana,
              command: move.command,
            })
          : move.kind === "signals"
            ? conversations.tell({
                commandId: signalsCommandId((played.session ?? "none") as SessionId, ++batch),
                conversationId: c,
                principal: { kind: "engine" },
                command: {
                  _tag: "ProviderSignals",
                  sessionId: (played.session ?? "none") as SessionId,
                  signals: move.signals,
                },
              })
            : worker.runOnce,
      );
      if (move.kind === "ask" && move.command._tag === "Send" && Exit.isSuccess(exit))
        played.accepted.push(move.command.text);
      if (move.kind === "ask" && move.command._tag === "SetRuntimeMode" && Exit.isSuccess(exit))
        played.modeSet = true;
      if (move.kind === "work")
        played.session =
          [...world.sessions]
            .filter(([, s]) => s.alive)
            .map(([id]) => id)
            .at(-1) ?? played.session;
    }
  }).pipe(Effect.provide(engineLayer(file, world.handlers(), { fault })));
};

/** The next lifetime: boot, fire what is due, drain; the agent finishes whatever is running. */
const reboot = (file: string, world: World) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const boot: BootId = newBoot();
    const worker = yield* makeEffectWorker(boot);
    yield* worker.reconcileAtBoot();
    let batch = 1000;
    for (let round = 0; round < 30; round++) {
      const now = yield* Clock.currentTimeMillis;
      const fired = yield* fireDue(now);
      const worked = yield* worker.runOnce;
      if (fired > 0 || worked) continue;
      // Quiet: the agent ends the turn of whatever run is running on a live session.
      const state = (yield* audit(c)).state;
      const run = state.activeRunId === null ? undefined : state.runs[state.activeRunId];
      const live = state.session !== null && world.sessions.get(state.session.id)?.alive === true;
      if (run !== undefined && live && (run.state === "running" || run.state === "waiting")) {
        yield* conversations.tell({
          commandId: signalsCommandId(state.session!.id as SessionId, ++batch),
          conversationId: c,
          principal: { kind: "engine" },
          command: {
            _tag: "ProviderSignals",
            sessionId: state.session!.id as SessionId,
            signals: [turnEnded(run.turn ?? turnOf(run.ordinal))],
          },
        });
        continue;
      }
      break;
    }
    // A person writes again after the restart: it must reach the agent (review 1, at every boundary).
    const after = yield* Effect.exit(
      conversations.ask({
        commandId: CommandId.make("after-restart"),
        conversationId: c,
        principal: ana,
        command: { _tag: "Send", text: "after the restart" },
      }),
    );
    for (let i = 0; i < 6; i++) {
      yield* fireDue(yield* Clock.currentTimeMillis);
      yield* worker.runOnce;
    }
    return { ...(yield* audit(c)), afterAccepted: Exit.isSuccess(after) };
  }).pipe(Effect.provide(engineLayer(file, world.handlers())));

/** Every invariant the crash must not break, as sentences that failed. */
const check = (world: World, played: Played, result: Effect.Success<ReturnType<typeof reboot>>) => {
  const broken = [...result.problems];
  const { state } = result;
  const last = result.afterAccepted ? Object.values(state.runs).at(-1)?.id : undefined;
  for (const run of Object.values(state.runs)) {
    if (run.id === last) continue; // the message sent after the restart: its turn is still going
    if (run.state !== "ended" && run.state !== "queued")
      broken.push(`every run ends: ${run.id} left ${run.state}`);
  }
  for (const [effect, count] of world.acts) {
    if (count > 1) broken.push(`never re-sent after a restart: ${effect} acted ${count} times`);
  }
  const texts = result.afterAccepted ? [...played.accepted, "after the restart"] : played.accepted;
  for (const text of texts) {
    const got = world.received.filter((r) => r.text === text).length;
    if (got !== 1)
      broken.push(`a person's message reaches the agent once: "${text}" arrived ${got} times`);
  }
  const first = world.received.find((r) => r.text === "go");
  const second = world.received.find((r) => r.text === "again");
  if (played.modeSet && first !== undefined && second?.session === first.session)
    broken.push("a setting a new session runs with never reaches a message in the old session");
  const queuedMessages = result.events.filter(
    (e) => (e._tag === "ItemOpened" || e._tag === "ItemUpdated") && e.body.kind === "person",
  );
  const lastDelivery = new Map<string, string>();
  for (const e of queuedMessages) {
    if ((e._tag === "ItemOpened" || e._tag === "ItemUpdated") && e.body.kind === "person")
      lastDelivery.set(e.itemId, e.body.delivery.state);
  }
  for (const [item, delivery] of lastDelivery) {
    const run = state.runs[item.replace(/\/i\/1$/, "")];
    if (run?.state === "ended" && delivery === "queued")
      broken.push(`a message never reads queued once its run ended: ${item}`);
  }
  return broken;
};

describe("crash injection at every step boundary", () => {
  it.effect("a restart at any boundary keeps every invariant", () =>
    Effect.gen(function* () {
      const table: Array<string> = [];
      for (const crash of crashes) {
        const file = tempDb("crash");
        const world = new World();
        const played: Played = { accepted: [], session: null, modeSet: false };
        yield* playUntilCrash(file, world, crash, played);
        world.crash();
        const result = yield* reboot(file, world);
        const broken = check(world, played, result);
        if (broken.length > 0)
          table.push(`${label(crash)}\n    ${[...new Set(broken)].join("\n    ")}`);
      }
      if (process.env.ENGINE_PROOF_PRINT)
        console.log(
          `${table.length}/${crashes.length} crash points broke an invariant\n${table.join("\n")}`,
        );
      expect(table).toEqual([]);
    }),
  );
});

describe("crash injection: what holds", () => {
  it.effect(
    "a replay-safe effect cut mid-act is retried after the restart and adopts its evidence",
    () =>
      Effect.gen(function* () {
        const file = tempDb("replay");
        const world = new World();
        world.hangAfterAct.add("test.replay");
        yield* Effect.gen(function* () {
          const store = yield* EngineStore;
          const state = yield* store.load(c);
          const row = {
            effectId: "mate/e/test.replay/1" as never,
            kind: "test.replay",
            lane: "side" as const,
            class: "replay-safe" as const,
            runId: null,
            payload: {},
          };
          yield* store.commit({
            envelope: {
              commandId: CommandId.make("enqueue"),
              conversationId: c,
              principal: ana,
              command: { _tag: "Archive" },
            },
            decision: {
              _tag: "Accept",
              step: {
                events: [
                  { _tag: "EffectRequested", effectId: row.effectId, kind: row.kind, runId: null },
                ],
                effects: [row],
                details: [],
                result: { _tag: "Accepted", seq: 1 },
              },
            },
            state,
            now: 0,
          });
          const worker = yield* makeEffectWorker(newBoot());
          yield* Effect.forkDetach(worker.runOnce); // acts, then the process dies
          for (let i = 0; i < 100 && world.acts.size === 0; i++) yield* Effect.yieldNow;
        }).pipe(Effect.provide(engineLayer(file, world.handlers())));
        world.crash();
        const result = yield* Effect.gen(function* () {
          const worker = yield* makeEffectWorker(newBoot());
          const boot = yield* worker.reconcileAtBoot();
          yield* worker.runOnce;
          const { events, problems } = yield* audit(c);
          const outcome = events.find((e) => e._tag === "EffectOutcomeRecorded");
          return {
            boot,
            acts: world.acts.get("mate/e/test.replay/1"),
            outcome: outcome?._tag === "EffectOutcomeRecorded" ? outcome.outcome : null,
            problems,
          };
        }).pipe(Effect.provide(engineLayer(file, world.handlers())));
        expect(result).toEqual({
          boot: { requeued: 1, recovered: 0, deferred: [] },
          acts: 1,
          outcome: { kind: "ok", value: "adopted" },
          problems: [],
        });
      }),
  );

  it.effect("a wake whose fire the crash cut fires once after the restart", () =>
    Effect.gen(function* () {
      const file = tempDb("wake");
      const world = new World();
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        yield* conversations.ask({
          commandId: CommandId.make("arm"),
          conversationId: c,
          principal: ana,
          command: { _tag: "ArmWake", kind: "standup", key: "k", dueAt: 0, text: "stand up" },
        });
        // The scheduler's tell dies with the process before the fire commits.
        yield* Effect.exit(
          fireDue(0).pipe(
            Effect.provideService(Conversations, {
              ...conversations,
              tell: () => Effect.die("process died mid-fire"),
            }),
          ),
        );
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      world.crash();
      const result = yield* Effect.gen(function* () {
        const worker = yield* makeEffectWorker(newBoot());
        yield* worker.reconcileAtBoot();
        yield* fireDue(0);
        yield* fireDue(0);
        const { events, problems } = yield* audit(c);
        return {
          fires: events.filter((e) => e._tag === "WakeFired").length,
          runs: events.filter((e) => e._tag === "RunQueued").length,
          problems,
        };
      }).pipe(Effect.provide(engineLayer(file, world.handlers())));
      expect(result).toEqual({ fires: 1, runs: 1, problems: [] });
    }),
  );
});
