// @effect-diagnostics nodeBuiltinImport:off -- procfs, statfs and kernel notification boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { resourceHealthChanges, readResourceHealth } from "./mateResourceHealth.ts";

const dirs: string[] = [];
async function fixture(values: Record<string, string> = {}) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-health-"));
  dirs.push(dir);
  const files = {
    "memory.current": "100",
    "memory.high": "max",
    "memory.max": "max",
    "memory.events": "high 0\noom 0\noom_kill 0\n",
    "memory.swap.current": "0",
    "memory.swap.max": "0",
    "memory.pressure": "some avg10=0.00 total=0\nfull avg10=0.00 total=0\n",
    "cpu.pressure": "some avg10=0.00 total=0\nfull avg10=0.00 total=0\n",
    "io.pressure": "some avg10=0.00 total=0\nfull avg10=0.00 total=0\n",
    ...values,
  };
  await Promise.all(
    Object.entries(files).map(([name, text]) => NodeFSP.writeFile(NodePath.join(dir, name), text)),
  );
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })));
});
describe("container resource evidence", () => {
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
    const dir = await fixture({ "memory.events": "high 8\noom 4\noom_kill 2\n" });
    const previous = await readResourceHealth([dir], dir);
    expect(previous.status).toBe("ok");
    await NodeFSP.writeFile(NodePath.join(dir, "memory.events"), "high 9\noom 5\noom_kill 3\n");
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
    const root = await fixture({ "memory.high": "150", "memory.current": "200" });
    const leaf = await fixture();
    expect(await readResourceHealth([leaf, root], leaf)).toMatchObject({
      status: "strained",
      memory: { high: 150, current: 200 },
    });
  });
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
          sample.status === "ok"
            ? Effect.promise(() => NodeFSP.writeFile(NodePath.join(dir, "memory.high"), "50"))
            : Effect.void,
        ),
        Stream.take(2),
      ),
    );
    expect(values.map((value) => value.status)).toEqual(["ok", "strained"]);
  }),
);

it("reports CPU and I/O stalls and clears them only when the kernel reports no recent stalls", async () => {
  const dir = await fixture({
    "cpu.pressure": "some avg10=20.00 total=30\n",
    "io.pressure": "some avg10=5.00 total=40\nfull avg10=2.00 total=20\n",
  });
  const before = await readResourceHealth([dir], dir);
  expect(before.resources).toEqual(["disk", "cpu"]);
  expect((await readResourceHealth([dir], dir, before)).resources).toEqual(["disk", "cpu"]);
  await NodeFSP.writeFile(NodePath.join(dir, "cpu.pressure"), "some avg10=0.00 total=30\n");
  await NodeFSP.writeFile(
    NodePath.join(dir, "io.pressure"),
    "some avg10=0.00 total=40\nfull avg10=0.00 total=20\n",
  );
  const after = await readResourceHealth([dir], dir, before);
  expect(after.status).toBe("ok");
});

it("counts new kills across a changed RAM cap, but never subtracts counters from another cgroup", async () => {
  const dir = await fixture({ "memory.high": "150" });
  const previous = await readResourceHealth([dir], dir);
  await NodeFSP.writeFile(NodePath.join(dir, "memory.high"), "200");
  await NodeFSP.writeFile(NodePath.join(dir, "memory.events"), "high 1\noom 1\noom_kill 1\n");
  expect((await readResourceHealth([dir], dir, previous)).memory?.growth.oomKill).toBe(1);
  const other = await fixture({
    "memory.high": "200",
    "memory.events": "high 9\noom 9\noom_kill 9\n",
  });
  expect((await readResourceHealth([other], other, previous)).memory?.growth.oomKill).toBe(0);
});

it.effect("reports missing notification coverage alongside the remaining measured limits", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => fixture({ "memory.high": "150" }));
    const values = yield* Stream.runCollect(
      resourceHealthChanges(NodePath.join(dir, "missing-state"), [dir]).pipe(Stream.take(1)),
    );
    expect(values[0]).toMatchObject({ status: "unknown", memory: { high: 150 } });
    expect(values[0]?.unavailable).toContain("kernel-events");
  }),
);
