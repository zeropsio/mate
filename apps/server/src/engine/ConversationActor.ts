/**
 * One fiber per conversation and one writer. Its loop takes the next envelope from a bounded
 * mailbox (producers wait when it is full; nothing is dropped), decides, commits the step in one
 * transaction, adopts the state the commit folded, publishes the committed events in commit order,
 * rings the worker and the scheduler when the step queued effects or touched wakes, and completes
 * the producer's reply. A failed commit reloads the state from the store, so the actor never runs
 * ahead of the record.
 *
 * @module engine/ConversationActor
 */
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  Rejection,
  type CommandResult,
  type ConversationId,
  type KnownEngineEvent,
} from "@t3tools/contracts";

import type { Envelope } from "./domain/command.ts";
import { decide } from "./domain/decide.ts";
import type { ConversationState } from "./domain/state.ts";
import type { EngineSignalsShape } from "./EngineSignals.ts";
import type { EngineStoreError, EngineStoreShape } from "./store/EngineStore.ts";

/** The conversation refused the command; the reason is the engine's rule, not a failure. */
export class CommandRejected extends Schema.TaggedError<CommandRejected>()("CommandRejected", {
  rejection: Rejection,
}) {
  override get message(): string {
    return `command rejected: ${this.rejection.reason}`;
  }
}

/** `decide` threw: a bug, reported to the producer instead of killing the conversation's fiber. */
export class EngineDecideFailed extends Schema.TaggedError<EngineDecideFailed>()(
  "EngineDecideFailed",
  { cause: Schema.Defect() },
) {}

export type Accepted = Extract<CommandResult, { _tag: "Accepted" }>;
export type StepFailure = EngineStoreError | EngineDecideFailed;

interface Mail {
  readonly envelope: Envelope;
  readonly reply: Deferred.Deferred<CommandResult, StepFailure>;
}

export interface ConversationActor {
  readonly conversationId: ConversationId;
  /** A person's command: the accepted result, or the rejection as an error. */
  readonly ask: (envelope: Envelope) => Effect.Effect<Accepted, CommandRejected | StepFailure>;
  /** An engine fiber's input: returns once committed; a rejection is not its failure. */
  readonly tell: (envelope: Envelope) => Effect.Effect<CommandResult, StepFailure>;
  /** Committed events, in commit order. */
  readonly subscribe: Effect.Effect<PubSub.Subscription<KnownEngineEvent>, never, Scope.Scope>;
  readonly state: Effect.Effect<ConversationState>;
  readonly mailboxSize: Effect.Effect<number>;
}

export interface ConversationActorOptions {
  readonly mailboxCapacity?: number;
}

export const DEFAULT_MAILBOX_CAPACITY = 256;

export const makeConversationActor = Effect.fn("makeConversationActor")(function* (
  conversationId: ConversationId,
  store: EngineStoreShape,
  signals: EngineSignalsShape,
  options: ConversationActorOptions = {},
) {
  const initial = yield* store.load(conversationId);
  const state = yield* Ref.make(initial);
  const mailbox = yield* Queue.bounded<Mail>(options.mailboxCapacity ?? DEFAULT_MAILBOX_CAPACITY);
  const published = yield* PubSub.unbounded<KnownEngineEvent>();

  const step = Effect.fnUntraced(function* (mail: Mail) {
    const before = yield* Ref.get(state);
    const now = yield* Clock.currentTimeMillis;
    const decision = yield* Effect.try({
      try: () => decide(before, mail.envelope, now),
      catch: (cause) => new EngineDecideFailed({ cause }),
    });
    const committed = yield* store
      .commit({ envelope: mail.envelope, decision, state: before, now })
      .pipe(
        Effect.tapError(() =>
          store.load(conversationId).pipe(
            Effect.flatMap((reloaded) => Ref.set(state, reloaded)),
            Effect.ignore,
          ),
        ),
      );
    yield* Ref.set(state, committed.state);
    if (committed.events.length > 0) yield* PubSub.publishAll(published, committed.events);
    if (committed.enqueued) yield* signals.effects.ring;
    if (committed.wakesChanged) yield* signals.wakes.ring;
    return committed.result;
  });

  yield* Queue.take(mailbox).pipe(
    Effect.flatMap((mail) =>
      Effect.uninterruptible(
        step(mail).pipe(
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(mail.reply, exit)),
        ),
      ),
    ),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => Queue.shutdown(mailbox));

  const submit = (envelope: Envelope) =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<CommandResult, StepFailure>();
      yield* Queue.offer(mailbox, { envelope, reply });
      return yield* Deferred.await(reply);
    });

  return {
    conversationId,
    ask: (envelope) =>
      submit(envelope).pipe(
        Effect.flatMap((result) =>
          result._tag === "Accepted"
            ? Effect.succeed(result)
            : Effect.fail(new CommandRejected({ rejection: result.rejection })),
        ),
      ),
    tell: submit,
    subscribe: PubSub.subscribe(published),
    state: Ref.get(state),
    mailboxSize: Queue.size(mailbox),
  } satisfies ConversationActor;
});
