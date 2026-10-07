/**
 * SessionHost: one per conversation, the pump's side of its driver sessions.
 *
 * Its inbox takes the provider's events for the conversation's thread and the commands the
 * engine's handlers record, in the order they arrive; a handler records a send before it calls
 * the driver, so the bridge never mistakes the engine's turn for one the agent opened itself.
 * Each batch goes through the bridge's fold and `toCore`, then:
 *
 * 1. the boundaries go to the conversation's actor (one `ProviderSignals` per session and batch,
 *    its id derived from both, so a batch told twice converges); a session's boundaries are held
 *    until its open has committed, since the actor refuses a session it has not seen open;
 * 2. the evidence resolves the sends waiting on it — after the boundaries, so a turn's start or
 *    a session's exit is in the record before the send settles;
 * 3. streamed text goes to the live plane, never to the record.
 *
 * A session ProviderService re-created on its own (a call that met a dead session recovers it) is
 * a replacement nobody asked for: the engine's session is recorded as exited and the unasked one
 * is closed, so the next run opens its own.
 *
 * @module engine/pump/SessionHost
 */
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type { ConversationId, SpiEvent, ThreadId, TurnHandle } from "@t3tools/contracts";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type {
  BridgeDriver,
  EngineCommand,
  RequestKey,
  SendMode,
  SessionId,
} from "../bridge/spi3.ts";
import { type BridgeInput, makeTranslator, type NativeRequest } from "../bridge/translate.ts";
import type { ConversationsShape } from "../Conversations.ts";
import type { ProviderSignal } from "../domain/command.ts";
import { signalsCommandId } from "../domain/ids.ts";
import type { LiveBusShape } from "../LiveBus.ts";
import { makeToCore, type SendEvidence } from "./toCore.ts";

/** How an unasked session reads in the record. */
export const UNASKED_SESSION =
  "The session was re-created without the engine asking; the engine closed it.";

export interface SessionHost {
  readonly conversationId: ConversationId;
  /** The ProviderService thread the conversation's sessions run on. */
  readonly thread: ThreadId;
  readonly driver: BridgeDriver;
  /** The engine session this host feeds, or none. */
  readonly current: Effect.Effect<SessionId | null>;
  /** A session the engine is opening: its boundaries are held until `openGate`. */
  readonly begin: (session: SessionId) => Effect.Effect<void>;
  /** Records a command the engine sent, in order with the provider's events. */
  readonly record: (command: EngineCommand) => Effect.Effect<void>;
  /**
   * Records a send before its call and returns the wait for what became of it — taken, refused,
   * or its session closed first. The wait holds its own evidence: one that came before the
   * handler waits is never lost.
   */
  readonly beginSend: (
    turn: TurnHandle,
    mode: SendMode,
  ) => Effect.Effect<Effect.Effect<SendEvidence>>;
  /** The session's open has committed: its held boundaries go, and every later one. */
  readonly openGate: (session: SessionId) => Effect.Effect<void>;
  /** The session never opened: what it held is dropped. */
  readonly discard: (session: SessionId) => Effect.Effect<void>;
  readonly nativeTurn: (turn: TurnHandle) => Effect.Effect<string | undefined>;
  readonly nativeRequest: (key: RequestKey) => Effect.Effect<NativeRequest | undefined>;
  /** Background work alive in the current session. */
  readonly liveWork: Effect.Effect<number>;
  /** Runs a driver call that outlives the handler that made it (a send that holds its turn). */
  readonly forkInSession: <A, E>(call: Effect.Effect<A, E>) => Effect.Effect<Fiber.Fiber<A, E>>;
  /** Takes one provider event (the pump's demux). */
  readonly offer: (event: SpiEvent) => Effect.Effect<void>;
  /** Returns once everything offered or recorded so far has been folded and told. */
  readonly settled: Effect.Effect<void>;
}

export interface SessionHostDeps {
  readonly conversations: ConversationsShape;
  readonly live: LiveBusShape;
  readonly provider: ProviderServiceShape;
  readonly scope: Scope.Scope;
  /** True once the server is shutting down: the drivers' ends then are the restart's to read. */
  readonly stopping: () => boolean;
  /** Returns once the events published so far have reached their hosts. */
  readonly quiet: Effect.Effect<void>;
}

type Inbox =
  | { readonly _tag: "input"; readonly input: BridgeInput }
  | { readonly _tag: "mark"; readonly done: Deferred.Deferred<void> };

interface Gate {
  state: "held" | "open" | "dropped";
  readonly held: Array<ReadonlyArray<ProviderSignal>>;
  batches: number;
}

const ENGINE = { kind: "engine" } as const;

/** A batch the actor did not take is told again after `min(30 s, 100 ms · 2^(n − 1))`. */
export const batchRetryMs = (attempt: number): number =>
  Math.min(30_000, 100 * 2 ** Math.max(0, attempt - 1));

export const makeSessionHost = Effect.fnUntraced(function* (
  input: {
    readonly conversationId: ConversationId;
    readonly thread: ThreadId;
    readonly driver: BridgeDriver;
  },
  deps: SessionHostDeps,
) {
  const translator = makeTranslator({ driver: input.driver, threadId: input.thread });
  const toCore = makeToCore({ nativeTurn: translator.nativeTurn });
  const inbox = yield* Queue.unbounded<Inbox>();
  const lock = yield* Semaphore.make(1);
  const gates = new Map<SessionId, Gate>();
  /** Sends waiting on their evidence, with the session they went into. */
  const waiting = new Map<
    TurnHandle,
    { readonly session: SessionId | null; readonly done: Deferred.Deferred<SendEvidence> }
  >();
  let current: SessionId | null = null;
  let recording: SessionId | null = null;

  /**
   * Tells a batch until the actor takes it: a batch is content-idempotent, and one lost would
   * leave its run running forever (its turn's end). Backs off, never drops; stops only with the
   * server.
   */
  const tell = (session: SessionId, gate: Gate, signals: ReadonlyArray<ProviderSignal>) =>
    Effect.gen(function* () {
      if (deps.stopping()) return;
      gate.batches += 1;
      const envelope = {
        commandId: signalsCommandId(session, gate.batches),
        conversationId: input.conversationId,
        principal: ENGINE,
        command: { _tag: "ProviderSignals", sessionId: session, signals },
      } as const;
      for (let attempt = 1; ; attempt++) {
        const told = yield* Effect.exit(deps.conversations.tell(envelope));
        if (told._tag === "Success") {
          if (told.value._tag === "Rejected") {
            yield* Effect.logDebug("engine pump: a batch was refused", {
              session,
              reason: told.value.rejection.reason,
            });
          }
          return;
        }
        if (deps.stopping()) return;
        if (attempt === 1 || attempt % 10 === 0) {
          yield* Effect.logWarning("engine pump: a batch was not taken; it is told again", {
            session,
            attempt,
            cause: told.cause,
          });
        }
        yield* Effect.sleep(batchRetryMs(attempt));
      }
    });

  const resolve = (turn: TurnHandle, evidence: SendEvidence) => {
    const send = waiting.get(turn);
    if (send === undefined) return Effect.void;
    waiting.delete(turn);
    return Deferred.succeed(send.done, evidence);
  };

  const closeWaiting = (session: SessionId | null, words: string) =>
    Effect.forEach(
      [...waiting].filter(([, send]) => session === null || send.session === session),
      ([turn]) => resolve(turn, { _tag: "Closed", words }),
      { discard: true },
    );

  const process = Effect.fnUntraced(function* (inputs: ReadonlyArray<BridgeInput>) {
    const now = yield* Clock.currentTimeMillis;
    const batches = new Map<SessionId, Array<ProviderSignal>>();
    const evidence: Array<{ readonly turn: TurnHandle; readonly evidence: SendEvidence }> = [];
    const live: Array<Effect.Effect<unknown>> = [];
    const closed: Array<{ readonly session: SessionId; readonly words: string }> = [];
    let unasked = false;
    for (const next of inputs) {
      for (const signal of translator.step(next)) {
        const step = toCore.step(signal, now);
        if (step.signals.length > 0) {
          const batch = batches.get(signal.session) ?? [];
          batch.push(...step.signals);
          batches.set(signal.session, batch);
        }
        evidence.push(...step.evidence);
        for (const op of step.live) {
          live.push(
            op._tag === "Append"
              ? deps.live.append(input.conversationId, op.key, op.stream, op.offset, op.text)
              : op._tag === "Context"
                ? deps.live.context(input.conversationId, op.usage)
                : deps.live.settle(input.conversationId, op.key),
          );
        }
        if (step.session?._tag === "Closed") {
          closed.push({ session: signal.session, words: step.session.words });
        }
        if (step.session?._tag === "Opened" && step.session.implicit) unasked = true;
      }
    }
    // 1. the boundaries, each session's in order; one not yet opened holds them.
    for (const [session, signals] of batches) {
      const gate = gates.get(session);
      if (gate === undefined || gate.state === "dropped") continue;
      if (gate.state === "held") gate.held.push(signals);
      else yield* tell(session, gate, signals);
    }
    // 2. the evidence the sends wait on.
    for (const { turn, evidence: said } of evidence) yield* resolve(turn, said);
    for (const { session, words } of closed) {
      yield* closeWaiting(session, words);
      if (current === session) current = null;
    }
    // 3. the live plane.
    yield* Effect.all(live, { discard: true });
    if (unasked) yield* replaceUnasked;
  });

  /** ProviderService re-created the session on its own: the engine's is gone, the new one closed. */
  const replaceUnasked = Effect.gen(function* () {
    const session = current;
    current = null;
    yield* closeWaiting(null, UNASKED_SESSION);
    if (session !== null) {
      const gate = gates.get(session);
      if (gate?.state === "open") {
        yield* tell(session, gate, [{ kind: "session-exited", reason: UNASKED_SESSION }]);
      }
    }
    yield* Effect.logWarning("engine pump: the provider re-created a session on its own", {
      thread: input.thread,
    });
    yield* deps.provider.stopSession({ threadId: input.thread }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("engine pump: the unasked session would not close", { cause }),
      ),
      Effect.forkIn(deps.scope),
    );
  });

  yield* Queue.takeAll(inbox).pipe(
    Effect.flatMap((mail) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const inputs = mail.flatMap((item) => (item._tag === "input" ? [item.input] : []));
          if (inputs.length > 0) yield* process(inputs);
          for (const item of mail)
            if (item._tag === "mark") yield* Deferred.succeed(item.done, void 0);
        }),
      ),
    ),
    Effect.catchCause((cause) => Effect.logWarning("engine pump: a host step failed", { cause })),
    Effect.forever,
    Effect.forkIn(deps.scope),
  );

  const enqueue = (item: Inbox) => Effect.asVoid(Queue.offer(inbox, item));

  return {
    conversationId: input.conversationId,
    thread: input.thread,
    driver: input.driver,
    current: Effect.sync(() => current),
    begin: (session) =>
      Effect.sync(() => {
        gates.set(session, { state: "held", held: [], batches: 0 });
        current = session;
        recording = session;
      }),
    beginSend: (turn, mode) =>
      Effect.gen(function* () {
        // Armed now, before the call: its evidence can never come first.
        const done = yield* Deferred.make<SendEvidence>();
        waiting.set(turn, { session: recording, done });
        yield* enqueue({ _tag: "input", input: { kind: "send", turn, mode } });
        // The worker runs a handler uninterruptibly; this wait is not, so a stop never hangs on
        // a driver that says nothing.
        return Effect.interruptible(Deferred.await(done));
      }),
    record: (command) =>
      Effect.gen(function* () {
        // A call's result comes back faster than the events the driver emitted before it
        // returned (they travel the bus): it is placed after them, as the driver ordered them.
        if (command.kind === "sent" || command.kind === "send-failed") yield* deps.quiet;
        yield* enqueue({ _tag: "input", input: command });
      }),
    openGate: (session) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const gate = gates.get(session);
          if (gate === undefined || gate.state !== "held") return;
          gate.state = "open";
          for (const signals of gate.held.splice(0)) yield* tell(session, gate, signals);
        }),
      ),
    discard: (session) =>
      lock.withPermits(1)(
        Effect.sync(() => {
          const gate = gates.get(session);
          if (gate !== undefined) {
            gate.state = "dropped";
            gate.held.length = 0;
          }
          if (current === session) current = null;
        }),
      ),
    nativeTurn: (turn) => Effect.sync(() => translator.nativeTurn(turn)),
    nativeRequest: (key) => Effect.sync(() => translator.nativeRequest(key)),
    liveWork: Effect.sync(() => toCore.liveWork()),
    forkInSession: (call) => Effect.forkIn(call, deps.scope),
    offer: (event) => enqueue({ _tag: "input", input: { kind: "event", event } }),
    settled: Effect.gen(function* () {
      const done = yield* Deferred.make<void>();
      yield* enqueue({ _tag: "mark", done });
      yield* Deferred.await(done);
    }),
  } satisfies SessionHost;
});
