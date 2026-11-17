import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import { routingsScope, type PublicRoutingValue } from "../families/publicRouting.ts";
import { emptyAccount, type AccountState, type OperationReceipt, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import {
  addDomain,
  closePort,
  disableSubdomainAccess,
  openPort,
  removeDomain,
  requestIpv4,
} from "./addressWrites.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event: streamEvent,
});

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

const routing = (patch: Partial<PublicRoutingValue> = {}): PublicRoutingValue => ({
  projectId: "p1",
  isEditable: true,
  sslEnabled: true,
  domains: [{ domainName: "shop.com" }, { domainName: "www.shop.com" }],
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
  ...patch,
});

/** The reads after the account observed this place, then these further inputs. */
function reads(
  input: {
    readonly routings?: Readonly<Record<string, PublicRoutingValue>>;
    readonly ports?: Readonly<Record<string, PublicPortRoutingValue>>;
    readonly project?: Readonly<Record<string, unknown>>;
    readonly app?: Readonly<Record<string, unknown>>;
    /** A listing whose baseline never came. */
    readonly unread?: "routings" | "ports";
  },
  after: ReadonlyArray<AccountInput> = [],
) {
  const inputs: AccountInput[] = [
    ...liveZerops({
      running: [],
      projects: [{ id: "p1", publicIpV6: "2001:db8::1", ...input.project }],
      services: [
        { id: "s1", projectId: "p1", name: "app", subdomainAccess: true, ...input.app },
        { id: "s2", projectId: "p1", name: "db" },
      ],
    }),
    ...(input.unread === "routings"
      ? []
      : baselined(routingsScope(ORG), "publicRouting", input.routings ?? {})),
    ...(input.unread === "ports"
      ? []
      : baselined(portRoutingsScope(ORG), "publicPortRouting", input.ports ?? {})),
    ...after,
  ];
  return readsOfState(apply(emptyAccount, inputs));
}

/** The receipt of a write no process follows: what the facts show ends it. */
const unfollowed: OperationReceipt = {
  requestId: "req-1",
  operationId: "p1",
  executor: "zerops",
  affected: [{ family: "publicRouting", id: "p1" }],
  handles: [],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
};

const left = (scope: ScopeKey, id: string): AccountInput => ({
  kind: "membership",
  scope,
  generation: 1,
  delta: { add: [], remove: [id] },
});

const ADD = {
  kind: "add-domain",
  orgId: ORG,
  projectId: "p1",
  domains: ["shop.com", "www.shop.com"],
  serviceId: "s1",
  port: 3000,
} as const;

describe("when an address write is done", () => {
  it.each<{
    readonly name: string;
    readonly routings?: Readonly<Record<string, PublicRoutingValue>>;
    readonly unread?: "routings";
    readonly handles: ReadonlyArray<string> | null;
  }>([
    {
      name: "its domains to its service and port, in place",
      routings: { rt1: routing() },
      handles: ["address:routing:rt1"],
    },
    {
      name: "not its domains to another port",
      routings: { rt1: routing({ locations: [{ path: "/", port: 8080, serviceStackId: "s1" }] }) },
      handles: [],
    },
    {
      name: "not a routing holding only one of its domains",
      routings: { rt1: routing({ domains: [{ domainName: "shop.com" }] }) },
      handles: [],
    },
    { name: "nothing said while the routings are unread", unread: "routings", handles: null },
  ])("after a lost answer, a domain added is found by $name", ({ routings, unread, handles }) => {
    const read = reads({
      ...(routings === undefined ? {} : { routings }),
      ...(unread === undefined ? {} : { unread }),
    });
    expect(addDomain.effectHandles?.(read, ADD) ?? null).toEqual(handles);
  });

  it("removing one of two domains is done once the routing holds only the kept one, in place", () => {
    const intent = {
      kind: "remove-domain",
      orgId: ORG,
      projectId: "p1",
      routingId: "rt1",
      domainName: "www.shop.com",
      keep: ["shop.com"],
      locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
      sslEnabled: true,
    } as const;
    expect(
      removeDomain.settledBy?.(reads({ routings: { rt1: routing() } }), intent, unfollowed),
    ).toBeNull();
    const kept = reads({ routings: { rt1: routing({ domains: [{ domainName: "shop.com" }] }) } });
    expect(removeDomain.settledBy?.(kept, intent, unfollowed)).toEqual({ kind: "succeeded" });
  });

  it("removing a routing's last domain is done once the listing no longer holds it", () => {
    const intent = {
      kind: "remove-domain",
      orgId: ORG,
      projectId: "p1",
      routingId: "rt1",
      domainName: "shop.com",
      keep: [],
      locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
      sslEnabled: true,
    } as const;
    const held = reads({ routings: { rt1: routing() } });
    expect(removeDomain.settledBy?.(held, intent, unfollowed)).toBeNull();
    const gone = reads({ routings: { rt1: routing() } }, [left(routingsScope(ORG), "rt1")]);
    expect(removeDomain.settledBy?.(gone, intent, unfollowed)).toEqual({ kind: "succeeded" });
  });

  it("closing a zerops.app address is done once its service says it is closed", () => {
    const intent = {
      kind: "disable-subdomain-access",
      orgId: ORG,
      projectId: "p1",
      serviceId: "s1",
    } as const;
    expect(disableSubdomainAccess.settledBy?.(reads({}), intent, unfollowed)).toBeNull();
    const closed = reads({ app: { subdomainAccess: false } });
    expect(disableSubdomainAccess.settledBy?.(closed, intent, unfollowed)).toEqual({
      kind: "succeeded",
    });
  });

  it("a port opened is done once a port at that address of that service is in place", () => {
    const intent = {
      kind: "open-port",
      orgId: ORG,
      projectId: "p1",
      serviceId: "s2",
      publicIpType: "IP_V6",
      publicPort: 16432,
      internalPort: 6432,
      internalProtocol: "tcp",
      firewallPolicy: "WHITELIST",
      firewallIpRanges: ["2001:db8::20/128"],
    } as const;
    expect(openPort.settledBy?.(reads({}), intent, unfollowed)).toBeNull();
    expect(openPort.settledBy?.(reads({ ports: { pr1: port() } }), intent, unfollowed)).toEqual({
      kind: "succeeded",
    });
  });

  it("a port closed is done once the listing no longer holds it", () => {
    const intent = {
      kind: "close-port",
      orgId: ORG,
      projectId: "p1",
      portRoutingId: "pr1",
    } as const;
    expect(closePort.settledBy?.(reads({ ports: { pr1: port() } }), intent, unfollowed)).toBeNull();
    const gone = reads({ ports: { pr1: port() } }, [left(portRoutingsScope(ORG), "pr1")]);
    expect(closePort.settledBy?.(gone, intent, unfollowed)).toEqual({ kind: "succeeded" });
  });

  it("the project's own IPv4 is done once the project carries it", () => {
    const intent = { kind: "request-ipv4", orgId: ORG, projectId: "p1" } as const;
    expect(requestIpv4.settledBy?.(reads({}), intent, unfollowed)).toBeNull();
    const bought = reads({ project: { publicIpV4: "203.0.113.77" } });
    expect(requestIpv4.settledBy?.(bought, intent, unfollowed)).toEqual({ kind: "succeeded" });
  });
});
