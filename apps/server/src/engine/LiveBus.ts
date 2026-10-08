/**
 * LiveBus: the live plane. Streamed text and context usage go to the conversation's subscribers
 * as they come and are never stored; an item's whole text reaches the record at its close.
 *
 * Per conversation it holds the open items' text so far (keyed by the bridge's item key, which
 * the record's `ItemOpened.key` carries, so a client joins a delta to its item — a delta may come
 * before its item commits) and a sliding channel of frames. A subscriber first gets `Open`, the
 * text so far, taken under the same lock appends publish under, so nothing falls between. One
 * that falls behind loses frames; its stream says `Gap` and ends, and it subscribes again.
 *
 * Outside the actors: an actor is evicted after idle minutes, the live plane is not.
 *
 * @module engine/LiveBus
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { ConversationId, ThreadTokenUsageSnapshot } from "@t3tools/contracts";

import type { AppendStream } from "./bridge/spi3.ts";

export type LiveFrame =
  | {
      readonly _tag: "Open";
      readonly items: ReadonlyArray<{
        readonly key: string;
        readonly stream: AppendStream;
        readonly text: string;
      }>;
      /** The latest progress of each call that reports one (the stand-up's), by its item. */
      readonly progress?: ReadonlyArray<{ readonly key: string; readonly value: unknown }>;
      readonly liveSeq: number;
    }
  | {
      readonly _tag: "Append";
      readonly key: string;
      readonly stream: AppendStream;
      readonly offset: number;
      readonly text: string;
      readonly liveSeq: number;
    }
  | { readonly _tag: "Context"; readonly usage: ThreadTokenUsageSnapshot; readonly liveSeq: number }
  /** A call's progress, by the record's item id (`null`: it has none to show any more). */
  | {
      readonly _tag: "Progress";
      readonly key: string;
      readonly value: unknown;
      readonly liveSeq: number;
    }
  /** Frames were dropped for this subscriber: subscribe again for the text so far. */
  | { readonly _tag: "Gap" };

export interface LiveBusShape {
  readonly append: (
    conversation: ConversationId,
    key: string,
    stream: AppendStream,
    offset: number,
    text: string,
  ) => Effect.Effect<void>;
  readonly context: (
    conversation: ConversationId,
    usage: ThreadTokenUsageSnapshot,
  ) => Effect.Effect<void>;
  /**
   * A call's progress, keyed by its item in the record: live, never stored; the latest is held
   * for a late subscriber until it is cleared (`null`).
   */
  readonly progress: (
    conversation: ConversationId,
    itemId: string,
    value: unknown,
  ) => Effect.Effect<void>;
  /** The item closed: its text is in the record now. Returns what the live plane held. */
  readonly settle: (conversation: ConversationId, key: string) => Effect.Effect<string | undefined>;
  readonly subscribe: (
    conversation: ConversationId,
  ) => Effect.Effect<Stream.Stream<LiveFrame>, never, Scope.Scope>;
}

export class LiveBus extends Context.Service<LiveBus, LiveBusShape>()("t3/engine/LiveBus") {}

/** How many frames a subscriber may fall behind before it is told `Gap`. */
export const LIVE_BUFFER = 1024;

type Frame = Exclude<LiveFrame, { readonly _tag: "Open" | "Gap" }>;

interface Channel {
  readonly frames: PubSub.PubSub<Frame>;
  readonly lock: Semaphore.Semaphore;
  /** key → stream → text so far. */
  readonly open: Map<string, Map<AppendStream, string>>;
  /** item → its latest progress. */
  readonly progress: Map<string, unknown>;
  seq: number;
}

export const makeLiveBus = (options: { readonly buffer?: number } = {}) =>
  Effect.suspend(() => {
    const channels = new Map<ConversationId, Channel>();
    const channelOf = Effect.fnUntraced(function* (conversation: ConversationId) {
      const known = channels.get(conversation);
      if (known !== undefined) return known;
      const made: Channel = {
        frames: yield* PubSub.sliding<Frame>(options.buffer ?? LIVE_BUFFER),
        lock: yield* Semaphore.make(1),
        open: new Map(),
        progress: new Map(),
        seq: 0,
      };
      // Another fiber may have made it meanwhile: the first one stays.
      const raced = channels.get(conversation);
      if (raced !== undefined) return raced;
      channels.set(conversation, made);
      return made;
    });

    const publish = (channel: Channel, frame: (liveSeq: number) => Frame) =>
      channel.lock.withPermits(1)(
        Effect.suspend(() => {
          channel.seq += 1;
          return PubSub.publish(channel.frames, frame(channel.seq));
        }),
      );

    return Effect.succeed(
      LiveBus.of({
        append: (conversation, key, stream, offset, text) =>
          Effect.gen(function* () {
            const channel = yield* channelOf(conversation);
            yield* publish(channel, (liveSeq) => {
              const streams = channel.open.get(key) ?? new Map<AppendStream, string>();
              channel.open.set(key, streams);
              const before = streams.get(stream) ?? "";
              // The offset places the text: one sent again never doubles what is there.
              streams.set(
                stream,
                offset <= before.length ? before.slice(0, offset) + text : before + text,
              );
              return { _tag: "Append", key, stream, offset, text, liveSeq };
            });
          }),
        context: (conversation, usage) =>
          Effect.flatMap(channelOf(conversation), (channel) =>
            publish(channel, (liveSeq) => ({ _tag: "Context", usage, liveSeq })),
          ),
        progress: (conversation, itemId, value) =>
          Effect.flatMap(channelOf(conversation), (channel) =>
            publish(channel, (liveSeq) => {
              if (value === null) channel.progress.delete(itemId);
              else channel.progress.set(itemId, value);
              return { _tag: "Progress", key: itemId, value, liveSeq };
            }),
          ),
        settle: (conversation, key) =>
          Effect.gen(function* () {
            const channel = channels.get(conversation);
            if (channel === undefined) return undefined;
            return yield* channel.lock.withPermits(1)(
              Effect.sync(() => {
                const streams = channel.open.get(key);
                channel.open.delete(key);
                return streams === undefined ? undefined : [...streams.values()].join("");
              }),
            );
          }),
        subscribe: (conversation) =>
          Effect.gen(function* () {
            const channel = yield* channelOf(conversation);
            const { subscription, open } = yield* channel.lock.withPermits(1)(
              Effect.gen(function* () {
                const subscription = yield* PubSub.subscribe(channel.frames);
                const items = [...channel.open].flatMap(([key, streams]) =>
                  [...streams].map(([stream, text]) => ({ key, stream, text })),
                );
                const progress = [...channel.progress].map(([key, value]) => ({ key, value }));
                return {
                  subscription,
                  open: {
                    _tag: "Open",
                    items,
                    ...(progress.length === 0 ? {} : { progress }),
                    liveSeq: channel.seq,
                  } satisfies LiveFrame,
                };
              }),
            );
            let last = open.liveSeq;
            const live = Stream.fromSubscription(subscription).pipe(
              Stream.map((frame): ReadonlyArray<LiveFrame> => {
                if (frame.liveSeq !== last + 1) return [{ _tag: "Gap" }];
                last = frame.liveSeq;
                return [frame];
              }),
              Stream.flattenIterable,
              Stream.takeUntil((frame) => frame._tag === "Gap"),
            );
            return Stream.concat(Stream.make(open as LiveFrame), live);
          }),
      }),
    );
  });

export const layer = Layer.effect(LiveBus, makeLiveBus());
