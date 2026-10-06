import { describe, expect, it } from "vite-plus/test";

import { liveProjects, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { indexOf, reduceAccount, type AccountInput, type RuntimeDirective } from "../reducer.ts";
import { publicRoutingFamily, routingsScope } from "./publicRouting.ts";

const decode = publicRoutingFamily.zerops!.decode;

/** Synthetic routing in the organization's search wire shape. */
const RECORDED = {
  _version: 1,
  cdnEnabled: false,
  clientId: "org",
  created: "2026-08-27T16:20:46Z",
  deleteOnSync: false,
  domains: [
    {
      beingInstalledSslCertificate: null,
      cdnStatus: "DISABLED",
      deployedSslCertificate: null,
      dnsCheckStatus: "OK",
      domainName: "buntest-demo-3000.prg1.zerops.app",
      lastDnsCheckAt: null,
      lastDnsCheckDetail: null,
      nextDnsCheckAt: null,
      sslCertificateInstallationError: null,
      sslStatus: "ACTIVE",
    },
  ],
  id: "r1",
  isEditable: false,
  isSynced: true,
  lastSync: "2026-08-27T16:20:46Z",
  lastUpdate: "2026-08-27T16:20:46Z",
  locations: [
    {
      config: null,
      path: "/",
      port: 3000,
      serviceStackId: "s1",
      serviceStackInfo: {
        serviceStackName: "buntest",
        serviceStackTypeName: "Bun",
        serviceStackTypeVersionName: "alpine/bun@1.2.2",
      },
    },
  ],
  projectId: "p1",
  sslEnabled: true,
  version: "USER",
};

/** The row as a project's own listing may answer it: no project, no ordering. */
function unplaced(): unknown {
  const { projectId: _project, _version: _ordering, ...row } = RECORDED;
  return row;
}

describe("publicRoutingFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "keeps what an address is made of: its project, domains, locations, TLS and sync",
      raw: RECORDED,
      row: {
        id: "r1",
        version: 1,
        value: {
          projectId: "p1",
          isSynced: true,
          sslEnabled: true,
          domains: [{ domainName: "buntest-demo-3000.prg1.zerops.app" }],
          locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
        },
      },
    },
    {
      name: "reads a project's own listing, whose rows may not name their project",
      raw: unplaced(),
      row: {
        id: "r1",
        version: null,
        value: {
          isSynced: true,
          sslEnabled: true,
          domains: [{ domainName: "buntest-demo-3000.prg1.zerops.app" }],
          locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
        },
      },
    },
    {
      name: "refuses a row without its sync state",
      raw: { ...RECORDED, isSynced: undefined },
      row: null,
    },
    {
      name: "refuses a row whose location names no service",
      raw: { ...RECORDED, locations: [{ path: "/", port: 80 }] },
      row: null,
    },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });
});

const routing = (id: string, patch: Readonly<Record<string, unknown>> = {}) =>
  decode({ ...RECORDED, id, ...patch })!;

const stream = (event: Extract<AccountInput, { kind: "stream" }>["event"]): AccountInput => ({
  kind: "stream",
  key: routingsScope(ORG),
  now: 0,
  event,
});

/** The organization's routings baselined and live: these rows, as the search answered them. */
const live = (...rows: ReadonlyArray<ReturnType<typeof routing>>): ReadonlyArray<AccountInput> => [
  ...liveProjects(ORG, [{ id: "p1" }]),
  stream({ kind: "demand", demanded: true }),
  stream({ kind: "attempt" }),
  stream({ kind: "handshake" }),
  { kind: "baseline-begin", scope: routingsScope(ORG), generation: 1 },
  {
    kind: "baseline-commit",
    scope: routingsScope(ORG),
    generation: 1,
    via: "zerops-realtime",
    members: rows.map((row) => row.id),
    rows: rows.map((row) => ({
      family: "publicRouting",
      id: row.id,
      value: row.value,
      revision: zeropsVersion(1),
    })),
  },
  stream({ kind: "baseline-committed" }),
];

/** The listing's delta, as its `listStream` frame carries it. */
const listed = (add: ReadonlyArray<string>, remove: ReadonlyArray<string>): AccountInput => ({
  kind: "membership",
  scope: routingsScope(ORG),
  generation: 1,
  delta: { add, remove },
});

/** A routing's row, as its `updateStream` frame carries it. */
const pushed = (row: ReturnType<typeof routing>, version: number): AccountInput => ({
  kind: "rows",
  scope: routingsScope(ORG),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: [
    { family: "publicRouting", id: row.id, value: row.value, revision: zeropsVersion(version) },
  ],
});

function run(inputs: ReadonlyArray<AccountInput>): {
  readonly state: AccountState;
  readonly directives: ReadonlyArray<RuntimeDirective>;
} {
  let state = emptyAccount;
  const directives: RuntimeDirective[] = [];
  for (const input of inputs) {
    const next = reduceAccount(state, input);
    state = next.state;
    directives.push(...next.directives);
  }
  return { state, directives };
}

describe("the organization's routings, frame by frame (recorded 2026-10-06)", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly serving: ReadonlyArray<string>;
    readonly directives?: ReadonlyArray<RuntimeDirective>;
  }>([
    {
      name: "a subdomain turned off: the listing's delete alone takes its address off the project",
      inputs: [...live(routing("r1")), listed([], ["r1"])],
      serving: [],
      // Leaving the listing is an address no longer served: no owner is asked about it.
      directives: [],
    },
    {
      name: "a subdomain turned on: the listing's add asks for the new routing by its id",
      inputs: [...live(), listed(["r2"], [])],
      serving: [],
      directives: [{ kind: "resolve-rows", key: routingsScope(ORG), ids: ["r2"] }],
    },
    {
      name: "a subdomain turned on: its routing's row serves once it arrives",
      inputs: [...live(), listed(["r2"], []), pushed(routing("r2"), 1)],
      serving: ["r2"],
    },
    {
      name: "an edit in place: the newer row replaces the held one and the address stays",
      inputs: [
        ...live(routing("r1")),
        pushed(routing("r1", { domains: [{ domainName: "shop.example.com" }] }), 2),
      ],
      serving: ["r1"],
    },
    {
      name: "a row pushed for a routing the listing let go serves nothing",
      inputs: [...live(routing("r1")), listed([], ["r1"]), pushed(routing("r1"), 2)],
      serving: [],
    },
    {
      name: "after a socket gap the next baseline is the truth: one it omits serves nothing",
      inputs: [
        ...live(routing("r1"), routing("r2")),
        stream({ kind: "parent-lost" }),
        stream({ kind: "attempt" }),
        stream({ kind: "handshake" }),
        { kind: "baseline-begin", scope: routingsScope(ORG), generation: 2 },
        {
          kind: "baseline-commit",
          scope: routingsScope(ORG),
          generation: 2,
          via: "zerops-realtime",
          members: ["r2"],
          rows: [
            {
              family: "publicRouting",
              id: "r2",
              value: routing("r2").value,
              revision: zeropsVersion(1),
            },
          ],
        },
        stream({ kind: "baseline-committed" }),
      ],
      serving: ["r2"],
    },
  ])("$name", ({ inputs, serving, directives }) => {
    const result = run(inputs);
    expect([...indexOf(result.state, "routingProject", "p1")].sort()).toEqual(serving);
    if (directives !== undefined)
      expect(
        result.directives.filter(
          (directive) => directive.kind === "resolve-rows" || directive.kind === "verify-absence",
        ),
      ).toEqual(directives);
  });
});
