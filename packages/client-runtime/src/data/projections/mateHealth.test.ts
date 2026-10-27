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
  pids: null,
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
    scope: hqMateHealthScope("org", "ada"),
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
  it("Independent HQ health is live without health embedded in the Mate record", () => {
    expect(project(relay(health, true))).toMatchObject({ health, live: true });
    expect(mateHealthCopy("Ada", project(relay(health, true)))?.title).toBe(
      "Ada has been swapping to disk for 5 minutes — work is slow.",
    );
  });

  it("uses HQ's independent live health even without a conversation overview", () => {
    expect(project(relay(health, true))).toMatchObject({ health, live: true });
    expect(mateHealthCopy("Skákala", project(relay(health, true)))?.title).not.toContain(
      "last-known",
    );
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
  it("Decision: stale last-known health is not shown", () => {
    expect(project(relay()).health).toEqual(health);
    expect(mateHealthCopy("Skákala", project(relay()))).toBeNull();
  });
  it.each(["direct", "HQ"])(
    "A lost %s health source hides retained notice during reconnect grace",
    (source) => {
      const inputs = source === "direct" ? direct() : relay(health, true);
      const lost: AccountInput = {
        kind: "stream",
        key: source === "direct" ? linkKeys.mateHealth("ada") : linkKeys.hq("org"),
        now: 1,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "transient", message: "connection lost" },
        },
      };
      expect(mateHealthCopy("Ada", project([...inputs, lost]))).toBeNull();
    },
  );
  it("HQ changes health freshness without replacing the same source sample", () => {
    const stored = relay({ ...health, evidence: { ...evidence, status: "ok" } }, false).map(
      (input): AccountInput => (input.kind === "rows" ? { ...input, generation: 1 } : input),
    );
    const inputs = [...relay(health, true), ...stored];
    expect(project(inputs)).toEqual({ health, live: false });
    expect(mateHealthCopy("Ada", project(inputs))).toBeNull();
    const resumed = relay(health, true).filter((input) => input.kind === "rows");
    expect(project([...inputs, ...resumed])).toEqual({ health, live: true });
  });
  it("A stored HQ confirmation cannot make a live direct health sample stale", () => {
    const stored = relay(health, true).map((input): AccountInput =>
      input.kind === "rows"
        ? {
            ...input,
            rows: input.rows.map((row) => ({
              ...row,
              revision: { kind: "mate-attention", ...health.source, live: false },
            })),
          }
        : input,
    );
    expect(project([...direct(), ...stored])).toEqual({ health, live: true });
  });
  it("does not invent health for a Mate with no sample", () => {
    expect(mateHealthCopy("Skákala", project([]))).toBeNull();
  });
  it.each([
    {
      sentence: "Sustained full memory stalls show one calm warning",
      pressure: {
        some: { avg10: 0, total: 3 },
        full: { avg10: 0, avg60: 10, avg300: 10, total: 2 },
      },
      oomKill: 0,
      severity: "warning" as const,
    },
    {
      sentence: "Sustained partial memory stalls show one calm warning",
      pressure: { some: { avg10: 0, avg60: 40, avg300: 40, total: 3 }, full: null },
      oomKill: 0,
      severity: "warning" as const,
    },
    {
      sentence: "An OOM kill since the preceding sample shows a critical notice",
      pressure: null,
      oomKill: 1,
      severity: "critical" as const,
    },
  ])("$sentence", ({ pressure, oomKill, severity }) => {
    const value: MateHealth = {
      ...health,
      evidence: {
        ...evidence,
        severity,
        memory: {
          ...evidence.memory!,
          growth: { high: 0, max: 0, oom: 0, oomKill },
          oomKilledAt: oomKill ? 1791806400000 : null,
          swapCurrent: 0,
          swapMax: 0,
          pressure,
        },
      },
    };
    expect(mateHealthCopy("Toby", project(direct(value)))).toEqual({
      severity,
      title: oomKill
        ? "Toby ran out of memory and the system stopped a process."
        : "Toby has been swapping to disk for 5 minutes — work is slow.",
      description: "Close unused browsers or raise minRam in Zerops.",
    });
  });
  it.each([true, false])(
    "Decision: one derivation per state; consumers never recompute it. (live=%s)",
    (live) => {
      const value: MateHealth = {
        ...health,
        evidence: { ...evidence, resources: ["io", "memory", "pids"], severity: "critical" },
      };
      const baseline = mateHealthCopy("Toby", project(relay(value, live)));
      if (live) {
        expect(baseline?.severity).toBe("critical");
        expect(baseline?.title).toBe("Toby has been waiting on disk for 5 minutes.");
        expect(baseline?.description).toContain("Close unused browsers");
      } else expect(baseline).toBeNull();
      const changed: MateHealth = {
        ...value,
        evidence: { ...value.evidence, memory: null, io: null, disk: { free: 0, total: 5000 } },
      };
      expect(mateHealthCopy("Toby", project(relay(changed, live)))).toEqual(baseline);
      if (live) expect(baseline?.description).not.toContain("state disk is full");
    },
  );
  it.each(["warning", "critical"] as const)(
    "The notice retains the owner's %s severity even when raw counters disagree",
    (severity) => {
      const value: MateHealth = {
        ...health,
        evidence: {
          ...evidence,
          severity,
          disk: { free: severity === "warning" ? 0 : 1000, total: 5000 },
        },
      };
      expect(mateHealthCopy("Toby", project(direct(value)))?.severity).toBe(severity);
    },
  );

  it.each(["ok", "unknown"] as const)(
    "An owner-reported %s state stays quiet despite raw pressure",
    (status) => {
      expect(
        mateHealthCopy("Toby", project(direct({ ...health, evidence: { ...evidence, status } }))),
      ).toBeNull();
    },
  );
});
