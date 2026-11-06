import { describe, expect, it } from "vite-plus/test";
import serviceFixture from "../../zerops/__fixtures__/z3-eval.service-stack.json" with { type: "json" };
import { liveProjects, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { indexOf, reduceAccount, type AccountInput, type RuntimeDirective } from "../reducer.ts";
import { projectFamily } from "./project.ts";
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
  ...liveProjects(ORG, [
    {
      ...projectFamily.zerops!.decode({
        ...serviceFixture.list[0]!.project!,
        id: "p1",
        clientId: ORG,
      })!.value,
      id: "p1",
    },
  ]),
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
  it("a subdomain turned off: the listing's delete alone takes its address off the project", () => {
    const result = run([...live(routing("r1")), listed([], ["r1"])]);
    expect([...indexOf(result.state, "routingProject", "p1")].sort()).toEqual([]);
    expect(
      result.directives.filter(
        (directive) => directive.kind === "resolve-rows" || directive.kind === "verify-absence",
      ),
    ).toEqual([]);
  });
});
