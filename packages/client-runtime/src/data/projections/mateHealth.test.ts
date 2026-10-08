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
    pressure: { some: { avg10: 60, total: 3 }, full: { avg10: 40, total: 2 } },
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
        some: { avg10: 25, total: 500000 },
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
  it("names measured starvation, the cap, actions, swap and severity", () => {
    const copy = mateHealthCopy("Skákala", project(direct()));
    expect(copy?.title).toBe(
      "Skákala is under memory pressure — the container is capped at 3.75 GB",
    );
    expect(copy?.severity).toBe("critical");
    expect(copy?.description).toContain("Close idle terminal agents or the IDE");
    expect(copy?.description).toContain("Container swap is full");
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
    { live: true, growth: 0, swapGrowth: 0, io: false, title: null },
    { live: false, growth: 0, swapGrowth: 0, io: false, title: null },
    { live: true, growth: 0, swapGrowth: 0, io: true, title: "Rhea is slowed by I/O stalls" },
    {
      live: true,
      growth: 1,
      swapGrowth: 1,
      io: true,
      title: "Rhea is under memory pressure — the container is capped at 3.38 GB",
    },
    {
      live: false,
      growth: 1,
      swapGrowth: 0,
      io: false,
      title:
        "Rhea · last-known health is under memory pressure — the container is capped at 3.38 GB",
    },
  ])(
    "Rhea copy follows measured pressure rather than allocation configuration: %j",
    ({ live, growth, swapGrowth, io, title }) => {
      const value: MateHealth = {
        ...health,
        evidence: {
          ...evidence,
          // Even an older server's false memory flag must not manufacture a notice.
          resources: io ? ["memory", "disk"] : ["memory"],
          severity: "warning",
          memory: {
            ...evidence.memory!,
            current: 2 * 1024 ** 3,
            max: 3.375 * 1024 ** 3,
            high: 1.375 * 1024 ** 3,
            events: { high: 2513, max: 0, oom: 0, oomKill: 0 },
            growth: { high: growth, max: 0, oom: 0, oomKill: 0 },
            swapGrowth,
            pressure: { some: { avg10: 0, total: 0 }, full: { avg10: 0, total: 0 } },
            swapCurrent: 200 * 1024 ** 2,
            swapMax: 512 * 1024 ** 2,
          },
          io: io ? { some: { avg10: 30, total: 300 }, full: { avg10: 24, total: 240 } } : null,
        },
      };
      const copy = mateHealthCopy("Rhea", { health: value, live });
      expect(copy?.title ?? null).toBe(title);
      expect(copy?.description ?? "").not.toContain("hasn't reached");
      if (growth) expect(copy?.description).toContain("Memory reclaim threshold: 1.38 GB");
      if (swapGrowth) expect(copy?.description).toContain("swap use is growing");
      if (io) expect(copy?.description).toContain("I/O stalls");
    },
  );
});
