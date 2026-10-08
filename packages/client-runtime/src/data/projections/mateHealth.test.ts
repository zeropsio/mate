import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type MateHealth, type MateResourceHealth } from "@t3tools/contracts";
import { emptyAccount, linkKeys, type StreamKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqMateHealthScope, mateHealthScope } from "../families/mateHealth.ts";
import { mateHealth, mateHealthCopy } from "./mateHealth.ts";

const key = { orgId: "org", projectId: "ada" };
const evidence: MateResourceHealth = {
  status: "strained",
  severity: "critical",
  resources: ["memory"],
  memory: {
    current: 1700000000,
    high: 1610612736,
    max: 3.75 * 1024 ** 3,
    events: { high: 2, oom: 0, oomKill: 0 },
    growth: { high: 1, oom: 0, oomKill: 0 },
    pressure: {
      some: { avg10: 60, avg60: 40, avg300: 40, total: 3 },
      full: { avg10: 40, avg60: 10, avg300: 10, total: 2 },
    },
    swapCurrent: 536870912,
    swapMax: 536870912,
  },
  disk: { free: 1000, total: 5000 },
  cpu: null,
  io: null,
  unavailable: [],
};
const health: MateHealth = {
  source: {
    environmentId: EnvironmentId.make("env-ada"),
    epoch: 2,
    incarnation: "run",
    revision: 4,
  },
  sampledAt: "2026-10-07T12:00:00Z",
  evidence,
};
const lives = (key: StreamKey): AccountInput[] => [
  { kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key, now: 0, event: { kind: "attempt" } },
  { kind: "stream", key, now: 0, event: { kind: "handshake" } },
  { kind: "stream", key, now: 0, event: { kind: "baseline-committed" } },
];
function project(inputs: AccountInput[]) {
  return mateHealth.derive(
    readsOfState(inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount)),
    key,
  );
}
const relay = (value = health, live = false): AccountInput[] => [
  ...(live
    ? [
        ...lives(linkKeys.hq("org")),
        ...lives(hqMateScope("org", "ada")),
        ...lives(hqMateHealthScope("org", "ada")),
      ]
    : []),
  {
    kind: "rows",
    scope: hqMateScope("org", "ada"),
    generation: live ? 1 : 0,
    method: "push",
    via: "hq-stream",
    rows: [
      {
        family: "mateHealth",
        id: "ada",
        value,
        revision: { kind: "mate-attention", ...value.source, live },
      },
      {
        family: "hqMate",
        id: "ada",
        revision: { kind: "hq", incarnation: "hq", revision: 1 },
        value: {
          health: value,
          healthState: live ? "live" : "stored",
          presence: { online: live, overview: live ? "live" : "stored", since: value.sampledAt },
          overview: {
            identity: {
              environmentId: value.source.environmentId,
              serverVersion: "0.14.42",
              update: null,
            },
            main: null,
            threads: { list: [], omitted: 0 },
            logins: {},
            crew: { status: "off" },
          },
          attention: null,
          attentionState: "none",
        },
      },
    ],
  },
];
const direct = (value = health): AccountInput[] => [
  ...lives(linkKeys.mateHealth("ada")),
  ...lives(mateHealthScope("ada")),
  {
    kind: "rows",
    scope: mateHealthScope("ada"),
    generation: 1,
    method: "push",
    via: "mate-direct",
    rows: [
      {
        family: "mateHealth",
        id: "ada",
        revision: { kind: "mate-attention", ...value.source, live: true },
        value,
      },
    ],
  },
];
describe("health at the screen boundary", () => {
  const cpuHealth = (saturated: boolean): MateHealth => ({
    ...health,
    evidence: {
      ...evidence,
      status: "strained",
      resources: ["cpu"],
      severity: "warning",
      memory: null,
      cpu: {
        some: { avg10: 25, avg60: 40, avg300: 40, total: 500000 },
        full: null,
        window: {
          scope: "/sys/fs/cgroup",
          elapsedUsec: 2000000,
          usageUsec: 3800000,
          someUsec: 400000,
          fullUsec: null,
          capacityCpus: 2,
          throttledPeriods: 0,
          saturated,
          consumer: { pid: 42, name: "code-server (node)", cpuCores: 1.8 },
        },
      },
    },
  });
  it("names the measured CPU consumer and allocation without guessing an update is still starting", () => {
    const copy = mateHealthCopy("Hardy", project(relay(cpuHealth(true), true)));
    expect(copy?.title).toBe("Hardy is under CPU pressure");
    expect(copy?.description).toContain("1.9 CPU cores used out of a limit of 2 over 2 seconds");
    expect(copy?.description).toContain("code-server (node) (PID 42) used 1.8 CPU cores");
    expect(copy?.description).not.toContain("starting");
  });
  it("shows no CPU notice for an old average or a recovered current window", () => {
    const old = cpuHealth(true);
    const { window: _, ...averages } = old.evidence.cpu!;
    expect(
      mateHealthCopy(
        "Hardy",
        project(direct({ ...old, evidence: { ...old.evidence, cpu: averages } })),
      ),
    ).toBeNull();
    expect(mateHealthCopy("Hardy", project(direct(cpuHealth(false))))).toBeNull();
  });
  it("says attribution is unknown when runnable work exhausts CPU but the consumer has exited", () => {
    const value = cpuHealth(true);
    const copy = mateHealthCopy(
      "Hardy",
      project(
        direct({
          ...value,
          evidence: {
            ...value.evidence,
            cpu: {
              ...value.evidence.cpu!,
              window: { ...value.evidence.cpu!.window!, consumer: null },
            },
          },
        }),
      ),
    );
    expect(copy?.description).toContain("No current process could be attributed");
    expect(copy?.description).not.toContain("Close idle container workloads");
  });
  it("uses HQ's independent live health even without a conversation overview", () => {
    expect(project(relay(health, true))).toMatchObject({ health, live: true });
    expect(mateHealthCopy("Skákala", project(relay(health, true)))?.title).not.toContain(
      "last-known",
    );
  });
  it("retains HQ's report when unreachable and labels it last-known", () => {
    const copy = mateHealthCopy("Skákala", project(relay()));
    expect(copy?.title).toContain("last-known health");
    expect(copy?.description).toContain("current resources are unknown");
  });
  it("an old live run cannot hide a newer stored warning", () => {
    const older = {
      ...health,
      source: { ...health.source, epoch: 1 },
      evidence: { ...evidence, status: "ok" as const, resources: [] },
    };
    expect(project([...relay(), ...direct(older)])).toMatchObject({ health, live: false });
  });
  it("a newer direct sample clears a stored warning", () => {
    const newer = {
      ...health,
      source: { ...health.source, revision: 5 },
      evidence: { ...evidence, status: "ok" as const, resources: [] },
    };
    expect(mateHealthCopy("Skákala", project([...relay(), ...direct(newer)]))).toBeNull();
  });
  it("does not invent health for a Mate with no sample", () => {
    expect(mateHealthCopy("Skákala", project([]))).toBeNull();
  });
  it.each([
    {
      sentence: "Routine reclaim, swap growth and brief stalls leave the composer quiet",
      pressure: { some: { avg10: 5, total: 3 }, full: null },
      oomKill: 0,
      severity: null,
    },
    {
      sentence: "Sustained full memory stalls show one calm warning",
      pressure: {
        some: { avg10: 5, total: 3 },
        full: { avg10: 0, avg60: 10, avg300: 10, total: 2 },
      },
      oomKill: 0,
      severity: "warning",
    },
    {
      sentence: "Sustained partial memory stalls show one calm warning",
      pressure: { some: { avg10: 5, avg60: 40, avg300: 40, total: 3 }, full: null },
      oomKill: 0,
      severity: "warning",
    },
    {
      sentence:
        "A minute of stalls without sustained five-minute evidence leaves the composer quiet",
      pressure: {
        some: { avg10: 50, avg60: 40, avg300: 39, total: 3 },
        full: { avg10: 20, avg60: 10, avg300: 9, total: 2 },
      },
      oomKill: 0,
      severity: null,
    },
    {
      sentence: "An OOM kill since the preceding sample shows a critical notice",
      pressure: null,
      oomKill: 1,
      severity: "critical",
    },
    {
      sentence: "Full swap and failed allocations without kills leave the composer quiet",
      pressure: null,
      oomKill: 0,
      severity: null,
    },
  ])("$sentence", ({ pressure, oomKill, severity }) => {
    const value: MateHealth = {
      ...health,
      evidence: {
        ...evidence,
        memory: {
          ...evidence.memory!,
          growth: { high: 1, max: 1, oom: 1, oomKill },
          swapGrowth: 1024,
          pressure,
        },
      },
    };
    const copy = mateHealthCopy("Toby", project(direct(value)));
    if (severity === null) expect(copy).toBeNull();
    else {
      expect(copy).toEqual({
        severity,
        title: "Toby is short of memory — work may be slow",
        description:
          "Close idle terminal agents or the IDE in the container, or raise the RAM limit in Zerops.",
      });
    }
  });
  it.each(["io", "cpu"] as const)("A brief %s stall leaves the composer quiet", (resource) => {
    const value = cpuHealth(true);
    const pressure = { some: { avg10: 50, total: 300 }, full: null };
    expect(
      mateHealthCopy(
        "Toby",
        project(
          direct({
            ...value,
            evidence: {
              ...value.evidence,
              cpu: resource === "cpu" ? { ...value.evidence.cpu!, ...pressure } : null,
              io: resource === "io" ? pressure : null,
            },
          }),
        ),
      ),
    ).toBeNull();
  });
});
it.each([1000, 0])(
  "Sustained I/O stalls remain distinct from disk exhaustion with free=%s",
  (free) => {
    const copy = mateHealthCopy("Rhea", {
      live: true,
      health: {
        ...health,
        evidence: {
          ...evidence,
          disk: { free, total: 5000 },
          memory: null,
          io: {
            some: { avg10: 30, total: 300 },
            full: { avg10: 24, avg60: 10, avg300: 10, total: 240 },
          },
        },
      },
    });
    expect(copy?.severity).toBe(free === 0 ? "critical" : "warning");
    expect(copy?.description).toContain("I/O stalls");
    if (free === 0) expect(copy?.title).toContain("no free space");
  },
);
