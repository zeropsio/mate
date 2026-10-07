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
    max: null,
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
  it("names measured starvation, the cap, actions, swap and severity", () => {
    const copy = mateHealthCopy("Skákala", project(direct()));
    expect(copy?.title).toBe("Skákala is short on memory — the container is capped at 1.5 GB");
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
  it("says RAM has not reached the container only with live cap evidence", () => {
    const read = { health, live: true, configuredMinimumBytes: 3 * 1024 ** 3 };
    expect(mateHealthCopy("Skákala", read)?.description).toContain("hasn't reached the container");
    expect(mateHealthCopy("Skákala", { ...read, live: false })?.description).not.toContain(
      "hasn't reached",
    );
  });
});
