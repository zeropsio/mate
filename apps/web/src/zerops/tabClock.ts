/**
 * The clock a tab's account data runtime runs on: `Date.now()` for the wall and
 * `performance.now()` for monotonic time, as the page reads them (DESIGN §11.1),
 * and the page's timers for sleeping. Its access grant stamps evidence on it, so
 * every capability read from that grant reads the same two clocks.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

const NANOS_PER_MILLI = 1_000_000;

const wallMs = () => Date.now();
const wallNanos = () => BigInt(Date.now()) * BigInt(NANOS_PER_MILLI);
const monoNanos = () => BigInt(Math.round(performance.now() * NANOS_PER_MILLI));
const timers = Clock.Clock.defaultValue();

export const tabClock: Clock.Clock = {
  currentTimeMillisUnsafe: wallMs,
  currentTimeMillis: Effect.sync(wallMs),
  currentTimeNanosUnsafe: wallNanos,
  currentTimeNanos: Effect.sync(wallNanos),
  monotonicTimeNanosUnsafe: monoNanos,
  monotonicTimeNanos: Effect.sync(monoNanos),
  sleep: (duration) => timers.sleep(duration),
};
