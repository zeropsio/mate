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
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type {
  ConversationId,
  SpiEvent,
  SpiToolCallImage,
  ThreadId,
  TurnHandle,
  TurnId,
} from "@t3tools/contracts";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type {
  BridgeDriver,
  EngineCommand,
  RequestKey,
  SendMode,
  SessionId,
} from "../bridge/spi3.ts";
import { DRIVER_CAPABILITIES } from "../bridge/capabilities.ts";
import { type BridgeInput, makeTranslator, type NativeRequest } from "../bridge/translate.ts";
import type { ConversationsShape } from "../Conversations.ts";
import type { ProviderSignal } from "../domain/command.ts";
import { signalsCommandId } from "../domain/ids.ts";
import type { LiveBusShape } from "../LiveBus.ts";
import { publishedPage, type CallPictures } from "./callPictures.ts";
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
  /**
   * A Stop for a turn: records it and gives the turn's native id to interrupt now; a turn the
   * driver has not named yet (its send is still on the way) is interrupted the moment it opens.
   */
  readonly interruptOrDefer: (turn: TurnHandle) => Effect.Effect<string | undefined>;
  readonly nativeRequest: (key: RequestKey) => Effect.Effect<NativeRequest | undefined>;
  /** Background work alive in the current session. */
  readonly liveWork: Effect.Effect<number>;
  /**
   * The server is stopping under the current session: its open text items go to the record cut,
   * with the words they streamed, before the drivers go down and the restart cuts the run.
   */
  readonly keepWords: Effect.Effect<void>;
  readonly updateBlockers?: Effect.Effect<ReadonlyArray<string>>;
  /** Runs a driver call that outlives the handler that made it (a send that holds its turn). */
  readonly forkInSession: <A, E>(call: Effect.Effect<A, E>) => Effect.Effect<Fiber.Fiber<A, E>>;
  /** Nothing of it is live: no session, no send waiting, no Stop waiting on a turn. */
  readonly idle: Effect.Effect<boolean>;
  /** Lets it go: its fold and its fiber end (the pump evicts an idle host). */
  readonly close: Effect.Effect<void>;
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
  /** Where a call's pictures are stored before its record names them; none drops them. */
  readonly pictures?: CallPictures;
  readonly changed?: Effect.Effect<void>;
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
  const toCore = makeToCore({
    nativeTurn: translator.nativeTurn,
    selfTurns: DRIVER_CAPABILITIES[input.driver].selfTurns,
  });
  /** When finished work stops waiting for its turn: the update's drain looks again then. */
  let reportDueCheck: number | null = null;
  const inbox = yield* Queue.unbounded<Inbox>();
  const lock = yield* Semaphore.make(1);
  const gates = new Map<SessionId, Gate>();
  /** Sends waiting on their evidence, with the session they went into. */
  const waiting = new Map<
    TurnHandle,
    { readonly session: SessionId | null; readonly done: Deferred.Deferred<SendEvidence> }
  >();
  /** Stops asked before the driver named their turn: sent the moment it does. */
  const deferredInterrupts = new Set<TurnHandle>();
  let current: SessionId | null = null;
  let recording: SessionId | null = null;
  let sessionCalls = 0;
  const changed = deps.changed ?? Effect.void;
  const forkInSession = <A, E>(call: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      sessionCalls++;
      return yield* call.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            sessionCalls--;
          }).pipe(Effect.andThen(changed)),
        ),
        Effect.forkIn(deps.scope),
      );
    });

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

  /**
   * A closing call as its record holds it: its result's pictures and a workspace picture it
   * looked at stored and named by reference, its own record (`data`) among its parts.
   */
  const withPictures = (
    signal: ProviderSignal,
    pictures: ReadonlyMap<string, ReadonlyArray<SpiToolCallImage>>,
  ): Effect.Effect<ProviderSignal> =>
    Effect.gen(function* () {
      if (signal.kind !== "item-closed" || signal.body.kind !== "call") return signal;
      let body = signal.body;
      if (signal.data !== undefined && !(body.parts ?? []).includes("data")) {
        body = { ...body, parts: [...(body.parts ?? []), "data"] };
      }
      const images = pictures.get(signal.key);
      if (images !== undefined && body.result !== undefined) {
        const stored =
          deps.pictures === undefined
            ? { images: [], dropped: true }
            : yield* deps.pictures.results(input.thread, signal.key, images);
        body = {
          ...body,
          result: {
            ...body.result,
            ...(stored.images.length === 0 ? {} : { images: stored.images }),
            ...(stored.dropped ? { imagesDropped: true } : {}),
          },
        };
      }
      // A page it published goes to the asset store too: the record holds it by reference, the
      // same live and after a reload, however long zcp keeps its own copy.
      const published =
        body.state === "done" && body.result !== undefined ? publishedPage(body.result) : null;
      if (published !== null && deps.pictures !== undefined) {
        const kept = yield* deps.pictures.page(input.thread, signal.key, published.file);
        if (kept !== null && body.result !== undefined) {
          const publishedAt = body.endedAt ?? (yield* Clock.currentTimeMillis);
          body = {
            ...body,
            result: {
              ...body.result,
              page: {
                asset: kept.asset,
                title: published.title,
                bytes: kept.bytes,
                ...(published.height === undefined ? {} : { height: published.height }),
                publishedAt,
              },
            },
          };
        }
      }
      const looked = body.shows?.imagePath;
      if (
        deps.pictures !== undefined &&
        typeof looked === "string" &&
        !looked.startsWith("mate-asset:")
      ) {
        const picture = yield* deps.pictures.looked(input.thread, signal.key, looked);
        if (picture !== null) body = { ...body, shows: { ...body.shows, ...picture } };
      }
      return body === signal.body ? signal : { ...signal, body };
    });

  const process = Effect.fnUntraced(function* (inputs: ReadonlyArray<BridgeInput>) {
    const now = yield* Clock.currentTimeMillis;
    const batches = new Map<SessionId, Array<ProviderSignal>>();
    const evidence: Array<{ readonly turn: TurnHandle; readonly evidence: SendEvidence }> = [];
    const live: Array<Effect.Effect<unknown>> = [];
    const closed: Array<{ readonly session: SessionId; readonly words: string }> = [];
    const pictures = new Map<string, ReadonlyArray<SpiToolCallImage>>();
    let unasked = false;
    for (const next of inputs) {
      // A call's own record (what it was asked, what it wrote) rides its close to the record.
      const data =
        next.kind === "event" && next.event.type === "item.completed"
          ? (next.event.payload as { readonly data?: unknown }).data
          : undefined;
      for (const signal of translator.step(next)) {
        const step = toCore.step(signal, now);
        if (step.signals.length > 0) {
          const batch = batches.get(signal.session) ?? [];
          batch.push(
            ...(data === undefined
              ? step.signals
              : step.signals.map((one) =>
                  one.kind === "item-closed" && one.body.kind === "call" ? { ...one, data } : one,
                )),
          );
          batches.set(signal.session, batch);
        }
        evidence.push(...step.evidence);
        for (const { key, images } of step.pictures) pictures.set(key, images);
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
    // A closing call's pictures are stored first: its record names them by reference.
    for (const [session, signals] of batches) {
      batches.set(
        session,
        yield* Effect.forEach(signals, (signal) => withPictures(signal, pictures)),
      );
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
      // Its boundaries are all told: nothing more of a closed session goes to the actor.
      gates.delete(session);
    }
    // 3. the live plane.
    yield* Effect.all(live, { discard: true });
    // A Stop that came before its turn had a name: the turn has one now, or never will.
    for (const { turn, evidence: said } of evidence) {
      if (said._tag !== "Accepted") deferredInterrupts.delete(turn);
    }
    if (closed.length > 0) deferredInterrupts.clear();
    for (const turn of deferredInterrupts) {
      const native = translator.nativeTurn(turn);
      if (native === undefined) continue;
      deferredInterrupts.delete(turn);
      yield* deps.provider.interruptTurn({ threadId: input.thread, turnId: native as TurnId }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("engine pump: a deferred Stop could not be sent", { cause }),
        ),
        forkInSession,
      );
    }
    if (unasked) yield* replaceUnasked;
    const due = toCore.reportDueUntil();
    if (due !== null && Number.isFinite(due) && due !== reportDueCheck) {
      reportDueCheck = due;
      yield* Effect.sleep(due - now).pipe(Effect.andThen(changed), Effect.forkIn(deps.scope));
    }
    yield* changed;
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
      forkInSession,
    );
  });

  const loop = yield* Queue.takeAll(inbox).pipe(
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
    interruptOrDefer: (turn) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          yield* enqueue({ _tag: "input", input: { kind: "interrupt", turn } });
          const native = translator.nativeTurn(turn);
          if (native === undefined) deferredInterrupts.add(turn);
          return native;
        }),
      ),
    nativeRequest: (key) => Effect.sync(() => translator.nativeRequest(key)),
    liveWork: Effect.sync(() => toCore.liveWork()),
    keepWords: lock.withPermits(1)(
      Effect.gen(function* () {
        const session = current;
        const gate = session === null ? undefined : gates.get(session);
        if (session === null || gate?.state !== "open") return;
        const closes = toCore.cutText(yield* Clock.currentTimeMillis);
        if (closes.length > 0) yield* tell(session, gate, closes);
      }),
    ),
    forkInSession,
    updateBlockers: lock.withPermits(1)(
      Effect.gen(function* () {
        const blockers: string[] = [];
        if (waiting.size > 0) blockers.push("pending provider callback");
        if (deferredInterrupts.size > 0) blockers.push("pending interrupt");
        if (sessionCalls > 0) blockers.push("live provider call");
        if (toCore.liveWork() > 0) blockers.push("live background work");
        const due = toCore.reportDueUntil();
        if (due !== null && (yield* Clock.currentTimeMillis) < due)
          blockers.push("finished background work its agent has not taken up");
        if ([...gates.values()].some((gate) => gate.state === "held"))
          blockers.push("session opening");
        if ((yield* Queue.size(inbox)) > 0) blockers.push("pending provider events");
        return blockers;
      }),
    ),
    idle: lock.withPermits(1)(
      Effect.sync(
        () =>
          current === null &&
          waiting.size === 0 &&
          deferredInterrupts.size === 0 &&
          sessionCalls === 0 &&
          [...gates.values()].every((gate) => gate.state === "dropped"),
      ),
    ),
    close: Effect.asVoid(Fiber.interrupt(loop)),
    offer: (event) => enqueue({ _tag: "input", input: { kind: "event", event } }),
    settled: Effect.gen(function* () {
      const done = yield* Deferred.make<void>();
      yield* enqueue({ _tag: "mark", done });
      yield* Deferred.await(done);
    }),
  } satisfies SessionHost;
});
