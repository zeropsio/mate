/**
 * The harness clock (DESIGN §11.1): wall and monotonic time that a test moves
 * independently, the way a laptop lid, a frozen tab or a corrected system
 * clock moves them in a browser.
 *
 * It is an Effect `Clock`, so code under test that sleeps through Effect runs
 * on it. Timers live on an Effect `TestClock` that counts monotonic time.
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

const NANOS_PER_MILLI = BigInt(1_000_000);
const HIDDEN_TIMER_BUCKET_MS = 60_000;

export interface DeadlineClock extends Clock.Clock {
  /** `Date.now()` as the tab reads it. */
  readonly wallMs: () => number;
  /** `performance.now()` as the tab reads it. */
  readonly monoMs: () => number;
  /** Time passes in a running, visible tab: both clocks move and timers fire in order. */
  readonly advance: (ms: number) => Effect.Effect<void>;
  /** The machine sleeps: the wall clock jumps, monotonic time and every timer stand still. */
  readonly machineSleep: (ms: number) => Effect.Effect<void>;
  /**
   * The tab is frozen: nothing moves while it is, then both clocks jump at once
   * and every overdue timer runs, reading the time after the jump.
   */
  readonly freeze: (ms: number) => Effect.Effect<void>;
  /** The system clock is corrected (negative sets it back); monotonic time is untouched. */
  readonly skewWall: (deltaMs: number) => void;
  /**
   * While the tab is hidden, a timer that comes due fires on the next
   * one-minute bucket of monotonic time, as browsers throttle hidden tabs.
   */
  readonly alignHiddenTimers: (hidden: boolean) => void;
}

export const makeDeadlineClock = Effect.fnUntraced(function* (options: {
  readonly startWallMs: number;
}): Effect.fn.Return<DeadlineClock, never, Scope.Scope> {
  const timers = yield* TestClock.make();
  let wallOffsetMs = options.startWallMs;
  // While a freeze releases its overdue timers, they read the time after the jump.
  let floorMs = 0;
  const monoMs = () => Math.max(timers.currentTimeMillisUnsafe(), floorMs);
  const wallMs = () => monoMs() + wallOffsetMs;
  let hidden = false;
  // A timer waits on monotonic time and re-checks it on waking, because one
  // armed while a freeze releases its backlog counts from the time after the jump.
  const sleepUntil = (dueMs: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const firesAtMs = hidden
        ? Math.ceil(dueMs / HIDDEN_TIMER_BUCKET_MS) * HIDDEN_TIMER_BUCKET_MS
        : dueMs;
      const waitMs = firesAtMs - monoMs();
      return waitMs > 0
        ? timers.sleep(Duration.millis(waitMs)).pipe(Effect.andThen(sleepUntil(dueMs)))
        : Effect.void;
    });
  return {
    wallMs,
    monoMs,
    currentTimeMillisUnsafe: wallMs,
    currentTimeMillis: Effect.sync(wallMs),
    currentTimeNanosUnsafe: () => BigInt(wallMs()) * NANOS_PER_MILLI,
    currentTimeNanos: Effect.sync(() => BigInt(wallMs()) * NANOS_PER_MILLI),
    monotonicTimeNanosUnsafe: () => BigInt(monoMs()) * NANOS_PER_MILLI,
    monotonicTimeNanos: Effect.sync(() => BigInt(monoMs()) * NANOS_PER_MILLI),
    sleep: (duration: Duration.Duration) =>
      Effect.suspend(() => sleepUntil(monoMs() + Duration.toMillis(duration))),
    advance: (ms) => timers.adjust(Duration.millis(ms)),
    machineSleep: (ms) =>
      Effect.sync(() => {
        wallOffsetMs += ms;
      }),
    freeze: (ms) =>
      Effect.gen(function* () {
        // Timers already on their way are armed before the tab freezes.
        yield* Fiber.await(yield* Effect.forkChild(Effect.yieldNow));
        floorMs = monoMs() + ms;
        yield* timers.adjust(Duration.millis(ms));
      }),
    skewWall: (deltaMs) => {
      wallOffsetMs += deltaMs;
    },
    alignHiddenTimers: (next) => {
      hidden = next;
    },
  };
});
