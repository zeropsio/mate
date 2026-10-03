/**
 * How often HQ computes a structure socket's view again, over the last minute (`/health`): every
 * change of the structure, of a change or of a deploy, and every recheck, computes every open
 * socket's view again (`stream.ts`) — a cost that grows with the sockets and the Mates' summaries,
 * made a number (F22, 2026-10-03: a 52 s stall of every answer, its cause to be measured).
 *
 * A reference, so a stream counts without naming it among its requirements; outside a Core that
 * provides one, nothing is counted.
 *
 * @module recomputes
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface RecomputeCount {
  /** One recompute, now. */
  readonly count: Effect.Effect<void>;
  /** The recomputes of the last 60 s. */
  readonly lastMinute: Effect.Effect<number>;
}

export const Recomputes = Context.Reference<RecomputeCount>("@t3tools/hq/recomputes", {
  defaultValue: () => ({ count: Effect.void, lastMinute: Effect.succeed(0) }),
});

const SECONDS = 60;

/** A count kept per second for the last minute. */
export const makeRecomputes = Effect.sync((): RecomputeCount => {
  const counts = Array.from({ length: SECONDS }, () => 0);
  const seconds = Array.from({ length: SECONDS }, () => -1);
  return {
    count: Effect.map(Clock.currentTimeMillis, (now) => {
      const second = Math.floor(now / 1000);
      const slot = second % SECONDS;
      if (seconds[slot] !== second) {
        seconds[slot] = second;
        counts[slot] = 0;
      }
      counts[slot] = (counts[slot] ?? 0) + 1;
    }),
    lastMinute: Effect.map(Clock.currentTimeMillis, (now) => {
      const second = Math.floor(now / 1000);
      return counts.reduce(
        (sum, count, slot) => ((seconds[slot] ?? -1) > second - SECONDS ? sum + count : sum),
        0,
      );
    }),
  };
});

export const recomputesLayer = Layer.effect(Recomputes, makeRecomputes);
