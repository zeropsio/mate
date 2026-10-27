import { describe, expect, it } from "vite-plus/test";
import type { UsageReport } from "@t3tools/contracts";
import { emptyAccount, linkKeys } from "../model.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { HQ_SLOW } from "./freshness.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { agentUsageId, agentUsageScope } from "../families/agentUsage.ts";
import { agentUsage } from "./agentUsage.ts";

const key = { orgId: "org", owner: "query" };
const scope = agentUsageScope(key.orgId, key.owner);
const report = { totals: { records: "1" } } as UsageReport;
const baseline: AccountInput = {
  kind: "baseline-commit",
  scope,
  generation: 0,
  via: "hq-stream",
  members: [agentUsageId(key.orgId, key.owner)],
  rows: [
    {
      family: "agentUsage",
      id: agentUsageId(key.orgId, key.owner),
      value: report,
      revision: { kind: "hq", incarnation: "hq", revision: 1 },
    },
  ],
};

describe("HQ recorded usage", () => {
  it.each([
    {
      name: "an unread report cannot claim zero consumption",
      inputs: [],
      kind: "reading",
      stale: undefined,
    },
    {
      name: "HQ report is authoritative without any Mate connection",
      inputs: [baseline],
      kind: "read",
      stale: true,
    },
    {
      name: "HQ outage retains permitted consumption labelled last known",
      inputs: [baseline, { kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } }],
      kind: "read",
      stale: true,
    },
    {
      name: "denial withholds protected consumption",
      inputs: [
        baseline,
        {
          kind: "access",
          family: "agentUsage",
          id: agentUsageId(key.orgId, key.owner),
          access: "denied",
        },
      ],
      kind: "unavailable",
      stale: undefined,
    },
  ] as const)("$name", ({ inputs, kind, stale }) => {
    const state = inputs.reduce(
      (state, input) => reduceAccount(state, input as AccountInput).state,
      emptyAccount,
    );
    expect(agentUsage.derive(readsOfState(state), key)).toMatchObject({
      kind,
      ...(stale === undefined ? {} : { stale }),
    });
  });
});

describe("usage waiting on HQ", () => {
  const link = linkKeys.hq(key.orgId);
  const apps = hqAppsScope(key.orgId);
  const event = (target: string, streamEvent: StreamEvent): AccountInput =>
    ({ kind: "stream", key: target, now: 0, event: streamEvent }) as AccountInput;
  const connected = [
    event(link, { kind: "demand", demanded: true }),
    event(link, { kind: "handshake" }),
  ];
  it.each([
    { name: "says it waits for HQ until HQ is asked for it", inputs: [], line: "Waiting for HQ…" },
    {
      name: "says HQ is slow while HQ works on the navigation it waits for",
      inputs: [
        ...connected,
        event(apps, { kind: "demand", demanded: true }),
        event(apps, { kind: "attempt" }),
        event(apps, { kind: "handshake" }),
        event(apps, { kind: "grace-over", since: 0 }),
      ],
      line: HQ_SLOW,
    },
    {
      name: "says nothing more than reading while its own read is under way",
      inputs: [
        ...connected,
        event(link, { kind: "baseline-committed" }),
        event(scope, { kind: "demand", demanded: true }),
        event(scope, { kind: "attempt" }),
        event(scope, { kind: "handshake" }),
      ],
      line: undefined,
    },
  ])("$name", ({ inputs, line }) => {
    const state = inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
    expect(agentUsage.derive(readsOfState(state), key)).toEqual({
      kind: "reading",
      ...(line === undefined ? {} : { line }),
    });
  });
});
