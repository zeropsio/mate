import { expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { portRoutingsScope } from "../families/publicPortRouting.ts";
import { routingsScope } from "../families/publicRouting.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { addresses, dnsAdvice, type PlaceIps } from "./addresses.ts";

const V6 = "2001:db8:4a7:1d::1";
const SHARED = "93.185.106.128";
const ZONE = "k3f9x2.prg1-zerops.zone";
const IPS: PlaceIps = { v6: V6, sharedV4: SHARED, zone: ZONE, zoneHasSharedV4: true };

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event: streamEvent,
});
/** A scope's attempt baselined with no rows, and live. */
const baselinedEmpty = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
  { kind: "baseline-begin", scope, generation: 1 },
  {
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-realtime",
    members: [],
    rows: [],
  },
  event(scope, { kind: "baseline-committed" }),
];

// witness: packages/client-runtime/src/data/projections/addresses.ts | bothRequired: ips.ownV4 === undefined && v4 !== undefined, → bothRequired: ips.ownV4 !== undefined && v4 !== undefined,
it("PJ25: On the shared IPv4 a domain needs both its A and its AAAA record, or one CNAME", () => {
  expect(dnsAdvice("shop.com", IPS)).toEqual({
    records: [
      { type: "A", name: "shop.com", value: SHARED },
      { type: "AAAA", name: "shop.com", value: V6 },
    ],
    bothRequired: true,
    cname: { type: "CNAME", name: "shop.com", value: ZONE, ipv4: true },
  });
});

// witness: packages/client-runtime/src/data/projections/addresses.ts | .filter((port) => port.portRouting === true) → .filter((port) => port.portRouting !== undefined)
it("PJ26: A domain may point only at a web port, and only a port the service may open is offered", () => {
  const inputs = [
    ...liveZerops({
      running: [],
      projects: [
        {
          id: "p1",
          name: "Shop",
          publicZone: ZONE,
          zeropsSubdomainHost: "4c1e",
          publicIpV6: V6,
          publicIpV4Shared: true,
        },
      ],
      services: [
        {
          id: "s1",
          projectId: "p1",
          name: "app",
          subdomainAccess: true,
          ports: [{ port: 3000, scheme: "http", httpRouting: true, portRouting: false }],
        },
        {
          id: "s2",
          projectId: "p1",
          name: "db",
          ports: [
            { port: 5432, scheme: "postgresql", httpRouting: false, portRouting: false },
            { port: 6432, scheme: "postgresql", httpRouting: false, portRouting: true },
          ],
        },
      ],
    }),
    ...baselinedEmpty(routingsScope(ORG)),
    ...baselinedEmpty(portRoutingsScope(ORG)),
  ];
  const shown = addresses.derive(readsOfState(apply(emptyAccount, inputs)), {
    orgId: ORG,
    projectId: "p1",
  });
  expect(shown.webTargets).toEqual([
    { serviceId: "s1", serviceName: "app", port: 3000, protocol: "tcp" },
  ]);
  expect(shown.portTargets).toEqual([
    { serviceId: "s2", serviceName: "db", port: 6432, protocol: "tcp" },
  ]);
});
