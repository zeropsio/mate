// @effect-diagnostics nodeBuiltinImport:off -- procfs, statfs and kernel notification boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import { vi } from "vite-plus/test";
import * as TestClock from "effect/testing/TestClock";
import {
  latestAtMostEvery,
  publishesAgain,
  resourceHealthChanges,
  readResourceHealth as readKernelResourceHealth,
} from "./mateResourceHealth.ts";
import type { MateResourceHealth } from "@t3tools/contracts";

// Hold a kernel read to deliver a cadence tick at the asynchronous boundary.
const reads = vi.hoisted(() => ({ beforeCurrent: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith("memory.current")) await reads.beforeCurrent?.();
      return fs.readFile(...args);
    },
  };
});

const readResourceHealth = readKernelResourceHealth;

const dirs: string[] = [];
async function fixture(values: Record<string, string> = {}) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-health-"));
  dirs.push(dir);
  const files = {
    "memory.current": "100",
    "memory.high": "max",
    "memory.max": "max",
    "memory.events": "high 0\nmax 0\noom 0\noom_kill 0\n",
    "memory.swap.current": "0",
    "memory.swap.max": "0",
    "memory.pressure": "some avg10=0.00 total=0\nfull avg10=0.00 total=0\n",
    "pids.current": "136",
    "pids.max": "2000",
    "io.pressure": "some avg10=0.00 total=0\nfull avg10=0.00 total=0\n",
    ...values,
  };
  await Promise.all(
    Object.entries(files).map(([name, text]) => NodeFSP.writeFile(NodePath.join(dir, name), text)),
  );
  return dir;
}
afterEach(async () => {
  reads.beforeCurrent = undefined;
  await Promise.all(dirs.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })));
});
describe("container resource evidence", () => {
  it("Sustained ancestor stalls remain visible when a descendant has a brief spike", async () => {
    const root = await fixture({
      "memory.pressure":
        "some avg10=5 avg60=5 avg300=5 total=300\nfull avg10=0 avg60=10 avg300=10 total=200\n",
      "io.pressure":
        "some avg10=5 avg60=5 avg300=5 total=300\nfull avg10=0 avg60=10 avg300=10 total=200\n",
    });
    const leaf = await fixture({
      "memory.pressure":
        "some avg10=90 avg60=1 avg300=1 total=300\nfull avg10=0 avg60=0 avg300=0 total=0\n",
      "io.pressure":
        "some avg10=90 avg60=1 avg300=1 total=300\nfull avg10=0 avg60=0 avg300=0 total=0\n",
    });
    const health = await readResourceHealth([leaf, root], root, undefined, 0);
    expect(health.memory?.pressure?.full).toEqual({ avg10: 0, avg60: 10, avg300: 10, total: 200 });
    expect(health.io?.full).toEqual({ avg10: 0, avg60: 10, avg300: 10, total: 200 });
    expect(health.resources).toEqual(["memory", "io"]);
  });
  it("reports the measured starving container without needing a previous sample", async () => {
    const dir = await fixture({
      "memory.current": "1700000000",
      "memory.high": "1610612736",
      "memory.swap.current": "536870912",
      "memory.swap.max": "536870912",
      "memory.pressure":
        "some avg10=60.00 avg60=40 avg300=40 total=300\nfull avg10=40.00 avg60=10 avg300=10 total=200\n",
    });
    const health = await readResourceHealth([dir], dir, undefined, 0);
    expect(health).toMatchObject({
      status: "strained",
      severity: "warning",
      resources: ["memory"],
      memory: { high: 1610612736, swapCurrent: 536870912 },
    });
  });
  it("distinguishes old OOM counters from new kills, and unlimited from unreadable", async () => {
    const dir = await fixture({ "memory.events": "high 8\nmax 0\noom 4\noom_kill 2\n" });
    const previous = await readResourceHealth([dir], dir, undefined, 0);
    expect(previous.status).toBe("ok");
    await NodeFSP.writeFile(
      NodePath.join(dir, "memory.events"),
      "high 9\nmax 0\noom 5\noom_kill 3\n",
    );
    const next = await readResourceHealth([dir], dir, previous, 0);
    expect(next).toMatchObject({
      status: "strained",
      severity: "critical",
      memory: { growth: { high: 1, oom: 1, oomKill: 1 } },
    });
    await NodeFSP.writeFile(NodePath.join(dir, "memory.high"), "garbage");
    expect((await readResourceHealth([dir], dir, undefined, 0)).status).toBe("unknown");
  });
  it("uses the ancestor enforcing the tightest cap, not the service's unlimited leaf", async () => {
    const root = await fixture({
      "memory.high": "150",
      "memory.max": "300",
      "memory.current": "200",
    });
    const leaf = await fixture();
    expect(await readResourceHealth([leaf, root], leaf, undefined, 0)).toMatchObject({
      status: "ok",
      memory: { high: 150, max: 300, current: 200 },
    });
  });

  it.each(["disabled", "unreadable"])(
    "preserves descendant PSI when container accounting is %s",
    async (accounting) => {
      const root = await fixture({
        "memory.max": String(3.75 * 1024 ** 3),
        "memory.high": String(1.75 * 1024 ** 3),
        "cgroup.pressure": "0",
      });
      const child = await fixture({
        "memory.max": String(1024 ** 3),
        "memory.pressure":
          "some avg10=30.00 avg60=40 avg300=40 total=300\nfull avg10=24.00 avg60=10 avg300=10 total=240\n",
      });
      if (accounting === "unreadable") await NodeFSP.unlink(NodePath.join(root, "memory.pressure"));
      const health = await readResourceHealth([child, root], root, undefined, 0);
      expect(health).toMatchObject({
        status: "strained",
        resources: ["memory"],
        severity: "warning",
        memory: {
          scope: root,
          max: 3.75 * 1024 ** 3,
          high: 1.75 * 1024 ** 3,
          pressure: { some: { avg10: 30, total: 300 }, full: { avg10: 24, total: 240 } },
        },
      });
      expect(health.unavailable.includes("memory.pressure")).toBe(accounting === "unreadable");
      await NodeFSP.writeFile(
        NodePath.join(child, "memory.pressure"),
        "some avg10=0.00 total=300\nfull avg10=0.00 total=240\n",
      );
      expect((await readResourceHealth([child, root], root, health, 0)).status).toBe(
        accounting === "unreadable" ? "unknown" : "ok",
      );
    },
  );
  it("withholds the container cap when partial root reads leave only child memory evidence", async () => {
    const root = await fixture({ "memory.max": String(3.75 * 1024 ** 3) });
    await NodeFSP.unlink(NodePath.join(root, "memory.current"));
    const child = await fixture({
      "memory.max": String(1024 ** 3),
      "memory.high": String(0.5 * 1024 ** 3),
      "memory.pressure":
        "some avg10=30.00 avg60=40 avg300=40 total=300\nfull avg10=24.00 avg60=10 avg300=10 total=240\n",
    });
    expect(await readResourceHealth([child, root], root, undefined, 0)).toMatchObject({
      status: "strained",
      resources: ["memory"],
      unavailable: ["memory.current"],
      memory: { scope: child, max: null, high: null, pressure: { some: { avg10: 30 } } },
    });
  });
  it.each(["disabled", "unreadable"])(
    "preserves descendant I/O stalls with %s root PSI",
    async (accounting) => {
      const root = await fixture({ "cgroup.pressure": "0" });
      const child = await fixture({
        "io.pressure":
          "some avg10=30.00 avg60=40 avg300=40 total=300\nfull avg10=24.00 avg60=10 avg300=10 total=240\n",
      });
      if (accounting === "unreadable") await NodeFSP.unlink(NodePath.join(root, "io.pressure"));
      const health = await readResourceHealth([child, root], root, undefined, 0);
      expect(health).toMatchObject({
        status: "strained",
        resources: ["io"],
        severity: "warning",
        io: { some: { avg10: 30, total: 300 }, full: { avg10: 24, total: 240 } },
      });
      expect(health.unavailable.includes("io.pressure")).toBe(accounting === "unreadable");
      await NodeFSP.writeFile(
        NodePath.join(child, "io.pressure"),
        "some avg10=0.00 total=300\nfull avg10=0.00 total=240\n",
      );
      expect((await readResourceHealth([child, root], root, health, 0)).status).toBe(
        accounting === "unreadable" ? "unknown" : "ok",
      );
    },
  );

  it("does not call an unreadable disk healthy", async () => {
    const dir = await fixture();
    expect(
      await readResourceHealth([dir], NodePath.join(dir, "missing"), undefined, 0),
    ).toMatchObject({
      status: "unknown",
      disk: null,
    });
  });
});

it.effect("publishes a changed kernel file without a polling timer", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => fixture());
    const values = yield* Stream.runCollect(
      resourceHealthChanges(dir, [dir]).pipe(
        Stream.tap((sample) =>
          sample.resources.length === 0
            ? Effect.promise(() =>
                NodeFSP.writeFile(
                  NodePath.join(dir, "memory.events"),
                  "high 1\nmax 0\noom 0\noom_kill 1\n",
                ),
              )
            : Effect.void,
        ),
        Stream.take(2),
      ),
    );
    expect(values.map((value) => value.resources)).toEqual([[], ["memory"]]);
  }),
);

it("counts new events and swap across a changed RAM cap, but never subtracts counters from another cgroup", async () => {
  const dir = await fixture({ "memory.high": "150" });
  const previous = await readResourceHealth([dir], dir, undefined, 0);
  await NodeFSP.writeFile(NodePath.join(dir, "memory.high"), "200");
  await NodeFSP.writeFile(
    NodePath.join(dir, "memory.events"),
    "high 1\nmax 0\noom 1\noom_kill 1\n",
  );
  expect((await readResourceHealth([dir], dir, previous, 0)).memory?.growth.oomKill).toBe(1);
  const other = await fixture({
    "memory.high": "200",
    "memory.events": "high 9\nmax 0\noom 9\noom_kill 9\n",
  });
  const changedScope = await readResourceHealth([other], other, previous, 0);
  expect(changedScope.memory?.growth).toEqual({ high: 0, max: 0, oom: 0, oomKill: 0 });
  expect(changedScope.memory?.swapGrowth).toBe(0);
});

it.effect("reports missing notification coverage alongside the remaining measured limits", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => fixture({ "memory.high": "150" }));
    yield* Effect.promise(() => NodeFSP.unlink(NodePath.join(dir, "memory.swap.max")));
    const values = yield* Stream.runCollect(resourceHealthChanges(dir, [dir]).pipe(Stream.take(1)));
    expect(values[0]).toMatchObject({ status: "unknown", memory: { high: 150 } });
    expect(values[0]?.unavailable).toContain("kernel-events");
  }),
);

describe("a Mate publishes a sample again only when its warning, or a number the warning quotes, changes", () => {
  const quiet = { avg10: 0, total: 0 };
  const sample = (change: {
    readonly status?: MateResourceHealth["status"];
    readonly severity?: MateResourceHealth["severity"];
    readonly resources?: MateResourceHealth["resources"];
    readonly memoryCurrent?: number;
    readonly memoryHigh?: number;
    readonly ioAvg10?: number;
  }): MateResourceHealth => ({
    status: change.status ?? "ok",
    severity: change.severity ?? "warning",
    resources: change.resources ?? [],
    memory: {
      current: change.memoryCurrent ?? 900,
      high: change.memoryHigh ?? 1000,
      max: 3000,
      events: { high: 0, max: 0, oom: 0, oomKill: 0 },
      growth: { high: 0, max: 0, oom: 0, oomKill: 0 },
      pressure: { some: quiet, full: quiet },
      swapCurrent: 0,
      swapMax: 0,
      swapGrowth: 0,
    },
    pids: null,
    io: { some: { avg10: change.ioAvg10 ?? 1.75, total: 2_792_695_561 }, full: quiet },
    disk: { free: 263_085_883_392, total: 268_435_456_000 },
    unavailable: [],
  });
  const io = { status: "strained", resources: ["io"] } as const;
  const again = "publishes again";
  const nothing = "publishes nothing";
  it.each([
    ["a healthy Mate whose usage moved", nothing, {}, { memoryCurrent: 950 }],
    ["a healthy Mate whose RAM cap changed", nothing, {}, { memoryHigh: 2000 }],
    [
      "an I/O-strained Mate whose unquoted numbers moved",
      nothing,
      io,
      { ...io, ioAvg10: 9.5, memoryCurrent: 950 },
    ],
    [
      "an I/O-strained Mate now near its task limit too",
      again,
      io,
      { ...io, resources: ["io", "pids"] },
    ],
    ["an I/O-strained Mate that recovered", again, io, {}],
    ["a strained Mate that turned critical", again, io, { ...io, severity: "critical" }],
  ] as const)("%s %s", (_case, verdict, previous, next) => {
    expect(publishesAgain(sample(previous), sample(next))).toBe(verdict === again);
  });
});

it.effect(
  "publishes at most one sample a window however often the kernel wakes it, and that the latest",
  () =>
    Effect.gen(function* () {
      const wakes = yield* Queue.unbounded<number>();
      const published = yield* Queue.unbounded<number>();
      yield* Effect.forkScoped(
        Stream.fromQueue(wakes).pipe(
          latestAtMostEvery(2000),
          Stream.runForEach((value) => Queue.offer(published, value)),
        ),
      );
      yield* Queue.offerAll(wakes, [1]);
      expect(yield* Queue.take(published)).toBe(1);
      // Thirty-three wakes in the next second: one sample leaves, the last, when the window ends.
      for (let value = 2; value <= 34; value += 1) {
        yield* Queue.offer(wakes, value);
        yield* TestClock.adjust(30);
      }
      expect(yield* Queue.size(published)).toBe(0);
      yield* TestClock.adjust(2000);
      expect(yield* Queue.take(published)).toBe(34);
      yield* TestClock.adjust(4000);
      expect(yield* Queue.size(published)).toBe(0);
    }),
);

// cgroup-v2 file shapes captured read-only from Fen and Ada on 2026-10-12.
describe("Approved health notices", () => {
  it.each([
    [
      "memory.high event",
      {
        "memory.events":
          "low 0\nhigh 22831\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\nsock_throttled 11021\n",
      },
    ],
    ["swap growth", { "memory.swap.current": "209715200" }],
    [
      "brief memory PSI",
      {
        "memory.pressure":
          "some avg10=90.00 avg60=1.00 avg300=0.20 total=23849061\nfull avg10=40.00 avg60=1.00 avg300=0.20 total=13008446\n",
      },
    ],
    [
      "brief I/O PSI",
      {
        "io.pressure":
          "some avg10=90.00 avg60=1.00 avg300=0.20 total=17190765\nfull avg10=40.00 avg60=1.00 avg300=0.20 total=10213888\n",
      },
    ],
    ["hard-limit event without a kill", { "memory.events": "high 0\nmax 1\noom 1\noom_kill 0\n" }],
  ])("routine scaling stays quiet: %s", async (_signal, files) => {
    const dir = await fixture({ "memory.events": "high 22830\nmax 0\noom 0\noom_kill 0\n" });
    const previous = await readResourceHealth([dir], dir, undefined, 0);
    await Promise.all(
      Object.entries(files).map(([file, value]) =>
        NodeFSP.writeFile(NodePath.join(dir, file), value),
      ),
    );
    expect(await readResourceHealth([dir], dir, previous, 0)).toMatchObject({
      status: "ok",
      resources: [],
    });
  });
  it.each([
    [
      "memory full",
      "memory.pressure",
      "some avg10=0 avg60=0 avg300=0 total=23849061\nfull avg10=0 avg60=10 avg300=10 total=13008446\n",
      ["memory"],
    ],
    [
      "memory some",
      "memory.pressure",
      "some avg10=0 avg60=40 avg300=40 total=23849061\nfull avg10=0 avg60=0 avg300=0 total=13008446\n",
      ["memory"],
    ],
    [
      "I/O full",
      "io.pressure",
      "some avg10=0 avg60=0 avg300=0 total=17190765\nfull avg10=0 avg60=10 avg300=10 total=10213888\n",
      ["io"],
    ],
    [
      "I/O some",
      "io.pressure",
      "some avg10=0 avg60=40 avg300=40 total=17190765\nfull avg10=0 avg60=0 avg300=0 total=10213888\n",
      ["io"],
    ],
    ["task limit", "pids.current", "1800", ["pids"]],
  ])("raises the approved %s notice at its boundary", async (_signal, file, value, resources) => {
    const dir = await fixture({ [file]: value });
    expect(await readResourceHealth([dir], dir, undefined, 0)).toMatchObject({
      status: "strained",
      severity: "warning",
      resources,
    });
  });
});

it("An observed OOM kill stays visible for ten minutes without refreshing on reads", async () => {
  const dir = await fixture();
  const before = await readResourceHealth([dir], dir, undefined, 0);
  await NodeFSP.writeFile(
    NodePath.join(dir, "memory.events"),
    "high 0\nmax 0\noom 1\noom_kill 1\n",
  );
  const killed = await readResourceHealth([dir], dir, before, 2000);
  expect(killed).toMatchObject({
    status: "strained",
    severity: "critical",
    resources: ["memory"],
    memory: { oomKilledAt: 2000 },
  });
  const retained = await readResourceHealth([dir], dir, killed, 601999);
  expect(retained).toMatchObject({
    status: "strained",
    memory: { oomKilledAt: 2000, growth: { oomKill: 0 } },
  });
  expect(publishesAgain(killed, retained)).toBe(false);
  const expired = await readResourceHealth([dir], dir, retained, 602000);
  expect(expired).toMatchObject({ status: "ok", resources: [], memory: { oomKilledAt: null } });
  expect(publishesAgain(retained, expired)).toBe(true);
});
it.each(["memory.pressure", "io.pressure"])(
  "Both long averages must cross the threshold for %s",
  async (file) => {
    for (const line of [
      "some avg10=90 avg60=40 avg300=39.99 total=23849061\nfull avg10=90 avg60=10 avg300=9.99 total=13008446\n",
      "some avg10=90 avg60=39.99 avg300=40 total=23849061\nfull avg10=90 avg60=9.99 avg300=10 total=13008446\n",
    ]) {
      const dir = await fixture({ [file]: line });
      expect(await readResourceHealth([dir], dir, undefined, 0)).toMatchObject({
        status: "ok",
        resources: [],
      });
    }
  },
);
it("The enforcing ancestor's task limit is visible and unlimited tasks stay quiet", async () => {
  const root = await fixture({ "pids.current": "1800" });
  const child = await fixture({ "pids.current": "40", "pids.max": "max" });
  const before = await readResourceHealth([child, root], root, undefined, 0);
  expect(before).toMatchObject({
    resources: ["pids"],
    pids: { scope: root, current: 1800, max: 2000 },
  });
  await NodeFSP.writeFile(NodePath.join(root, "pids.current"), "1799");
  expect(await readResourceHealth([child, root], root, before, 0)).toMatchObject({
    status: "ok",
    resources: [],
  });
  await NodeFSP.writeFile(NodePath.join(root, "pids.max"), "max");
  expect(await readResourceHealth([child, root], root, undefined, 0)).toMatchObject({
    status: "ok",
    resources: [],
  });
  await NodeFSP.unlink(NodePath.join(root, "pids.current"));
  expect(await readResourceHealth([root], root, undefined, 0)).toMatchObject({
    status: "unknown",
    pids: null,
    unavailable: ["pids.current"],
  });
});
