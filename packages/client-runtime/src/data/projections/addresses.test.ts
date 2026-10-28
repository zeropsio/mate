import { describe, expect, it } from "vite-plus/test";

import type { ZeropsServicePort } from "../../zerops/api.ts";
import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import {
  routingsScope,
  type PublicRoutingDomain,
  type PublicRoutingValue,
} from "../families/publicRouting.ts";
import type { AccountInput } from "../reducer.ts";
import { reduceAccount } from "../reducer.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import {
  addresses,
  dnsAdvice,
  domainFace,
  placeIps,
  regionOf,
  type PlaceAddresses,
  type PlaceIps,
} from "./addresses.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event: streamEvent,
});

/** A scope's attempt baselined with these rows of one family, and live. */
function baselined(
  scope: ScopeKey,
  family: "publicRouting" | "publicPortRouting",
  rows: Readonly<Record<string, PublicRoutingValue | PublicPortRoutingValue>>,
): ReadonlyArray<AccountInput> {
  return [
    event(scope, { kind: "demand", demanded: true }),
    event(scope, { kind: "attempt" }),
    event(scope, { kind: "handshake" }),
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: Object.keys(rows),
      rows: Object.entries(rows).map(([id, value]) => ({
        family,
        id,
        value,
        revision: zeropsVersion(1),
      })),
    } as AccountInput,
    event(scope, { kind: "baseline-committed" }),
  ];
}

const V6 = "2001:db8:4a7:1d::1";
const SHARED = "93.185.106.128";
const ZONE = "k3f9x2.prg1-zerops.zone";

/** The app's port as Zerops routes HTTP to it. */
const APP_PORTS: ReadonlyArray<ZeropsServicePort> = [
  { port: 3000, scheme: "http", httpRouting: true, portRouting: false },
];

/** Production of a shop: an app serving the web on 3000 with its zerops.app address on, a db. */
const production = (
  patch: Readonly<Record<string, unknown>> = {},
  appPorts = APP_PORTS,
  app: Readonly<Record<string, unknown>> = {},
) =>
  liveZerops({
    running: [],
    projects: [
      {
        id: "p1",
        name: "Shop",
        publicZone: ZONE,
        zeropsSubdomainHost: "4c1e",
        publicIpV6: V6,
        publicIpV4Shared: true,
        ...patch,
      },
    ],
    services: [
      {
        id: "s1",
        projectId: "p1",
        name: "app",
        subdomainAccess: true,
        ports: appPorts,
        ...app,
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
  });

const domain = (patch: Partial<PublicRoutingDomain> = {}): PublicRoutingDomain => ({
  domainName: "shop.com",
  dnsCheckStatus: "OK",
  sslStatus: "ACTIVE",
  ...patch,
});

const routing = (patch: Partial<PublicRoutingValue> = {}): PublicRoutingValue => ({
  projectId: "p1",
  isSynced: true,
  isEditable: true,
  deleteOnSync: false,
  everSynced: true,
  sslEnabled: true,
  domains: [domain()],
  locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
  ...patch,
});

const port = (patch: Partial<PublicPortRoutingValue> = {}): PublicPortRoutingValue => ({
  projectId: "p1",
  serviceStackId: "s2",
  publicIpType: "IP_V6",
  publicPort: 16432,
  internalPort: 6432,
  internalProtocol: "tcp",
  firewallPolicy: "WHITELIST",
  firewallIpRanges: ["2001:db8::20/128"],
  isSynced: true,
  deleteOnSync: false,
  everSynced: true,
  ...patch,
});

function place(
  input: {
    readonly routings?: Readonly<Record<string, PublicRoutingValue>>;
    readonly ports?: Readonly<Record<string, PublicPortRoutingValue>> | "refused";
    readonly project?: Readonly<Record<string, unknown>>;
    readonly appPorts?: typeof APP_PORTS;
    /** The app service's own fields beyond the fixture's. */
    readonly app?: Readonly<Record<string, unknown>>;
  },
  /** The place asked for: production's own unless a test names another. */
  projectId = "p1",
): PlaceAddresses {
  const inputs: AccountInput[] = [
    ...production(input.project, input.appPorts, input.app),
    ...baselined(routingsScope(ORG), "publicRouting", input.routings ?? {}),
  ];
  if (input.ports === "refused") {
    const scope = portRoutingsScope(ORG);
    inputs.push(
      event(scope, { kind: "demand", demanded: true }),
      event(scope, { kind: "attempt" }),
      event(scope, {
        kind: "fault",
        fault: { outcome: "authoritative-denial", message: "Insufficient permissions" },
        jitter: 0,
      }),
    );
  } else inputs.push(...baselined(portRoutingsScope(ORG), "publicPortRouting", input.ports ?? {}));
  return addresses.derive(readsOfState(apply(emptyAccount, inputs)), { orgId: ORG, projectId });
}

const IPS: PlaceIps = { v6: V6, sharedV4: SHARED, zone: ZONE, zoneHasSharedV4: true };

describe("how far a domain is from answering", () => {
  it.each<{
    readonly name: string;
    readonly routing: Partial<PublicRoutingValue>;
    readonly domain: Partial<PublicRoutingDomain>;
    readonly face: string;
  }>([
    {
      name: "a domain added and not put in place yet is going live",
      routing: { isSynced: false, everSynced: false },
      domain: { dnsCheckStatus: "PENDING", sslStatus: "INACTIVE" },
      face: "going-live",
    },
    {
      name: "an edit of a routing in place, waiting, reads as changing",
      routing: { isSynced: false },
      domain: {},
      face: "changing",
    },
    {
      name: "a removed domain reads as removing until it is gone",
      routing: { isSynced: false, deleteOnSync: true },
      domain: {},
      face: "removing",
    },
    {
      name: "a domain whose DNS is still being checked waits for the person's DNS",
      routing: {},
      domain: { dnsCheckStatus: "CHECKING", sslStatus: "WAITING_FOR_DNS" },
      face: "dns",
    },
    {
      name: "a domain that points nowhere yet waits for the person's DNS",
      routing: {},
      domain: { dnsCheckStatus: "FAILED", sslStatus: "WAITING_FOR_DNS", resolvedIps: [] },
      face: "dns",
    },
    {
      name: "a domain the check found at another address points elsewhere",
      routing: {},
      domain: {
        dnsCheckStatus: "FAILED",
        sslStatus: "WAITING_FOR_DNS",
        resolvedIps: ["198.51.100.7"],
      },
      face: "elsewhere",
    },
    {
      name: "a domain whose DNS is right is getting its certificate",
      routing: {},
      domain: { sslStatus: "BEING_INSTALLED" },
      face: "certificate",
    },
    {
      name: "a certificate that could not be installed says so",
      routing: {},
      domain: { sslStatus: "WAITING_FOR_DNS", sslError: "too many certificates" },
      face: "certificate-failed",
    },
    { name: "a domain with its certificate answers", routing: {}, domain: {}, face: "live" },
    {
      name: "a certificate being renewed still serves",
      routing: {},
      domain: { sslStatus: "BEING_RENEWED" },
      face: "live",
    },
    {
      name: "a domain without TLS answers once its DNS is right",
      routing: { sslEnabled: false },
      domain: { sslStatus: "INACTIVE" },
      face: "live",
    },
  ])("$name", ({ routing: routingPatch, domain: domainPatch, face }) => {
    expect(domainFace(routing(routingPatch), domain(domainPatch), IPS)).toBe(face);
  });
});

describe("the records a domain needs at the person's DNS provider", () => {
  it("on the shared IPv4 a domain needs both its A and its AAAA, or one CNAME", () => {
    expect(dnsAdvice("shop.com", IPS)).toEqual({
      records: [
        { type: "A", name: "shop.com", value: SHARED },
        { type: "AAAA", name: "shop.com", value: V6 },
      ],
      bothRequired: true,
      cname: { type: "CNAME", name: "shop.com", value: ZONE, ipv4: true },
    });
  });

  it("with the project's own IPv4 its A points there and the AAAA is advised, not required", () => {
    const advice = dnsAdvice("shop.com", { ...IPS, ownV4: "203.0.113.77" });
    expect(advice.records[0]).toEqual({ type: "A", name: "shop.com", value: "203.0.113.77" });
    expect(advice.bothRequired).toBe(false);
  });

  it("a zone that does not answer on the shared IPv4 offers its CNAME as IPv6's alone until it does", () => {
    expect(dnsAdvice("www.shop.com", { ...IPS, zoneHasSharedV4: false }).cname).toEqual({
      type: "CNAME",
      name: "www.shop.com",
      value: ZONE,
      ipv4: false,
    });
  });

  it("a wildcard domain's records are its own, beside the certificate's CNAME at zerops.zone", () => {
    expect(dnsAdvice("*.shop.com", IPS)).toEqual({
      records: [
        { type: "A", name: "*.shop.com", value: SHARED },
        { type: "AAAA", name: "*.shop.com", value: V6 },
      ],
      bothRequired: true,
      cname: { type: "CNAME", name: "*.shop.com", value: ZONE, ipv4: true },
      certificate: {
        type: "CNAME",
        name: "_acme-challenge.shop.com",
        value: "shop.com.zerops.zone",
      },
    });
  });

  it("a region this build does not know gives no shared IPv4 to point an A at", () => {
    const { sharedV4: _none, ...unknown } = IPS;
    expect(dnsAdvice("shop.com", unknown).records).toEqual([
      { type: "AAAA", name: "shop.com", value: V6 },
    ]);
  });
});

describe("a project's region and IP addresses", () => {
  it.each([
    {
      name: "the region comes from the project's zone",
      project: { publicZone: ZONE },
      region: "prg1",
    },
    {
      name: "or from its zerops.app host",
      project: { zeropsSubdomainHost: "4c1e.prg1.zerops.app" },
      region: "prg1",
    },
    { name: "a project naming neither has no known region", project: {}, region: undefined },
  ])("$name", ({ project, region }) => {
    expect(regionOf(project)).toBe(region);
  });

  it("a project's addresses are its own IPv6 and IPv4 and the region's shared IPv4", () => {
    expect(
      placeIps({
        id: "p1",
        name: "Shop",
        status: "ACTIVE",
        publicZone: ZONE,
        publicIpV6: V6,
        publicIpV4: "203.0.113.77",
        publicIpV4Shared: false,
      }),
    ).toEqual({
      v6: V6,
      ownV4: "203.0.113.77",
      sharedV4: SHARED,
      zone: ZONE,
      zoneHasSharedV4: false,
    });
  });
});

describe("one place's addresses", () => {
  it("a place's domains, zerops.app switches, IP addresses and open ports read together", () => {
    const shown = place({
      routings: {
        r1: routing(),
        // Each service's zerops.app address is a routing the platform keeps: never a domain.
        r2: routing({
          isEditable: false,
          domains: [domain({ domainName: "app-4c1e-3000.prg1.zerops.app" })],
        }),
      },
      ports: { pr1: port() },
    });
    expect(shown.state).toBe("ready");
    expect(shown.domains.map(({ domainName, face, url }) => ({ domainName, face, url }))).toEqual([
      { domainName: "shop.com", face: "live", url: "https://shop.com" },
    ]);
    expect(shown.domains[0]?.targets).toEqual([
      { serviceId: "s1", serviceName: "app", port: 3000, path: "/" },
    ]);
    expect(
      shown.zerops.map(({ serviceName, on, port: first }) => ({ serviceName, on, first })),
    ).toEqual([{ serviceName: "app", on: true, first: 3000 }]);
    expect(shown.ips).toEqual({ v6: V6, sharedV4: SHARED, zone: ZONE, zoneHasSharedV4: true });
    expect(shown.ports).toEqual([
      {
        id: "pr1",
        serviceId: "s2",
        serviceName: "db",
        publicIpType: "IP_V6",
        publicPort: 16432,
        internalPort: 6432,
        internalProtocol: "tcp",
        firewallPolicy: "WHITELIST",
        ranges: ["2001:db8::20/128"],
        face: "live",
        address: `[${V6}]:16432`,
      },
    ]);
    expect(shown.waitingDomains).toEqual([]);
    expect(shown.waitingPorts).toEqual([]);
  });

  // The live audit (2026-10-28): Larkspur's empty production offered an IPv4 to buy and a port
  // to open, with nothing deployed to reach.
  it.each([
    { case: "its runtime holds no deploy", activeAppVersion: null, nothing: true },
    {
      case: "its runtime runs a deploy",
      activeAppVersion: { created: "2026-10-01T00:00:00Z" },
      nothing: false,
    },
    { case: "what its runtime holds is not read", activeAppVersion: undefined, nothing: false },
  ])(
    "A place says nothing is deployed there only where the platform says so: $case",
    ({ activeAppVersion, nothing }) => {
      const shown = place({
        app: {
          serviceStackTypeInfo: {
            serviceStackTypeVersionName: "nodejs@22",
            serviceStackTypeCategory: "USER",
          },
          ...(activeAppVersion === undefined ? {} : { activeAppVersion }),
        },
      });
      expect(shown.nothingDeployed).toBe(nothing);
    },
  );

  it("a domain may point only at a web port, and only a port the service may open is offered", () => {
    const shown = place({});
    expect(shown.webTargets).toEqual([
      { serviceId: "s1", serviceName: "app", port: 3000, protocol: "tcp" },
    ]);
    expect(shown.portTargets).toEqual([
      { serviceId: "s2", serviceName: "db", port: 6432, protocol: "tcp" },
    ]);
  });

  it("a port declaring an http scheme is a web port before Zerops routes HTTP to it", () => {
    const shown = place({
      appPorts: [{ port: 8080, scheme: "http", httpRouting: false, portRouting: false }],
    });
    expect(shown.webTargets).toEqual([
      { serviceId: "s1", serviceName: "app", port: 8080, protocol: "tcp" },
    ]);
  });

  it("somebody else's waiting changes are named, so putting ours live asks first", () => {
    const shown = place({
      routings: {
        r1: routing(),
        r3: routing({
          isSynced: false,
          everSynced: false,
          domains: [domain({ domainName: "api.shop.com" })],
        }),
        r4: routing({
          isSynced: false,
          deleteOnSync: true,
          domains: [domain({ domainName: "old.shop.com" })],
        }),
      },
      ports: { pr2: port({ isSynced: false, everSynced: false, publicPort: 16500 }) },
    });
    expect(shown.waitingDomains).toEqual([
      { id: "r3", label: "api.shop.com → app · port 3000" },
      { id: "r4", label: "Removing old.shop.com" },
    ]);
    expect(shown.waitingPorts).toEqual([{ id: "pr2", label: "Port 16500 → db · port 6432" }]);
  });

  it("a port opened on an IPv4 the project lacks has no address to connect to", () => {
    const shown = place({ ports: { pr1: port({ publicIpType: "IP_V4" }) } });
    expect(shown.ports[0]?.address).toBeUndefined();
  });

  it("a project the organization's whole roster doesn't hold has addresses the viewer can't see", () => {
    expect(place({ routings: { r1: routing() } }, "p9").state).toBe("failed");
  });

  it("ports refused to the viewer leave the rest of the place readable", () => {
    const shown = place({ routings: { r1: routing() }, ports: "refused" });
    expect(shown.portsState).toBe("failed");
    expect(shown.ports).toEqual([]);
    expect(shown.domains.map(({ domainName }) => domainName)).toEqual(["shop.com"]);
  });
});
