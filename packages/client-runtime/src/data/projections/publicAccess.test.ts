import { describe, expect, it } from "vite-plus/test";

import {
  RECORDED_ROUTING,
  RECORDED_SERVICE,
  REMOVED_ROUTING,
  ROUTING_PROJECT,
} from "../__fixtures__/publicRouting.ts";
import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import {
  projectRoutingsScope,
  routingsScope,
  type PublicRoutingValue,
} from "../families/publicRouting.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { publicAccess, type PublicAccess } from "./publicAccess.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey | ReturnType<typeof linkKeys.zerops>, streamEvent: StreamEvent) =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

/** A project with its subdomain host, an app serving HTTP on 80 with its subdomain on, a db. */
const navigation = (app: { readonly subdomainAccess: boolean } = { subdomainAccess: true }) =>
  liveZerops({
    running: [],
    projects: [{ id: "p1", publicZone: "fte2334ab.prg1-zerops.zone", zeropsSubdomainHost: "24cb" }],
    services: [
      {
        id: "s1",
        projectId: "p1",
        name: "app",
        subdomainAccess: app.subdomainAccess,
        ports: [{ port: 80, scheme: "http" }],
      },
      { id: "s2", projectId: "p1", name: "db", ports: [{ port: 5432, scheme: "tcp" }] },
    ],
  });

const routing = (patch: Partial<PublicRoutingValue> = {}): PublicRoutingValue => ({
  projectId: "p1",
  isSynced: true,
  sslEnabled: true,
  domains: [{ domainName: "shop.example.com" }],
  locations: [{ path: "/", port: 80, serviceStackId: "s1" }],
  ...patch,
});

/** A scope's attempt baselined with these routings, and live. */
const baselined = (
  scope: ScopeKey,
  routings: Readonly<Record<string, PublicRoutingValue>>,
): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
  { kind: "baseline-begin", scope, generation: 1 },
  {
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-realtime",
    members: Object.keys(routings),
    rows: Object.entries(routings).map(([id, value]) => ({
      family: "publicRouting",
      id,
      value,
      revision: zeropsVersion(1),
    })),
  },
  event(scope, { kind: "baseline-committed" }),
];

/** The organization's routing search refused to the viewer, as the adapter signals it. */
const refused = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, {
    kind: "fault",
    fault: { outcome: "authoritative-denial", message: "Insufficient permissions" },
    jitter: 0,
  }),
];

const APP = { service: "app", serviceId: "s1", port: 80 } as const;
const SUBDOMAIN = {
  ...APP,
  url: "https://app-24cb.prg1.zerops.app",
  host: "app-24cb.prg1.zerops.app",
};
const DOMAIN = { ...APP, url: "https://shop.example.com", host: "shop.example.com" };

describe("publicAccess", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly expected: PublicAccess;
  }>([
    {
      name: "the subdomain and a synced domain serve: both are live addresses",
      inputs: [
        ...navigation(),
        ...baselined(routingsScope(ORG), {
          r0: routing({ domains: [{ domainName: SUBDOMAIN.host }] }),
          r1: routing(),
        }),
      ],
      expected: {
        state: "ready",
        routes: [SUBDOMAIN, DOMAIN],
        pending: [],
        offers: [],
        readsProject: false,
      },
    },
    {
      name: "a routing not synced yet is pending, never a live address",
      inputs: [
        ...navigation(),
        ...baselined(routingsScope(ORG), {
          r0: routing({ domains: [{ domainName: SUBDOMAIN.host }] }),
          r1: routing({ isSynced: false }),
        }),
      ],
      expected: {
        state: "ready",
        routes: [SUBDOMAIN],
        pending: [DOMAIN],
        offers: [],
        readsProject: false,
      },
    },
    {
      name: "a subdomain whose routing is not synced yet is pending, though its service says on",
      inputs: [
        ...navigation(),
        ...baselined(routingsScope(ORG), {
          r1: routing({ isSynced: false, domains: [{ domainName: SUBDOMAIN.host }] }),
        }),
      ],
      expected: {
        state: "ready",
        routes: [],
        pending: [SUBDOMAIN],
        offers: [],
        readsProject: false,
      },
    },
    {
      name: "a routing the listing let go serves nothing",
      inputs: [
        ...navigation(),
        ...baselined(routingsScope(ORG), {
          r0: routing({ domains: [{ domainName: SUBDOMAIN.host }] }),
          r1: routing(),
        }),
        {
          kind: "membership",
          scope: routingsScope(ORG),
          generation: 1,
          delta: { add: [], remove: ["r1"] },
        },
      ],
      expected: {
        state: "ready",
        routes: [SUBDOMAIN],
        pending: [],
        offers: [],
        readsProject: false,
      },
    },
    {
      name: "a subdomain off is offered, the HTTP port it would publish named",
      inputs: [...navigation({ subdomainAccess: false }), ...baselined(routingsScope(ORG), {})],
      expected: {
        state: "ready",
        routes: [],
        pending: [],
        offers: [{ service: "app", serviceId: "s1", port: 80 }],
        readsProject: false,
      },
    },
    {
      name: "routings not read yet: reading, nothing claimed",
      inputs: navigation(),
      expected: { state: "reading", routes: [], pending: [], offers: [], readsProject: false },
    },
    ...[routingsScope(ORG), projectRoutingsScope(ORG, "p1")].map((scope) => ({
      name: `a partial rebaseline of ${scope} keeps the addresses already read`,
      inputs: [
        ...navigation(),
        ...(scope === routingsScope(ORG) ? [] : refused(routingsScope(ORG))),
        ...baselined(scope, {
          r0: routing({ domains: [{ domainName: SUBDOMAIN.host }] }),
          r1: routing(),
        }),
        { kind: "baseline-begin", scope, generation: 1 },
        {
          kind: "baseline-commit",
          scope,
          generation: 1,
          via: "zerops-realtime",
          members: ["r0", "r1"],
          rows: [],
          partial: true,
        },
        event(scope, { kind: "baseline-committed" }),
      ] satisfies ReadonlyArray<AccountInput>,
      expected: {
        state: "reading",
        routes: [SUBDOMAIN, DOMAIN],
        pending: [],
        offers: [],
        readsProject: scope !== routingsScope(ORG),
      } satisfies PublicAccess,
    })),
    {
      name: "an outage keeps what was read: the routings stay while the link catches up",
      inputs: [
        ...navigation(),
        ...baselined(routingsScope(ORG), {
          r0: routing({ domains: [{ domainName: SUBDOMAIN.host }] }),
          r1: routing(),
        }),
        event(linkKeys.zerops(ORG), {
          kind: "fault",
          fault: { outcome: "transient", message: "socket closed" },
          jitter: 0,
        }),
        event(routingsScope(ORG), { kind: "parent-lost" }),
      ],
      expected: {
        state: "ready",
        routes: [SUBDOMAIN, DOMAIN],
        pending: [],
        offers: [],
        readsProject: false,
      },
    },
    {
      name: "the link refused: failed, and nothing asked per project",
      inputs: [
        ...navigation(),
        event(linkKeys.zerops(ORG), {
          kind: "fault",
          fault: { outcome: "definitive-refusal", message: "Session ended" },
          jitter: 0,
        }),
        ...refused(routingsScope(ORG)),
      ],
      expected: { state: "failed", routes: [], pending: [], offers: [], readsProject: false },
    },
    {
      name: "the organization's routings refused to the viewer: the project's own listing is asked for",
      inputs: [...navigation(), ...refused(routingsScope(ORG))],
      expected: { state: "reading", routes: [], pending: [], offers: [], readsProject: true },
    },
    {
      name: "refused to the viewer, the project's own listing read: its addresses serve",
      inputs: [
        ...navigation(),
        ...refused(routingsScope(ORG)),
        ...baselined(projectRoutingsScope(ORG, "p1"), {
          r0: routing({ domains: [{ domainName: SUBDOMAIN.host }] }),
          r1: routing(),
        }),
      ],
      expected: {
        state: "ready",
        routes: [SUBDOMAIN, DOMAIN],
        pending: [],
        offers: [],
        readsProject: true,
      },
    },
    {
      name: "refused to the viewer, the project's own listing refused too: failed",
      inputs: [
        ...navigation(),
        ...refused(routingsScope(ORG)),
        ...refused(projectRoutingsScope(ORG, "p1")),
      ],
      expected: { state: "failed", routes: [], pending: [], offers: [], readsProject: true },
    },
  ])("$name", ({ inputs, expected }) => {
    const state = apply(emptyAccount, inputs);
    expect(publicAccess.derive(readsOfState(state), { orgId: ORG, projectId: "p1" })).toEqual(
      expected,
    );
  });
});

describe("recorded subdomain changes", () => {
  it.each([
    {
      name: "routing removed before service push",
      listed: false,
      enabled: true,
      live: 0,
      pending: 1,
    },
    { name: "routing removed and service off", listed: false, enabled: false, live: 0, pending: 0 },
    {
      name: "routing created before service push",
      listed: true,
      enabled: false,
      live: 1,
      pending: 0,
    },
    { name: "routing and service both on", listed: true, enabled: true, live: 1, pending: 0 },
  ])("$name", ({ listed, enabled, live, pending }) => {
    const state = apply(emptyAccount, [
      ...liveZerops({
        running: [],
        projects: [
          { id: ROUTING_PROJECT, publicZone: "zone.prg1-zerops.zone", zeropsSubdomainHost: "demo" },
        ],
        services: [{ ...RECORDED_SERVICE, subdomainAccess: enabled }],
      }),
      ...baselined(routingsScope(ORG), { [REMOVED_ROUTING]: RECORDED_ROUTING }),
      ...(listed
        ? []
        : [
            {
              kind: "membership",
              scope: routingsScope(ORG),
              generation: 1,
              delta: { add: [], remove: [REMOVED_ROUTING] },
            } satisfies AccountInput,
          ]),
    ]);
    const access = publicAccess.derive(readsOfState(state), {
      orgId: ORG,
      projectId: ROUTING_PROJECT,
    });
    expect(access.routes).toHaveLength(live);
    expect(access.pending).toHaveLength(pending);
    for (const route of [...access.routes, ...access.pending])
      expect(route).toMatchObject({ serviceId: RECORDED_ROUTING.locations[0]!.serviceStackId });
  });
});
