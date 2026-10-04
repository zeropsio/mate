// @effect-diagnostics nodeBuiltinImport:off -- a file descriptor of each kind, opened here.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { type LoopProbes, kindOf, makeLoopWatch, timeWrites } from "./loopWatch.ts";

/**
 * Probes a test sets: the process's own clock (a stall is a tick it lived late), the CPU used so far,
 * the longest stdout write pending, the loop's delay.
 */
const fakeProbes = () => {
  const fake = { now: 0, cpu: 0, longest: 0, lag: { maxMs: 0, p99Ms: 0 } };
  const probes: LoopProbes = {
    nowMs: () => fake.now,
    cpuMs: () => fake.cpu,
    longestWriteMs: () => {
      const longest = fake.longest;
      fake.longest = 0;
      return longest;
    },
    lag: () => fake.lag,
    resetLag: () => {
      fake.lag = { maxMs: 0, p99Ms: 0 };
    },
  };
  return { fake, probes };
};

describe("the event loop's watch", () => {
  it.effect("records a stall: how late its tick came, the CPU used in it, the longest write", () =>
    Effect.gen(function* () {
      const { fake, probes } = fakeProbes();
      const watch = yield* makeLoopWatch(probes);
      /** The next tick, the process having lived `ms` since the one before. */
      const tickAfter = (ms: number) => {
        fake.now += ms;
        return TestClock.adjust("1 seconds");
      };
      yield* tickAfter(1000);
      // Two seconds late is no stall.
      yield* tickAfter(3000);
      assert.isNull((yield* watch.status).lastStall);

      fake.cpu += 12;
      fake.longest = 4800;
      yield* tickAfter(5000);
      assert.deepStrictEqual((yield* watch.status).lastStall, {
        at: "1970-01-01T00:00:03.000Z",
        lateMs: 4000,
        cpuMs: 12,
        longestWriteMs: 4800,
      });
    }),
  );

  it.effect("reports the loop's delay over the last one to two minutes", () =>
    Effect.gen(function* () {
      const { fake, probes } = fakeProbes();
      const watch = yield* makeLoopWatch(probes);
      const lag = Effect.map(watch.status, (status) => [status.maxLagMs, status.p99LagMs]);
      /** A minute of ticks on time. */
      const aMinute = Effect.forEach(
        Array.from({ length: 60 }),
        () => {
          fake.now += 1000;
          return TestClock.adjust("1 seconds");
        },
        { discard: true },
      );
      fake.lag = { maxMs: 120, p99Ms: 40 };
      assert.deepStrictEqual(yield* lag, [120, 40]);

      // A minute on, the one before still counts beside the new one.
      yield* aMinute;
      assert.deepStrictEqual(yield* lag, [120, 40]);
      fake.lag = { maxMs: 30, p99Ms: 50 };
      assert.deepStrictEqual(yield* lag, [120, 50]);
      // Another minute on, only it and the one before do.
      yield* aMinute;
      assert.deepStrictEqual(yield* lag, [30, 50]);
    }),
  );

  it.effect("times a stream's writes while it runs, and puts its write back after", () =>
    Effect.gen(function* () {
      const write = (_chunk: string) => {
        // A write that blocks, as one to a pipe nobody reads.
        const until = performance.now() + 30;
        while (performance.now() < until) continue;
        return true;
      };
      const stream = { write };
      const longest = yield* Effect.scoped(
        Effect.gen(function* () {
          const timed = yield* timeWrites(stream);
          assert.notStrictEqual(stream.write, write);
          stream.write("a line\n");
          return [timed.longestWriteMs(), timed.longestWriteMs()];
        }),
      );
      assert.isAtLeast(longest[0]!, 30);
      assert.strictEqual(longest[1], 0);
      assert.strictEqual(stream.write, write);
    }),
  );

  it.effect("names what a file descriptor is, as stdout's is logged at boot", () =>
    Effect.gen(function* () {
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-fd-"));
      const kinds = yield* Effect.acquireUseRelease(
        Effect.sync(() => [
          NodeFS.openSync(NodePath.join(dir, "log"), "w"),
          NodeFS.openSync("/dev/null", "w"),
        ]),
        (fds) => Effect.forEach(fds, kindOf),
        (fds) =>
          Effect.sync(() => {
            for (const fd of fds) NodeFS.closeSync(fd);
            NodeFS.rmSync(dir, { recursive: true, force: true });
          }),
      );
      assert.deepStrictEqual(
        [...kinds, yield* kindOf(-1)],
        ["file", "character device", "unknown"],
      );
    }),
  );
});
