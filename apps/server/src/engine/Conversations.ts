/**
 * Conversations: the actor registry, keyed by owner. An `RcMap` keyed by owner id makes an actor
 * on first use — with the domain of the owner kind that owns the id (a conversation's, or one the
 * wiring registered in `OwnerDomains`, such as the crew's) — and releases it after an idle
 * time-to-live; the next use rehydrates it from the store (snapshot plus tail fold). Every
 * producer holds the actor while its command is in flight, so an actor is only evicted with an
 * empty mailbox. Each owner has one actor, so one writer, whatever its kind.
 *
 * `ask`, `state` and `subscribe` are the conversation's, and refuse another kind's id; `tell` takes
 * the engine's own inputs (an effect settled, a wake fired, a restart) to any owner, whatever its
 * kind; `owner(domain)` gives a kind its typed door.
 *
 * @module engine/Conversations
 */
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RcMap from "effect/RcMap";
import * as Stream from "effect/Stream";
import type {
  CommandResult,
  ConversationId,
  EngineEvent,
  OwnerKind,
  Rejection,
} from "@t3tools/contracts";

import {
  CommandRejected,
  makeOwnerActor,
  type Accepted,
  type OwnerActor,
  type StepFailure,
} from "./ConversationActor.ts";
import type { Envelope } from "./domain/command.ts";
import { conversationDomain } from "./domain/conversationDomain.ts";
import type { ConversationState } from "./domain/state.ts";
import { EngineSignals } from "./EngineSignals.ts";
import {
  ENGINE_INPUTS,
  OwnerDomains,
  type AnyDomain,
  type Domain,
  type OwnerEnvelope,
  type OwnerEvent,
} from "./owners.ts";
import { EngineStore, EngineStoreError, type OwnerStore } from "./store/EngineStore.ts";

/** One owner kind's typed door into the registry. */
export interface OwnerHandle<S, C, E> {
  readonly ask: (
    envelope: OwnerEnvelope<C>,
  ) => Effect.Effect<Accepted, CommandRejected | StepFailure | EngineStoreError>;
  readonly tell: (
    envelope: OwnerEnvelope<C>,
  ) => Effect.Effect<CommandResult, StepFailure | EngineStoreError>;
  readonly state: (owner: ConversationId) => Effect.Effect<S, EngineStoreError>;
  /** The durable events after a cursor, then each new one as it commits. */
  readonly subscribe: (
    owner: ConversationId,
    afterSeq: number,
  ) => Stream.Stream<E, EngineStoreError>;
}

export interface ConversationsShape {
  /** People and the wire: the accepted result, or why it was refused. */
  readonly ask: (
    envelope: Envelope,
  ) => Effect.Effect<Accepted, CommandRejected | StepFailure | EngineStoreError>;
  /**
   * The pump, the worker, the scheduler and boot: returns once the step is committed. The engine's
   * own inputs reach any owner; another command, a conversation only.
   */
  readonly tell: (
    envelope: Envelope,
  ) => Effect.Effect<CommandResult, StepFailure | EngineStoreError>;
  /** The conversation's state as its actor holds it: what a view reads besides the record. */
  readonly state: (
    conversation: ConversationId,
  ) => Effect.Effect<ConversationState, EngineStoreError>;
  /** The durable events after a cursor, then each new one as it commits. */
  readonly subscribe: (
    conversation: ConversationId,
    afterSeq: number,
  ) => Stream.Stream<EngineEvent, EngineStoreError>;
  /** The kind that owns an id; none when no registered kind does. */
  readonly kindOf: (owner: ConversationId) => OwnerKind | undefined;
  /** A registered kind's typed door: its own commands, state and events. */
  readonly owner: <
    S extends { readonly headSeq: number },
    C extends { readonly _tag: string },
    E extends OwnerEvent,
    D,
  >(
    domain: Domain<S, C, E, D>,
  ) => OwnerHandle<S, C, E>;
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

type AnyActor = OwnerActor<any, any, any>;

export const makeConversations = Effect.fn("makeConversations")(function* (
  options: ConversationsOptions = {},
) {
  const store = yield* EngineStore;
  const signals = yield* EngineSignals;
  const registered = Option.getOrElse(yield* Effect.serviceOption(OwnerDomains), () => []);

  /** The kind that owns an id: a registered one first; the conversation takes the rest. */
  const domainOf = (owner: ConversationId): AnyDomain | undefined =>
    registered.find((domain) => domain.owns(owner)) ??
    (conversationDomain.owns(owner) ? (conversationDomain as AnyDomain) : undefined);

  // The conversation's record is the store's own `load` and `commit` (a test may wrap them).
  const conversationStore = {
    load: store.load,
    commit: store.commit,
    events: store.events,
  } as unknown as OwnerStore<any, any, any, any>;
  const storeOf = (domain: AnyDomain) =>
    domain === conversationDomain ? conversationStore : store.owner(domain);

  const actors = yield* RcMap.make({
    lookup: (owner: ConversationId) =>
      Effect.gen(function* () {
        const domain = domainOf(owner);
        if (domain === undefined) {
          return yield* new EngineStoreError({
            operation: "actor",
            cause: new Error(`no owner kind takes ${owner}`),
          });
        }
        return (yield* makeOwnerActor(
          domain,
          owner,
          storeOf(domain),
          signals,
          options.mailboxCapacity === undefined ? {} : { mailboxCapacity: options.mailboxCapacity },
        )) as AnyActor;
      }),
    idleTimeToLive: options.idleTimeToLive ?? DEFAULT_IDLE_TIME_TO_LIVE,
  });

  /** The owner's actor; a build that failed is forgotten, so the next use builds again. */
  const actor = (owner: ConversationId) =>
    RcMap.get(actors, owner).pipe(Effect.tapError(() => RcMap.invalidate(actors, owner)));

  const withActor = <A, E>(owner: ConversationId, use: (actor: AnyActor) => Effect.Effect<A, E>) =>
    Effect.scoped(Effect.flatMap(actor(owner), use));

  const backlog = Effect.fnUntraced(function* (
    events: (
      owner: ConversationId,
      afterSeq: number,
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<OwnerEvent>, EngineStoreError>,
    owner: ConversationId,
    afterSeq: number,
  ) {
    const read: Array<OwnerEvent> = [];
    for (;;) {
      const page = yield* events(owner, read.at(-1)?.seq ?? afterSeq, BACKLOG_PAGE);
      read.push(...page);
      if (page.length < BACKLOG_PAGE) return read;
    }
  });

  const subscribeWith = (domain: AnyDomain, owner: ConversationId, afterSeq: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const held = yield* actor(owner);
        // Subscribe before reading the backlog, so nothing committed in between is missed.
        const live = yield* held.subscribe;
        const past = yield* backlog(storeOf(domain).events, owner, afterSeq);
        const cursor = past.at(-1)?.seq ?? afterSeq;
        return Stream.concat(
          Stream.fromIterable(past),
          Stream.fromSubscription(live).pipe(
            Stream.filter((event: OwnerEvent) => event.seq > cursor),
          ),
        );
      }),
    );

  /** A door for one kind: an id another kind owns is refused, never handed to the wrong rules. */
  const handleFor = <S, C, E>(domain: AnyDomain): OwnerHandle<S, C, E> => {
    const mine = (owner: ConversationId) => domainOf(owner) === domain;
    const refusal = (owner: ConversationId): Rejection => ({
      reason: "not-a-conversation",
      detail: `${owner} is not a ${domain.kind}'s.`,
    });
    const wrongOwner = (owner: ConversationId) =>
      new EngineStoreError({
        operation: "owner",
        cause: new Error(`${owner} is not a ${domain.kind}'s`),
      });
    return {
      ask: (envelope) =>
        mine(envelope.conversationId)
          ? withActor(envelope.conversationId, (held) => held.ask(envelope))
          : Effect.fail(new CommandRejected({ rejection: refusal(envelope.conversationId) })),
      tell: (envelope) =>
        mine(envelope.conversationId)
          ? withActor(envelope.conversationId, (held) => held.tell(envelope))
          : Effect.succeed<CommandResult>({
              _tag: "Rejected",
              rejection: refusal(envelope.conversationId),
            }),
      state: (owner) =>
        mine(owner)
          ? withActor(owner, (held) => held.state as Effect.Effect<S>)
          : Effect.fail(wrongOwner(owner)),
      subscribe: (owner, afterSeq) =>
        mine(owner)
          ? (subscribeWith(domain, owner, afterSeq) as Stream.Stream<E, EngineStoreError>)
          : Stream.fail(wrongOwner(owner)),
    };
  };

  const conversations = handleFor<ConversationState, Envelope["command"], EngineEvent>(
    conversationDomain as AnyDomain,
  );

  const engineInputs = new Set<string>(ENGINE_INPUTS);

  return Conversations.of({
    ask: conversations.ask,
    tell: (envelope) =>
      engineInputs.has(envelope.command._tag) && domainOf(envelope.conversationId) !== undefined
        ? withActor(envelope.conversationId, (held) => held.tell(envelope))
        : conversations.tell(envelope),
    state: conversations.state,
    subscribe: conversations.subscribe,
    kindOf: (owner) => domainOf(owner)?.kind,
    owner: (domain) => handleFor(domain as AnyDomain),
  });
});

export const layer = (options: ConversationsOptions = {}) =>
  Layer.effect(Conversations, makeConversations(options));
