import { expect, it } from "vite-plus/test";

import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { routingsScope, type PublicRoutingValue } from "../families/publicRouting.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { publicAccess } from "./publicAccess.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: StreamEvent) =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

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

// witness: packages/client-runtime/src/data/projections/publicAccess.ts | [...addresses.routes, ...addresses.pending].map((route) => route.serviceId), → [...addresses.pending].map((route) => route.serviceId),
it("PJ24: A service its own domain reaches is never offered to the internet, though its subdomain is off", () => {
  const inputs = [
    ...liveZerops({
      running: [],
      projects: [
        { id: "p1", publicZone: "fte2334ab.prg1-zerops.zone", zeropsSubdomainHost: "24cb" },
      ],
      services: [
        {
          id: "s1",
          projectId: "p1",
          name: "app",
          subdomainAccess: false,
          ports: [{ port: 80, scheme: "http" }],
        },
        { id: "s2", projectId: "p1", name: "db", ports: [{ port: 5432, scheme: "tcp" }] },
      ],
    }),
    ...baselined(routingsScope(ORG), {
      r1: {
        projectId: "p1",
        sslEnabled: true,
        domains: [{ domainName: "shop.example.com", sslStatus: "ACTIVE" }],
        locations: [{ path: "/", port: 80, serviceStackId: "s1" }],
      },
    }),
  ];
  expect(
    publicAccess.derive(readsOfState(apply(emptyAccount, inputs)), { orgId: ORG, projectId: "p1" }),
  ).toEqual({
    state: "ready",
    routes: [
      {
        service: "app",
        serviceId: "s1",
        port: 80,
        url: "https://shop.example.com",
        host: "shop.example.com",
      },
    ],
    pending: [],
    offers: [],
    readsProject: false,
  });
});
