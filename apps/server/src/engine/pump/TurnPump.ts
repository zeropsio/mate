import {
  subscribeUpdateChanges,
  mergeUpdateSubscriptions,
  type SubscribeUpdateChanges,
} from "../../update/subscribeChanges.ts";
/**
 * TurnPump: the provider's events into the engine.
 *
 * It subscribes to the SPI bus when its layer is built — before any session can open, and the
 * bus replays nothing — into its own unbounded queue, and `start` drains it: one fiber routes each
 * event by its thread to the conversation's host, never blocking. An event for a thread no host
 * owns (a Codex helper's thread, a leftover) is dropped and counted.
 *
 * Every conversation runs its sessions on a ProviderService thread of its own,
 * `<conversation>/s/<generation>`: never V1's thread, so ProviderService never adopts V1's binding
 * or resume cursor, while a later session of the same generation resumes from the binding's
 * latest cursor. A move to another instance or driver bumps the generation: a fresh native
 * session, which ProviderService would otherwise refuse to resume across instances.
 *
 * At shutdown the pump stops first (the engine is released before ProviderService), so the turn
 * ends ProviderService reports while it stops every session are not read as stops or crashes:
 * the next boot cuts those runs as a restart's.
 *
 * @module engine/pump/TurnPump
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ConversationId, ThreadId, type SpiEvent } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRuntimeEventBus } from "../../spi/ProviderRuntimeEventBus.ts";
import type { BridgeDriver } from "../bridge/spi3.ts";
import { Conversations } from "../Conversations.ts";
import { LiveBus } from "../LiveBus.ts";
import { makeCallPictures } from "./callPictures.ts";
import { makeSessionHost, type SessionHost } from "./SessionHost.ts";

/** How often the pump looks for hosts to let go. */
export const HOST_SWEEP_MS = 5 * 60_000;

/** How long `quiet` lets the bus run: at least a few turns of the scheduler, at most many. */
const QUIET_MIN_ROUNDS = 8;
const QUIET_ROUNDS = 256;

/**
 * A conversation's provider thread for its generation (the conversation's state holds it, and
 * bumps it when a move to another instance or driver means a fresh native session).
 */
export const providerThreadOf = (conversation: ConversationId, generation = 1): ThreadId =>
  ThreadId.make(`${conversation}/s/${generation}`);

/** The conversation a provider thread of the engine's belongs to; none for any other thread. */
export const conversationOfThread = (thread: string): ConversationId | undefined => {
  const match = /^(.+)\/s\/\d+$/u.exec(thread);
  return match === null ? undefined : ConversationId.make(match[1]!);
};

export interface TurnPumpShape {
  /**
   * The conversation's host for this driver and thread generation, made on first use; a new
   * driver or generation gets a new host on its own thread.
   */
  readonly hostFor: (
    conversation: ConversationId,
    driver: BridgeDriver,
    generation: number,
  ) => Effect.Effect<SessionHost>;
  /** The host, if one was made. */
  readonly existing: (conversation: ConversationId) => Effect.Effect<SessionHost | undefined>;
  /** Drains the subscription made at build: from now on events reach their hosts. */
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  /** Events for threads no host owns, counted per thread. */
  readonly foreign: Effect.Effect<ReadonlyMap<string, number>>;
  readonly updatePosition?: Effect.Effect<number>;
  readonly updateHosts?: Effect.Effect<ReadonlyArray<SessionHost>>;
  readonly updateBlockers?: Effect.Effect<ReadonlyArray<string>>;
  readonly updateChanges?: Stream.Stream<void>;
  readonly subscribeUpdateChanges?: SubscribeUpdateChanges;
}

export class TurnPump extends Context.Service<TurnPump, TurnPumpShape>()(
  "t3/engine/pump/TurnPump",
) {}

/** How long a stopping server waits for the record to take the words its hosts held. */
const KEEP_WORDS_BOUND_MS = 5_000;

export const makeTurnPump = Effect.gen(function* () {
  const bus = yield* ProviderRuntimeEventBus;
  const provider = yield* ProviderService;
  const conversations = yield* Conversations;
  const live = yield* LiveBus;
  const scope = yield* Effect.scope;
  const config = yield* Effect.serviceOption(ServerConfig);
  // A call's pictures go to the Mate's asset store; a looked-at file resolves in its session's
  // directory.
  const pictures = Option.isSome(config)
    ? makeCallPictures(config.value.stateDir, (thread) =>
        provider
          .listSessions()
          .pipe(
            Effect.map((sessions) => sessions.find((session) => session.threadId === thread)?.cwd),
          ),
      )
    : undefined;
  const queue = yield* Queue.unbounded<{
    readonly sequence: number | null;
    readonly event: SpiEvent;
  }>();
  let processedEvents = 0;
  const updateChanges = yield* PubSub.sliding<void>(1);
  const changed = Effect.asVoid(PubSub.publish(updateChanges, void 0));
  const incoming: Stream.Stream<{ readonly sequence: number | null; readonly event: SpiEvent }> =
    bus.eventBarrier?.events ?? bus.events.pipe(Stream.map((event) => ({ sequence: null, event })));
  if (bus.eventBarrier !== undefined)
    processedEvents = (yield* bus.eventBarrier.position).published;
  // Subscribed now: the fork runs at once up to its first wait, which is after the subscription.
  yield* Stream.runForEach(incoming, (event) => Queue.offer(queue, event)).pipe(
    Effect.forkScoped({ startImmediately: true }),
  );
  let stopping = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopping = true;
    }),
  );
  const hosts = new Map<ConversationId, SessionHost>();
  // Runs first as the server stops (finalizers run last-added first), while the record still
  // takes what the hosts tell: the words open items streamed, which nothing else holds.
  yield* Effect.addFinalizer(() =>
    Effect.forEach(hosts.values(), (host) => host.keepWords, { discard: true }).pipe(
      // A record that takes nothing never holds the server's stop.
      Effect.timeoutOption(KEEP_WORDS_BOUND_MS),
      Effect.catchCause((cause) =>
        Effect.logWarning("engine pump: streamed words could not be kept", { cause }),
      ),
    ),
  );
  const byThread = new Map<string, SessionHost>();
  const foreign = new Map<string, number>();

  const hostFor: TurnPumpShape["hostFor"] = (conversation, driver, generation) =>
    Effect.gen(function* () {
      const thread = providerThreadOf(conversation, generation);
      const known = hosts.get(conversation);
      if (known !== undefined && known.driver === driver && known.thread === thread) return known;
      if (known !== undefined) byThread.delete(known.thread);
      const host = yield* makeSessionHost(
        { conversationId: conversation, thread, driver },
        {
          conversations,
          live,
          provider,
          scope,
          stopping: () => stopping,
          quiet,
          changed,
          ...(pictures === undefined ? {} : { pictures }),
        },
      );
      hosts.set(conversation, host);
      byThread.set(host.thread, host);
      return host;
    });

  /**
   * The bus and the demux have taken everything published so far: they run on their own fibers,
   * so this lets them run until the pump's queue stays empty.
   */
  const quiet = Effect.gen(function* () {
    for (let round = 0; round < QUIET_ROUNDS; round++) {
      yield* Effect.yieldNow;
      if ((yield* Queue.size(queue)) === 0 && round >= QUIET_MIN_ROUNDS) return;
    }
  });

  const route = (event: SpiEvent) =>
    Effect.suspend(() => {
      if (stopping) return Effect.void;
      const host = byThread.get(String(event.threadId));
      if (host !== undefined) return host.offer(event);
      const thread = String(event.threadId);
      foreign.set(thread, (foreign.get(thread) ?? 0) + 1);
      return Effect.void;
    });

  /**
   * Lets go of a host idle at two sweeps in a row (its session closed, nothing waiting): a
   * conversation's next open makes a new one, so hosts never pile up with conversations.
   */
  const idleBefore = new Set<SessionHost>();
  const sweep = Effect.gen(function* () {
    for (const [conversation, host] of hosts) {
      if (!(yield* host.idle)) {
        idleBefore.delete(host);
        continue;
      }
      if (!idleBefore.has(host)) {
        idleBefore.add(host);
        continue;
      }
      idleBefore.delete(host);
      hosts.delete(conversation);
      if (byThread.get(host.thread) === host) byThread.delete(host.thread);
      yield* host.close;
    }
  });

  return TurnPump.of({
    hostFor,
    updatePosition: Effect.sync(() => processedEvents),
    updateHosts: Effect.sync(() => [...hosts.values()]),
    subscribeUpdateChanges: mergeUpdateSubscriptions([
      subscribeUpdateChanges(updateChanges),
      ...(bus.eventBarrier?.subscribeChanges === undefined
        ? []
        : [bus.eventBarrier.subscribeChanges]),
    ]),
    updateChanges: Stream.merge(
      Stream.fromPubSub(updateChanges),
      bus.eventBarrier?.changes ?? Stream.empty,
    ),
    updateBlockers: Effect.gen(function* () {
      const blockers: string[] = [];
      if ((yield* Queue.size(queue)) > 0) blockers.push("provider event queue");
      if (bus.eventBarrier === undefined || bus.eventBarrier.subscribeChanges === undefined)
        blockers.push("provider event receipt boundary unavailable");
      else {
        const position = yield* bus.eventBarrier.position;
        if (position.processing > 0 || position.published !== processedEvents)
          blockers.push("pending provider publication");
      }
      for (const host of hosts.values()) {
        yield* host.settled;
        const found = yield* host.updateBlockers ?? Effect.succeed(["provider host unknown"]);
        blockers.push(...found.map((reason) => `${host.conversationId}: ${reason}`));
      }
      return blockers;
    }),
    existing: (conversation) => Effect.sync(() => hosts.get(conversation)),
    start: Effect.gen(function* () {
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(queue), ({ sequence, event }) =>
            route(event).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  if (sequence !== null) processedEvents = sequence;
                }),
              ),
              Effect.andThen(changed),
            ),
          ),
        ),
      );
      yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(HOST_SWEEP_MS), sweep)));
    }),
    foreign: Effect.sync(() => new Map(foreign)),
  });
});

export const layer = Layer.effect(TurnPump, makeTurnPump);
