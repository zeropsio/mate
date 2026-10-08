import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { drainMateUpdate, joinUpdateIdleFacts } from "./mateUpdateDrain.ts";

describe("Mate drain", () => {
  it.effect.each([
    {
      name: "a busy turn waits for committed completion",
      evidence: [false, true],
      permission: true,
      settled: true,
      expected: true,
      waits: 1,
    },
    {
      name: "proved idle work switches immediately",
      evidence: [true],
      permission: true,
      settled: true,
      expected: true,
      waits: 0,
    },
    {
      name: "an HQ hold prevents admission from closing",
      evidence: [true],
      permission: false,
      settled: true,
      expected: false,
      waits: 0,
    },
  ])("$name", ({ evidence, permission, settled, expected, waits }) =>
    Effect.gen(function* () {
      let checks = 0;
      let waited = 0;
      let canceled = false;
      let fenced = false;
      const done = yield* drainMateUpdate({
        allowed: Effect.succeed(permission),
        begin: Effect.sync(() => {
          fenced = true;
        }),
        cancel: Effect.sync(() => {
          canceled = true;
        }),
        facts: Effect.sync(() => ({ idle: evidence[checks++] ?? false, blockers: [] })),
        quiesce: Effect.succeed({ idle: settled, blockers: [] }),
        changed: Effect.sync(() => {
          waited++;
        }),
      });
      expect(done).toBe(expected);
      expect(waited).toBe(waits);
      expect(fenced).toBe(permission);
      expect(canceled).toBe(!expected);
    }),
  );
  it.effect("the deadline reopens admission and never interrupts work", () =>
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<void>();
      let canceled = false;
      const pending = yield* drainMateUpdate(
        {
          allowed: Effect.succeed(true),
          begin: Effect.void,
          cancel: Effect.sync(() => {
            canceled = true;
          }),
          facts: Effect.succeed({ idle: false, blockers: ["turn"] }),
          quiesce: Effect.die("a busy turn must not close"),
          changed: Queue.take(changes),
        },
        1,
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(pending)).toBe(false);
      expect(canceled).toBe(true);
    }),
  );
});

describe("native closure participates in the final idle proof", () => {
  it.each([
    [true, true, true],
    [false, true, false],
    [true, false, false],
    [false, false, false],
  ])(
    "native closure idle %s and process idle %s permits switch %s",
    (native, process, expected) => {
      expect(
        joinUpdateIdleFacts(
          { idle: native, blockers: native ? [] : ["native close failed"] },
          { idle: process, blockers: process ? [] : ["process"] },
        ).idle,
      ).toBe(expected);
    },
  );
});
