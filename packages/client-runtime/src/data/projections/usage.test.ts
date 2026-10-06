import { describe, expect, it } from "vite-plus/test";

import { projectTopology } from "../../zerops/topology.ts";
import { usageFamily, usageOwnerOf, usageScope, type ContainerUsage } from "../families/usage.ts";
import {
  usageHistoryFamily,
  usageHistoryScope,
  type UsageBucket,
} from "../families/usageHistory.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectUsage, type ProjectUsage } from "./usage.ts";

const ORG = "org";
const PROJECT = "p1";
const OWNER = usageOwnerOf(ORG, PROJECT);
const USAGE = usageScope(ORG, OWNER);
const HISTORY = usageHistoryScope(ORG, OWNER);

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

/** A demanded detail scope of a live link, its attempt made: generation 1. */
const demanded = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(linkKeys.zerops(ORG), { kind: "demand", demanded: true }),
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
];

const answered = (
  scope: ScopeKey,
  rows: ReadonlyArray<{ readonly id: string; readonly value: unknown }>,
  partial = false,
): ReadonlyArray<AccountInput> => [
  ...demanded(scope),
  { kind: "baseline-begin", scope, generation: 1 },
  {
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-realtime",
    members: rows.map((row) => row.id),
    rows: rows.map(
      (row) =>
        ({
          family: scope === USAGE ? "usage" : "usageHistory",
          id: row.id,
          value: row.value,
          revision: { kind: "zerops", version: null },
        }) as never,
    ),
    partial,
  },
  event(scope, { kind: "baseline-committed" }),
];

const pair = (used: number, limit: number) => ({ used, limit });
/** A container's figures as `container` gives them, summed for one container. */
const SHARED = { cores: pair(0.25, 1), memoryGb: pair(0.5, 1), diskGb: pair(1, 5) };
const container = (
  containerId: string,
  serviceId: string,
  figures: Partial<ContainerUsage> = {},
): { readonly id: string; readonly value: ContainerUsage } => ({
  id: containerId,
  value: {
    serviceId,
    containerId,
    cpu: pair(0, 0),
    vCpu: pair(0.25, 1),
    ramGBytes: pair(0.5, 1),
    diskGBytes: pair(1, 5),
    ...figures,
  },
});
const hour = (serviceStackId: string, from: string, vCpuUsed: number) => {
  const value: UsageBucket = { serviceStackId, from, till: `${from}+1h`, vCpuUsed };
  return { id: `${serviceStackId}|${from}|${from}+1h`, value };
};

describe("projectUsage", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly expected: Partial<ProjectUsage>;
  }>([
    {
      name: "nothing read: not read, no service's use, no hours",
      inputs: [],
      expected: { read: false, byService: {}, history: [], failure: undefined },
    },
    {
      name: "the use answered: each service summed over its containers, shared and dedicated cores",
      inputs: answered(USAGE, [
        container("c1", "s1"),
        container("c2", "s1", { cpu: pair(2, 2), vCpu: null }),
        container("c3", "s2"),
      ]),
      expected: {
        read: true,
        byService: {
          s1: {
            containers: 2,
            cores: pair(2.25, 3),
            memoryGb: pair(1, 2),
            diskGb: pair(2, 10),
          },
          s2: { containers: 1, ...SHARED },
        },
      },
    },
    {
      name: "an answer with no containers: read, and no service holds any",
      inputs: answered(USAGE, []),
      expected: { read: true, byService: {} },
    },
    {
      name: "a container leaving a figure unsaid: its service's use is not known",
      inputs: answered(USAGE, [container("c1", "s1", { ramGBytes: null }), container("c2", "s2")]),
      expected: { byService: { s2: { containers: 1, ...SHARED } } },
    },
    {
      name: "a container that no longer runs: its service no longer counts it",
      inputs: [
        ...answered(USAGE, [container("c1", "s1"), container("c2", "s1")]),
        { kind: "baseline-begin", scope: USAGE, generation: 1 },
        {
          kind: "baseline-commit",
          scope: USAGE,
          generation: 1,
          via: "zerops-realtime",
          members: ["c1"],
          rows: [],
        },
      ],
      expected: { byService: { s1: { containers: 1, ...SHARED } } },
    },
    {
      name: "the hours answered: every service's, oldest first",
      inputs: answered(HISTORY, [
        hour("s1", "2026-10-06T11:00:00Z", 0.3),
        hour("s2", "2026-10-06T09:00:00Z", 0.1),
        hour("s1", "2026-10-06T10:00:00Z", 0.2),
      ]),
      expected: {
        read: false,
        history: [
          hour("s2", "2026-10-06T09:00:00Z", 0.1).value,
          hour("s1", "2026-10-06T10:00:00Z", 0.2).value,
          hour("s1", "2026-10-06T11:00:00Z", 0.3).value,
        ],
      },
    },
    {
      name: "the use refused: says why",
      inputs: [
        ...demanded(USAGE),
        event(USAGE, {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "authoritative-denial", message: "HTTP 403" },
        }),
      ],
      expected: { read: false, failure: "HTTP 403" },
    },
    {
      name: "the use not answered in time: says so in the person's words, never a phase",
      inputs: [...demanded(USAGE), event(USAGE, { kind: "deadline" })],
      expected: { read: false, failure: "No answer came in time." },
    },
    {
      name: "the hours catching up after a failed read: says why, keeps the use",
      inputs: [
        ...answered(USAGE, [container("c1", "s1")]),
        ...demanded(HISTORY),
        event(HISTORY, {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "transient", message: "HTTP 503" },
        }),
      ],
      expected: { read: true, failure: "HTTP 503" },
    },
  ])("$name", ({ inputs, expected }) => {
    const reads = readsOfState(apply(emptyAccount, inputs));
    const actual = projectUsage.derive(reads, { orgId: ORG, owner: OWNER });
    for (const [field, value] of Object.entries(expected))
      expect(actual[field as keyof ProjectUsage]).toEqual(value);
  });
});

describe("projectUsage beside the topology's own sums", () => {
  const current = [
    {
      serviceStackId: "zcp",
      containerId: "zcp-1",
      cpu: { used: 0, limit: 0 },
      vCpu: { used: 0.076, limit: 2 },
      ramGBytes: { used: 1.2, limit: 2.75 },
      diskGBytes: { used: 0.5, limit: 2 },
    },
    {
      serviceStackId: "app",
      containerId: "app-1",
      cpu: { used: 0.5, limit: 1 },
      vCpu: { used: 0.25, limit: 2 },
      ramGBytes: { used: 0.1, limit: 0.25 },
      diskGBytes: { used: 0.2, limit: 1 },
    },
    {
      serviceStackId: "app",
      containerId: "app-2",
      vCpu: { used: 0.125, limit: 2 },
      ramGBytes: { used: 0.2, limit: 0.5 },
      diskGBytes: { used: 0.3, limit: 1 },
    },
  ];
  const history = [1, 2].map((at) => ({
    serviceStackId: "app",
    from: `2026-09-08T0${at}:00:00Z`,
    till: `2026-09-08T0${at + 1}:00:00Z`,
    containerCount: 2,
    vCpuUsed: at / 4,
    vCpuLimit: 4,
    ramUsed: 0.3,
    ramLimit: 0.75,
  }));
  const project = { id: PROJECT, name: "p", status: "ACTIVE" };
  const services = ["zcp", "app"].map((id) => ({ id, name: id, status: "ACTIVE" }));
  const decoded = (
    decode: (raw: unknown) => { readonly id: string; readonly value: unknown } | null,
    raw: ReadonlyArray<unknown>,
  ) => raw.flatMap((row) => decode(row) ?? []);

  it("sums shared and dedicated cores across containers as the topology does", () => {
    const reads = readsOfState(
      apply(emptyAccount, answered(USAGE, decoded(usageFamily.zeropsQuery!.decode, current))),
    );
    const { byService } = projectUsage.derive(reads, { orgId: ORG, owner: OWNER });
    for (const row of projectTopology(project, services, [], current).services)
      expect(byService[row.serviceId]).toEqual(row.usage);
  });

  it("charts every hour in order, whichever order the answer gave", () => {
    const reads = readsOfState(
      apply(
        emptyAccount,
        answered(HISTORY, decoded(usageHistoryFamily.zeropsQuery!.decode, history.toReversed())),
      ),
    );
    const { history: hours } = projectUsage.derive(reads, { orgId: ORG, owner: OWNER });
    expect(projectTopology(project, services, [], undefined, hours).services).toEqual(
      projectTopology(project, services, [], undefined, history).services,
    );
  });
});
