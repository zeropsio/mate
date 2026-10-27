import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeDeadlineClock, type DeadlineClock } from "./deadlineClock.ts";

const START_WALL_MS = 1_788_825_600_000;

/** A timer on the harness clock that records both clocks when it fires. */
const timer = (clock: DeadlineClock, ms: number) =>
  Effect.sleep(ms).pipe(
    Effect.andThen(Effect.sync(() => ({ wall: clock.wallMs(), mono: clock.monoMs() }))),
    Effect.provideService(Clock.Clock, clock),
    Effect.forkChild,
  );

describe("DeadlineClock", () => {
  it.effect("advances wall and monotonic time together and fires timers on the way", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const fired = yield* timer(clock, 10_000);
        yield* clock.advance(30_000);
        expect(yield* Fiber.join(fired)).toEqual({ wall: START_WALL_MS + 10_000, mono: 10_000 });
        expect(clock.wallMs()).toBe(START_WALL_MS + 30_000);
        expect(clock.monoMs()).toBe(30_000);
      }),
    ),
  );

  it.effect("sleeps the machine: wall jumps, monotonic time and timers stand still", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const fired = yield* timer(clock, 10_000);
        yield* clock.machineSleep(40 * 60_000);
        expect(clock.wallMs()).toBe(START_WALL_MS + 40 * 60_000);
        expect(clock.monoMs()).toBe(0);
        expect(fired.pollUnsafe()).toBeUndefined();
        yield* clock.advance(10_000);
        expect(yield* Fiber.join(fired)).toEqual({
          wall: START_WALL_MS + 40 * 60_000 + 10_000,
          mono: 10_000,
        });
      }),
    ),
  );

  it.effect("freezes the tab: nothing moves, then both clocks jump before overdue timers run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const fired = yield* timer(clock, 60_000);
        yield* clock.freeze(40 * 60_000);
        expect(yield* Fiber.join(fired)).toEqual({
          wall: START_WALL_MS + 40 * 60_000,
          mono: 40 * 60_000,
        });
      }),
    ),
  );

  it.effect("skews the wall clock back while monotonic time keeps its course", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        yield* clock.advance(5_000);
        clock.skewWall(-60 * 60_000);
        expect(clock.wallMs()).toBe(START_WALL_MS + 5_000 - 60 * 60_000);
        expect(clock.monoMs()).toBe(5_000);
        expect(clock.currentTimeMillisUnsafe()).toBe(clock.wallMs());
        expect(clock.monotonicTimeNanosUnsafe()).toBe(BigInt(5_000) * BigInt(1_000_000));
      }),
    ),
  );

  it.effect("aligns a hidden tab's timers to one-minute buckets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        yield* clock.advance(5_000);
        clock.alignHiddenTimers(true);
        const fired = yield* timer(clock, 10_000);
        yield* clock.advance(30_000);
        expect(fired.pollUnsafe()).toBeUndefined();
        yield* clock.advance(30_000);
        expect((yield* Fiber.join(fired)).mono).toBe(60_000);
        clock.alignHiddenTimers(false);
        const visible = yield* timer(clock, 10_000);
        yield* clock.advance(10_000);
        expect((yield* Fiber.join(visible)).mono).toBe(75_000);
      }),
    ),
  );
});
