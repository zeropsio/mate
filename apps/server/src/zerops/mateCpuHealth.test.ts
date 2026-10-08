// @effect-diagnostics nodeBuiltinImport:off -- kernel evidence fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "@effect/vitest";
import { makeCpuSampler } from "./mateCpuHealth.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })));
});
async function rig(cpus = "0-1", quota = "max 100000") {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-cpu-"));
  dirs.push(dir);
  const proc = NodePath.join(dir, "proc");
  await NodeFSP.mkdir(proc);
  let now = 0;
  async function write(usage: number, some: number, full = some, throttled = 0, avg10 = 3) {
    await Promise.all([
      NodeFSP.writeFile(NodePath.join(dir, "cpu.max"), quota),
      NodeFSP.writeFile(NodePath.join(dir, "cpuset.cpus.effective"), cpus),
      NodeFSP.writeFile(
        NodePath.join(dir, "cpu.stat"),
        `usage_usec ${usage}\nnr_throttled ${throttled}\n`,
      ),
      NodeFSP.writeFile(
        NodePath.join(dir, "cpu.pressure"),
        `some avg10=${avg10} total=${some}\nfull avg10=${avg10} total=${full}\n`,
      ),
    ]);
  }
  await write(0, 0);
  const sampler = makeCpuSampler([dir], {
    nowUsec: () => now,
    procRoot: proc,
    ticksPerSecond: 100,
  });
  await sampler();
  return {
    dir,
    proc,
    write,
    sample: (elapsed = 2_000_000) => {
      now += elapsed;
      return sampler();
    },
  };
}

it("does not warn an idle container for residual PSI averages or small current scheduler waits", async () => {
  const r = await rig();
  await r.write(5111, 1826, 1365);
  expect(await r.sample(2_003_832)).toMatchObject({
    strained: false,
    cpu: { window: { saturated: false, capacityCpus: 2 } },
  });
});
it("warns when current runnable demand exhausts the container's measured CPU allocation", async () => {
  const r = await rig();
  await r.write(3_800_000, 400_000);
  expect(await r.sample()).toMatchObject({
    strained: true,
    cpu: { window: { usageUsec: 3_800_000, someUsec: 400_000, saturated: true } },
  });
});
it("clears CPU pressure on the first recovered window even while avg10 still reports the spike", async () => {
  const r = await rig();
  await r.write(3_800_000, 400_000);
  expect((await r.sample()).strained).toBe(true);
  await r.write(3_805_000, 400_000, 400_000, 0, 25);
  expect((await r.sample()).strained).toBe(false);
});
it("recognizes a fractional CPU quota and current kernel throttling", async () => {
  const r = await rig("0-3", "50000 100000");
  await r.write(900_000, 200_000, 100_000, 1);
  expect(await r.sample()).toMatchObject({
    strained: true,
    cpu: { window: { capacityCpus: 0.5, throttledPeriods: 1 } },
  });
});
it("does not warn for a short throttled spike when current window demand fits the allocation", async () => {
  const r = await rig("0-3", "50000 100000");
  await r.write(50_000, 50_000, 50_000, 1, 25);
  expect((await r.sample()).strained).toBe(false);
});
it("does not treat an old throttling counter or an absent comparison as current pressure", async () => {
  const r = await rig("0", "50000 100000");
  await r.write(0, 0, 0, 10);
  const sampler = makeCpuSampler([r.dir], {
    nowUsec: () => 2_000_000,
    procRoot: r.proc,
    ticksPerSecond: 100,
  });
  expect(await sampler()).toMatchObject({ strained: false, cpu: { window: null } });
  expect(await sampler()).toMatchObject({ strained: false, cpu: { window: null } });
});
it("withholds a CPU verdict when allocation evidence is unreadable", async () => {
  const r = await rig();
  await NodeFSP.writeFile(NodePath.join(r.dir, "cpuset.cpus.effective"), "invalid");
  expect(await r.sample()).toMatchObject({
    strained: false,
    cpu: null,
    unavailable: ["cpu-allocation"],
  });
});

async function processFixture(proc: string, ticks: number, start = "1000", name = "MainThread") {
  const dir = NodePath.join(proc, "42");
  await NodeFSP.mkdir(dir, { recursive: true });
  const fields = Array.from({ length: 20 }, () => "0");
  fields[0] = "R";
  fields[11] = String(ticks);
  fields[19] = start;
  await Promise.all([
    NodeFSP.writeFile(NodePath.join(dir, "stat"), `42 (${name}) ${fields.join(" ")}`),
    NodeFSP.writeFile(
      NodePath.join(dir, "cgroup"),
      "0::/system.slice/system-zerops.slice/zerops@vscode.service\n",
    ),
  ]);
  return dir;
}
it("attributes current process CPU across all threads using the kernel clock tick rate", async () => {
  const r = await rig();
  const dir = await processFixture(r.proc, 0);
  await NodeFSP.symlink("/usr/lib/code-server/lib/node", NodePath.join(dir, "exe"));
  await r.sample();
  await processFixture(r.proc, 360);
  await r.write(3_800_000, 400_000);
  expect(await r.sample()).toMatchObject({
    cpu: {
      window: {
        consumer: { pid: 42, name: "code-server (node)", cpuCores: 1.8 },
      },
    },
  });
});
it("does not blame an exited process or a replacement that reused its PID", async () => {
  const r = await rig();
  await processFixture(r.proc, 0);
  await r.sample();
  await processFixture(r.proc, 360, "2000");
  await r.write(3_800_000, 400_000);
  expect(await r.sample()).toMatchObject({ strained: true, cpu: { window: { consumer: null } } });
});
it("names npm when the kernel identifies an npm process", async () => {
  const r = await rig();
  const dir = await processFixture(r.proc, 0, "1000", "npm install");
  await NodeFSP.symlink("/usr/bin/node", NodePath.join(dir, "exe"));
  await r.sample();
  await processFixture(r.proc, 360, "1000", "npm install");
  await r.write(3_800_000, 400_000);
  expect((await r.sample()).cpu?.window?.consumer?.name).toBe("code-server (npm install)");
});
it.each([
  { quota: "max 100000", cpus: "0-1", useRoot: true },
  { quota: "50000 100000", cpus: "0-1", useRoot: false },
])(
  "uses container evidence including sibling workloads, or a tighter Mate service allocation: $quota",
  async ({ quota, cpus, useRoot }) => {
    const r = await rig();
    const leaf = NodePath.join(r.dir, "service");
    await NodeFSP.mkdir(leaf);
    for (const file of ["cpu.stat", "cpu.pressure"])
      await NodeFSP.copyFile(NodePath.join(r.dir, file), NodePath.join(leaf, file));
    await NodeFSP.writeFile(NodePath.join(leaf, "cpu.max"), quota);
    await NodeFSP.writeFile(NodePath.join(leaf, "cpuset.cpus.effective"), cpus);
    let now = 0;
    const sample = makeCpuSampler([leaf, r.dir], { nowUsec: () => now, procRoot: r.proc });
    await sample();
    const scope = useRoot ? r.dir : leaf;
    await NodeFSP.writeFile(
      NodePath.join(scope, "cpu.stat"),
      `usage_usec ${useRoot ? 3800000 : 900000}\nnr_throttled 0\n`,
    );
    await NodeFSP.writeFile(NodePath.join(scope, "cpu.pressure"), "some avg10=20 total=400000\n");
    now = 2_000_000;
    expect(await sample()).toMatchObject({
      strained: true,
      cpu: { window: { scope, capacityCpus: useRoot ? 2 : 0.5 } },
    });
  },
);
it("starts a new comparison after counters reset or the CPU allocation changes", async () => {
  const r = await rig();
  await r.write(3_800_000, 400_000);
  expect((await r.sample()).strained).toBe(true);
  await r.write(0, 0);
  expect(await r.sample()).toMatchObject({ strained: false, cpu: { window: null } });
  await NodeFSP.writeFile(NodePath.join(r.dir, "cpu.max"), "50000 100000");
  expect(await r.sample()).toMatchObject({ strained: false, cpu: { window: null } });
});
it("a tighter Mate service cap cannot hide CPU exhausted by container siblings", async () => {
  const r = await rig();
  const leaf = NodePath.join(r.dir, "service");
  await NodeFSP.mkdir(leaf);
  for (const file of ["cpu.stat", "cpu.pressure"])
    await NodeFSP.copyFile(NodePath.join(r.dir, file), NodePath.join(leaf, file));
  await NodeFSP.writeFile(NodePath.join(leaf, "cpu.max"), "50000 100000");
  await NodeFSP.writeFile(NodePath.join(leaf, "cpuset.cpus.effective"), "0-1");
  let now = 0;
  const sample = makeCpuSampler([leaf, r.dir], { nowUsec: () => now, procRoot: r.proc });
  await sample();
  await r.write(3_800_000, 400_000);
  now = 2_000_000;
  expect(await sample()).toMatchObject({
    strained: true,
    cpu: { window: { scope: r.dir, capacityCpus: 2 } },
  });
});
