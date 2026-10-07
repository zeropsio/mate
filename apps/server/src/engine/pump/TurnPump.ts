/**
 * TurnPump: the provider's events into the engine.
 *
 * It subscribes to the SPI bus when its layer is built — before any session can open, and the
 * bus replays nothing — into its own unbounded queue, and `start` drains it: one fiber routes each
 * event by its thread to the conversation's host, never blocking. An event for a thread no host
 * owns (a Codex helper's thread, a leftover) is dropped and counted.
 *
 * Every conversation runs its sessions on one ProviderService thread of its own,
 * `<conversation>/s/<n>`: never V1's thread, so ProviderService never adopts V1's binding or resume
 * cursor, while a later session of the same conversation resumes from the binding's latest cursor.
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
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ThreadId, type ConversationId, type SpiEvent } from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRuntimeEventBus } from "../../spi/ProviderRuntimeEventBus.ts";
import type { BridgeDriver } from "../bridge/spi3.ts";
import { Conversations } from "../Conversations.ts";
import { LiveBus } from "../LiveBus.ts";
import { makeSessionHost, type SessionHost } from "./SessionHost.ts";

/** The engine's generation of a conversation's provider thread; a fresh native session bumps it. */
export const THREAD_GENERATION = 1;

/** How long `quiet` lets the bus run: at least a few turns of the scheduler, at most many. */
const QUIET_MIN_ROUNDS = 8;
const QUIET_ROUNDS = 256;

export const providerThreadOf = (conversation: ConversationId): ThreadId =>
  ThreadId.make(`${conversation}/s/${THREAD_GENERATION}`);

export interface TurnPumpShape {
  /** The conversation's host, made on first use; its driver is the session's that made it. */
  readonly hostFor: (
    conversation: ConversationId,
    driver: BridgeDriver,
  ) => Effect.Effect<SessionHost>;
  /** The host, if one was made. */
  readonly existing: (conversation: ConversationId) => Effect.Effect<SessionHost | undefined>;
  /** Drains the subscription made at build: from now on events reach their hosts. */
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  /** Events for threads no host owns, counted per thread. */
  readonly foreign: Effect.Effect<ReadonlyMap<string, number>>;
}

export class TurnPump extends Context.Service<TurnPump, TurnPumpShape>()(
  "t3/engine/pump/TurnPump",
) {}

export const makeTurnPump = Effect.gen(function* () {
  const bus = yield* ProviderRuntimeEventBus;
  const provider = yield* ProviderService;
  const conversations = yield* Conversations;
  const live = yield* LiveBus;
  const scope = yield* Effect.scope;
  const queue = yield* Queue.unbounded<SpiEvent>();
  // Subscribed now: the fork runs at once up to its first wait, which is after the subscription.
  yield* Stream.runForEach(bus.events, (event) => Queue.offer(queue, event)).pipe(
    Effect.forkScoped({ startImmediately: true }),
  );
  let stopping = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopping = true;
    }),
  );
  const hosts = new Map<ConversationId, SessionHost>();
  const byThread = new Map<string, SessionHost>();
  const foreign = new Map<string, number>();

  const hostFor: TurnPumpShape["hostFor"] = (conversation, driver) =>
    Effect.gen(function* () {
      const known = hosts.get(conversation);
      if (known !== undefined && known.driver === driver) return known;
      const host = yield* makeSessionHost(
        { conversationId: conversation, thread: providerThreadOf(conversation), driver },
        { conversations, live, provider, scope, stopping: () => stopping, quiet },
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

  return TurnPump.of({
    hostFor,
    existing: (conversation) => Effect.sync(() => hosts.get(conversation)),
    start: Effect.asVoid(
      Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(queue), route))),
    ),
    foreign: Effect.sync(() => new Map(foreign)),
  });
});

export const layer = Layer.effect(TurnPump, makeTurnPump);
