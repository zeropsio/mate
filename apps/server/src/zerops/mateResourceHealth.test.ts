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
  resourceHealthChanges,
  readResourceHealth as readKernelResourceHealth,
} from "./mateResourceHealth.ts";
import { makeCpuSampler } from "./mateCpuHealth.ts";
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

// Memory/disk cases begin with an established, quiet CPU window.
async function readResourceHealth(
  groups: ReadonlyArray<string>,
  stateDir: string,
  previous?: MateResourceHealth,
) {
  let now = 0;
  const cpu = makeCpuSampler(groups, { nowUsec: () => now });
  await cpu();
  now = 2_000_000;
  return readKernelResourceHealth(groups, stateDir, previous, cpu);
}

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
    "cpu.pressure": "some avg10=0.00 total=0\nfull avg10=0.00 total=0\n",
    "cpu.max": "max 100000",
    "cpuset.cpus.effective": "0-1",
    "cpu.stat": "usage_usec 0\nnr_throttled 0\n",
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
    const health = await readResourceHealth([leaf, root], root);
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
      "memory.pressure": "some avg10=60.00 total=300\nfull avg10=40.00 total=200\n",
    });
    const health = await readResourceHealth([dir], dir);
    expect(health).toMatchObject({
      status: "strained",
      severity: "critical",
      resources: ["memory"],
      memory: { high: 1610612736, swapCurrent: 536870912 },
    });
  });
  it("distinguishes old OOM counters from new kills, and unlimited from unreadable", async () => {
    const dir = await fixture({ "memory.events": "high 8\nmax 0\noom 4\noom_kill 2\n" });
    const previous = await readResourceHealth([dir], dir);
    expect(previous.status).toBe("ok");
    await NodeFSP.writeFile(
      NodePath.join(dir, "memory.events"),
      "high 9\nmax 0\noom 5\noom_kill 3\n",
    );
    const next = await readResourceHealth([dir], dir, previous);
    expect(next).toMatchObject({
      status: "strained",
      severity: "critical",
      memory: { growth: { high: 1, oom: 1, oomKill: 1 } },
    });
    await NodeFSP.writeFile(NodePath.join(dir, "memory.high"), "garbage");
    expect((await readResourceHealth([dir], dir)).status).toBe("unknown");
  });
  it("uses the ancestor enforcing the tightest cap, not the service's unlimited leaf", async () => {
    const root = await fixture({
      "memory.high": "150",
      "memory.max": "300",
      "memory.current": "200",
    });
    const leaf = await fixture();
    expect(await readResourceHealth([leaf, root], leaf)).toMatchObject({
      status: "ok",
      memory: { high: 150, max: 300, current: 200 },
    });
  });
  it.each(["reclaim", "swap"])(
    "retains root %s pressure with a tighter child cap",
    async (signal) => {
      const root = await fixture({
        "memory.max": String(3.75 * 1024 ** 3),
        "memory.high": String(1.75 * 1024 ** 3),
        "memory.swap.max": String(512 * 1024 ** 2),
      });
      const child = await fixture({ "memory.max": String(1024 ** 3) });
      const previous = await readResourceHealth([child, root], root);
      await NodeFSP.writeFile(
        NodePath.join(root, signal === "reclaim" ? "memory.events" : "memory.swap.current"),
        signal === "reclaim" ? "high 1\nmax 0\noom 0\noom_kill 0\n" : String(200 * 1024 ** 2),
      );
      const next = await readResourceHealth([child, root], root, previous);
      expect(next).toMatchObject({
        status: "strained",
        resources: ["memory"],
        memory: {
          scope: root,
          max: 3.75 * 1024 ** 3,
          high: 1.75 * 1024 ** 3,
          ...(signal === "reclaim" ? { growth: { high: 1 } } : { swapGrowth: 200 * 1024 ** 2 }),
        },
      });
    },
  );
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
        "memory.pressure": "some avg10=30.00 total=300\nfull avg10=24.00 total=240\n",
      });
      if (accounting === "unreadable") await NodeFSP.unlink(NodePath.join(root, "memory.pressure"));
      const health = await readResourceHealth([child, root], root);
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
      expect((await readResourceHealth([child, root], root, health)).status).toBe(
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
      "memory.pressure": "some avg10=30.00 total=300\nfull avg10=24.00 total=240\n",
    });
    expect(await readResourceHealth([child, root], root)).toMatchObject({
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
        "io.pressure": "some avg10=30.00 total=300\nfull avg10=24.00 total=240\n",
      });
      if (accounting === "unreadable") await NodeFSP.unlink(NodePath.join(root, "io.pressure"));
      const health = await readResourceHealth([child, root], root);
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
      expect((await readResourceHealth([child, root], root, health)).status).toBe(
        accounting === "unreadable" ? "unknown" : "ok",
      );
    },
  );
  it.each([
    { allocation: 3.375, highGrowth: 0, maxGrowth: 0, swapGrowth: 0, io: 30, resources: ["io"] },
    { allocation: 3.75, highGrowth: 0, maxGrowth: 0, swapGrowth: 0, io: 0, resources: [] },
    {
      allocation: 3.375,
      highGrowth: 1,
      maxGrowth: 0,
      swapGrowth: 0,
      io: 30,
      resources: ["memory", "io"],
    },
    { allocation: 3.75, highGrowth: 0, maxGrowth: 1, swapGrowth: 0, io: 0, resources: ["memory"] },
    { allocation: 3.75, highGrowth: 0, maxGrowth: 0, swapGrowth: 1, io: 0, resources: ["memory"] },
  ])(
    "Rhea distinguishes static readings from growth: %j",
    async ({ allocation, highGrowth, maxGrowth, swapGrowth, io, resources }) => {
      const dir = await fixture({
        "memory.current": String(2 * 1024 ** 3),
        "memory.max": String(allocation * 1024 ** 3),
        "memory.high": String((allocation - 2) * 1024 ** 3),
        "memory.events": "high 2513\nmax 7\noom 0\noom_kill 0\n",
        "memory.swap.current": String(200 * 1024 ** 2),
        "memory.swap.max": String(512 * 1024 ** 2),
        "io.pressure": `some avg10=${io} total=300\nfull avg10=${io ? 24 : 0} total=240\n`,
      });
      const previous = await readResourceHealth([dir], dir);
      expect(previous.resources).toEqual(io ? ["io"] : []);
      await NodeFSP.writeFile(
        NodePath.join(dir, "memory.events"),
        `high ${2513 + highGrowth}\nmax ${7 + maxGrowth}\noom 0\noom_kill 0\n`,
      );
      await NodeFSP.writeFile(
        NodePath.join(dir, "memory.swap.current"),
        String(200 * 1024 ** 2 + swapGrowth),
      );
      const next = await readResourceHealth([dir], dir, previous);
      expect(next.resources).toEqual(resources);
      expect(next.severity).toBe("warning");
      expect(next.memory).toMatchObject({
        max: allocation * 1024 ** 3,
        high: (allocation - 2) * 1024 ** 3,
        growth: { max: maxGrowth },
        swapGrowth,
      });
    },
  );
  it("does not call an unreadable disk healthy", async () => {
    const dir = await fixture();
    expect(await readResourceHealth([dir], NodePath.join(dir, "missing"))).toMatchObject({
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
                  "high 1\nmax 0\noom 0\noom_kill 0\n",
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

it("reports CPU and I/O stalls and clears them only when the kernel reports no recent stalls", async () => {
  const dir = await fixture({
    "io.pressure": "some avg10=5.00 total=40\nfull avg10=2.00 total=20\n",
  });
  let now = 0;
  const cpu = makeCpuSampler([dir], { nowUsec: () => now });
  await cpu();
  await NodeFSP.writeFile(NodePath.join(dir, "cpu.pressure"), "some avg10=20.00 total=400000\n");
  await NodeFSP.writeFile(NodePath.join(dir, "cpu.stat"), "usage_usec 3800000\nnr_throttled 0\n");
  now = 2_000_000;
  const before = await readKernelResourceHealth([dir], dir, undefined, cpu);
  expect(before.resources).toEqual(["io", "cpu"]);
  await NodeFSP.writeFile(NodePath.join(dir, "cpu.pressure"), "some avg10=20.00 total=800000\n");
  await NodeFSP.writeFile(NodePath.join(dir, "cpu.stat"), "usage_usec 7600000\nnr_throttled 0\n");
  now = 4_000_000;
  expect((await readKernelResourceHealth([dir], dir, before, cpu)).resources).toEqual([
    "io",
    "cpu",
  ]);
  await NodeFSP.writeFile(
    NodePath.join(dir, "io.pressure"),
    "some avg10=0.00 total=40\nfull avg10=0.00 total=20\n",
  );
  now = 6_000_000;
  const after = await readKernelResourceHealth([dir], dir, before, cpu);
  expect(after.status).toBe("ok");
});

it("counts new events and swap across a changed RAM cap, but never subtracts counters from another cgroup", async () => {
  const dir = await fixture({ "memory.high": "150" });
  const previous = await readResourceHealth([dir], dir);
  await NodeFSP.writeFile(NodePath.join(dir, "memory.high"), "200");
  await NodeFSP.writeFile(
    NodePath.join(dir, "memory.events"),
    "high 1\nmax 0\noom 1\noom_kill 1\n",
  );
  expect((await readResourceHealth([dir], dir, previous)).memory?.growth.oomKill).toBe(1);
  const other = await fixture({
    "memory.high": "200",
    "memory.events": "high 9\nmax 0\noom 9\noom_kill 9\n",
  });
  const changedScope = await readResourceHealth([other], other, previous);
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

it.effect(
  "publishes CPU exhaustion and the first recovered window without waiting for the PSI average to decay",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => fixture());
      let now = 0;
      const cpu = makeCpuSampler([dir], { nowUsec: () => now, procRoot: dir });
      const values = yield* Stream.runCollect(
        resourceHealthChanges(dir, [dir], undefined, cpu).pipe(
          Stream.tap((sample) =>
            Effect.gen(function* () {
              if (sample.cpu?.window === null) {
                yield* Effect.promise(() =>
                  Promise.all([
                    NodeFSP.writeFile(
                      NodePath.join(dir, "cpu.pressure"),
                      "some avg10=20.00 total=400000\n",
                    ),
                    NodeFSP.writeFile(
                      NodePath.join(dir, "cpu.stat"),
                      "usage_usec 3800000\nnr_throttled 0\n",
                    ),
                  ]),
                );
                now = 2_000_000;
                yield* TestClock.adjust(2000);
              } else if (sample.resources.includes("cpu")) {
                now = 4_000_000;
                yield* TestClock.adjust(2000);
              }
            }),
          ),
          Stream.take(3),
        ),
      );
      expect(values.map((value) => value.resources)).toEqual([[], ["cpu"], []]);
      expect(values[2]?.cpu?.some.avg10).toBe(20);
    }),
);

it.effect(
  "observes swap growth on the shared cadence and clears it in the first quiet window",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => fixture({ "memory.swap.max": "536870912" }));
      const values = yield* Stream.runCollect(
        resourceHealthChanges(dir, [dir]).pipe(
          Stream.tap((sample) =>
            Effect.gen(function* () {
              if (sample.memory?.swapCurrent === 0) {
                yield* Effect.promise(() =>
                  NodeFSP.writeFile(NodePath.join(dir, "memory.swap.current"), "209715200"),
                );
                yield* TestClock.adjust(2000);
              } else if (sample.resources.includes("memory")) {
                yield* TestClock.adjust(2000);
              }
            }),
          ),
          Stream.take(3),
        ),
      );
      expect(values.map((value) => value.resources)).toEqual([[], ["memory"], []]);
      expect(values[1]?.memory?.swapGrowth).toBe(209715200);
      expect(values[2]?.memory?.swapCurrent).toBe(209715200);
    }),
);

it.effect("a tick during an event read advances CPU and memory together at the next boundary", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => fixture());
    const samples = yield* Queue.unbounded<MateResourceHealth>();
    let calls = 0;
    const cpu = async () => ({
      cpu: { some: { avg10: 0, total: ++calls }, full: null, window: null },
      strained: false,
      unavailable: [],
    });
    yield* Effect.forkScoped(
      Stream.runForEach(resourceHealthChanges(dir, [dir], undefined, cpu), (value) =>
        Queue.offer(samples, value),
      ),
    );
    yield* Queue.take(samples);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    reads.beforeCurrent = async () => {
      reads.beforeCurrent = undefined;
      entered();
      await blocked;
    };
    yield* Effect.promise(() =>
      NodeFSP.writeFile(NodePath.join(dir, "memory.events"), "high 1\nmax 0\noom 0\noom_kill 0\n"),
    );
    yield* Effect.promise(() => started);
    yield* TestClock.adjust(2000);
    release();
    const event = yield* Queue.take(samples);
    expect(event.memory?.growth.high).toBe(1);
    expect(event.cpu?.some.total).toBe(1);
    const tick = yield* Queue.take(samples);
    expect(tick.cpu?.some.total).toBe(2);
    yield* TestClock.adjust(2000);
    const recovered = yield* Queue.take(samples);
    expect(recovered.memory?.growth.high).toBe(0);
    expect(recovered.resources).toEqual([]);
  }),
);
