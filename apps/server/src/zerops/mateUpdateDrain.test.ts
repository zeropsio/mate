import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import {
  drainMateUpdate,
  joinUpdateIdleFacts,
  quietWaitMs,
  type UpdateQuietFacts,
} from "./mateUpdateDrain.ts";

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

describe("a refused drain says why", () => {
  it.effect("a drain refused at its deadline logs, at info, the blockers it waited on", () => {
    const lines: Array<{ readonly level: string; readonly message: unknown }> = [];
    const logger = Logger.make(({ logLevel, message }) => {
      lines.push({ level: logLevel, message });
    });
    return Effect.gen(function* () {
      const changes = yield* Queue.unbounded<void>();
      const pending = yield* drainMateUpdate(
        {
          allowed: Effect.succeed(true),
          begin: Effect.void,
          cancel: Effect.void,
          facts: Effect.succeed({ idle: false, blockers: ["mate: native resume is unsupported"] }),
          quiesce: Effect.die("a busy Mate must not close"),
          changed: Queue.take(changes),
        },
        1,
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(pending)).toBe(false);
      expect(
        lines.some(
          (line) =>
            line.level === "Info" &&
            String(line.message).includes("deadline") &&
            String(line.message).includes("mate: native resume is unsupported"),
        ),
      ).toBe(true);
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
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

// Run 2: the organization updates idle Mates automatically, and a Mate was restarted one second
// after its answer — its person saw it "isn't answering" while reading the result.
describe("an automatic update leaves a quiet minute after a turn", () => {
  it.each([
    { name: "no turn yet", lastTurnEndedAt: undefined, refusedAt: undefined, now: 5, wait: 0 },
    {
      name: "a turn that just ended",
      lastTurnEndedAt: 1_000,
      refusedAt: undefined,
      now: 1_000,
      wait: 60_000,
    },
    {
      name: "a turn half a minute ago",
      lastTurnEndedAt: 1_000,
      refusedAt: undefined,
      now: 31_000,
      wait: 30_000,
    },
    {
      name: "a turn a minute ago",
      lastTurnEndedAt: 1_000,
      refusedAt: undefined,
      now: 61_000,
      wait: 0,
    },
    {
      name: "work that met the closing admission",
      lastTurnEndedAt: 1_000,
      refusedAt: 100_000,
      now: 130_000,
      wait: 30_000,
    },
  ])("$name waits $wait ms", ({ lastTurnEndedAt, refusedAt, now, wait }) => {
    expect(quietWaitMs({ lastTurnEndedAt, refusedAt, now, quietMs: 60_000 })).toBe(wait);
  });

  const automatic = (read: () => UpdateQuietFacts, facts: () => boolean = () => true) =>
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<void>();
      const record = { begun: 0, canceled: 0 };
      const fiber = yield* drainMateUpdate({
        allowed: Effect.succeed(true),
        begin: Effect.sync(() => {
          record.begun++;
        }),
        cancel: Effect.sync(() => {
          record.canceled++;
        }),
        facts: Effect.sync(() => ({ idle: facts(), blockers: facts() ? [] : ["turn"] })),
        quiesce: Effect.succeed({ idle: true, blockers: [] }),
        changed: Queue.take(changes),
        quiet: Effect.sync(read),
      }).pipe(Effect.forkChild);
      return { fiber, record, changes };
    });

  it.effect("an automatic update closes admission only a quiet minute after the last turn", () =>
    Effect.gen(function* () {
      const { fiber, record } = yield* automatic(() => ({
        idle: true,
        blockers: [],
        lastTurnEndedAt: 0,
      }));
      yield* TestClock.adjust(59_999);
      expect(record.begun).toBe(0);
      // No other event comes: the minute's own wake goes ahead.
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toBe(true);
      expect(record.begun).toBe(1);
    }),
  );

  it.effect("a turn inside the quiet minute starts the minute over", () =>
    Effect.gen(function* () {
      let ended = 0;
      let working = false;
      const { fiber, record, changes } = yield* automatic(() => ({
        idle: !working,
        blockers: working ? ["turn"] : [],
        lastTurnEndedAt: ended,
      }));
      yield* TestClock.adjust(20_000);
      working = true;
      yield* Queue.offer(changes, undefined);
      yield* TestClock.adjust(50_000);
      ended = 70_000;
      working = false;
      yield* Queue.offer(changes, undefined);
      yield* TestClock.adjust(59_999);
      expect(record.begun).toBe(0);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toBe(true);
    }),
  );

  it.effect("work that meets the closing admission reopens it and waits a quiet minute again", () =>
    Effect.gen(function* () {
      let proofs = 0;
      const { fiber, record } = yield* automatic(
        () => ({ idle: true, blockers: [], lastTurnEndedAt: undefined }),
        () => proofs++ > 0,
      );
      yield* TestClock.adjust(0);
      expect(record).toEqual({ begun: 1, canceled: 1 });
      yield* TestClock.adjust(59_999);
      expect(record.begun).toBe(1);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toBe(true);
      expect(record).toEqual({ begun: 2, canceled: 1 });
    }),
  );

  it.effect("an update the person asked for closes admission straight after a turn", () =>
    Effect.gen(function* () {
      let begun = false;
      const done = yield* drainMateUpdate({
        allowed: Effect.succeed(true),
        begin: Effect.sync(() => {
          begun = true;
        }),
        cancel: Effect.void,
        facts: Effect.succeed({ idle: true, blockers: [] }),
        quiesce: Effect.succeed({ idle: true, blockers: [] }),
        changed: Effect.never,
      });
      expect(done).toBe(true);
      expect(begun).toBe(true);
    }),
  );
});
