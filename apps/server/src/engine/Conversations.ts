/**
 * Conversations: the actor registry. An `RcMap` keyed by conversation makes an actor on first use
 * and releases it after an idle time-to-live; the next use rehydrates it from the store (snapshot
 * plus tail fold). Every producer holds the actor while its command is in flight, so an actor is
 * only evicted with an empty mailbox.
 *
 * @module engine/Conversations
 */
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RcMap from "effect/RcMap";
import * as Stream from "effect/Stream";
import type {
  CommandResult,
  ConversationId,
  EngineEvent,
  KnownEngineEvent,
} from "@t3tools/contracts";

import {
  makeConversationActor,
  type Accepted,
  type CommandRejected,
  type ConversationActor,
  type StepFailure,
} from "./ConversationActor.ts";
import type { Envelope } from "./domain/command.ts";
import { EngineSignals } from "./EngineSignals.ts";
import { EngineStore, type EngineStoreError } from "./store/EngineStore.ts";

export interface ConversationsShape {
  /** People and the wire: the accepted result, or why it was refused. */
  readonly ask: (
    envelope: Envelope,
  ) => Effect.Effect<Accepted, CommandRejected | StepFailure | EngineStoreError>;
  /** The pump, the worker, the scheduler and boot: returns once the step is committed. */
  readonly tell: (
    envelope: Envelope,
  ) => Effect.Effect<CommandResult, StepFailure | EngineStoreError>;
  /** The durable events after a cursor, then each new one as it commits. */
  readonly subscribe: (
    conversation: ConversationId,
    afterSeq: number,
  ) => Stream.Stream<EngineEvent, EngineStoreError>;
}

export class Conversations extends Context.Service<Conversations, ConversationsShape>()(
  "t3/engine/Conversations",
) {}

export interface ConversationsOptions {
  readonly idleTimeToLive?: Duration.Input;
  readonly mailboxCapacity?: number;
}

export const DEFAULT_IDLE_TIME_TO_LIVE = "5 minutes";
const BACKLOG_PAGE = 1000;

export const makeConversations = Effect.fn("makeConversations")(function* (
  options: ConversationsOptions = {},
) {
  const store = yield* EngineStore;
  const signals = yield* EngineSignals;
  const actors = yield* RcMap.make({
    lookup: (conversation: ConversationId) =>
      makeConversationActor(
        conversation,
        store,
        signals,
        options.mailboxCapacity === undefined ? {} : { mailboxCapacity: options.mailboxCapacity },
      ),
    idleTimeToLive: options.idleTimeToLive ?? DEFAULT_IDLE_TIME_TO_LIVE,
  });

  const withActor = <A, E>(
    conversation: ConversationId,
    use: (actor: ConversationActor) => Effect.Effect<A, E>,
  ) => Effect.scoped(Effect.flatMap(RcMap.get(actors, conversation), use));

  const backlog = Effect.fnUntraced(function* (conversation: ConversationId, afterSeq: number) {
    const events: Array<EngineEvent> = [];
    for (;;) {
      const page = yield* store.events(conversation, events.at(-1)?.seq ?? afterSeq, BACKLOG_PAGE);
      events.push(...page);
      if (page.length < BACKLOG_PAGE) return events;
    }
  });

  return Conversations.of({
    ask: (envelope) => withActor(envelope.conversationId, (actor) => actor.ask(envelope)),
    tell: (envelope) => withActor(envelope.conversationId, (actor) => actor.tell(envelope)),
    subscribe: (conversation, afterSeq) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const actor = yield* RcMap.get(actors, conversation);
          // Subscribe before reading the backlog, so nothing committed in between is missed.
          const live = yield* actor.subscribe;
          const past = yield* backlog(conversation, afterSeq);
          const cursor = past.at(-1)?.seq ?? afterSeq;
          return Stream.concat(
            Stream.fromIterable(past),
            Stream.fromSubscription(live).pipe(
              Stream.filter((event: KnownEngineEvent) => event.seq > cursor),
            ),
          );
        }),
      ),
  });
});

export const layer = (options: ConversationsOptions = {}) =>
  Layer.effect(Conversations, makeConversations(options));
