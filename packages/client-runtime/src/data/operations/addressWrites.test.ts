import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import {
  PROJECT_ROUTINGS_LISTING,
  routingsScope,
  type PublicRoutingValue,
} from "../families/publicRouting.ts";
import { emptyAccount, type AccountState, type OperationReceipt, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import {
  addDomain,
  closePort,
  disableSubdomainAccess,
  openPort,
  publishDomains,
  publishPorts,
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
  isSynced: true,
  isEditable: true,
  deleteOnSync: false,
  everSynced: true,
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
  isSynced: true,
  deleteOnSync: false,
  everSynced: true,
  ...patch,
});

/** The reads after the account observed this place, then these further inputs. */
function reads(
  input: {
    readonly routings?: Readonly<Record<string, PublicRoutingValue>>;
    readonly ports?: Readonly<Record<string, PublicPortRoutingValue>>;
    readonly project?: Readonly<Record<string, unknown>>;
    readonly app?: Readonly<Record<string, unknown>>;
    /** The status the row of the sync following the write says. */
    readonly sync?: "RUNNING" | "FINISHED" | "FAILED";
    /** A listing whose baseline never came. */
    readonly unread?: "routings" | "ports";
  },
  after: ReadonlyArray<AccountInput> = [],
) {
  const inputs: AccountInput[] = [
    ...liveZerops({
      running:
        input.sync === undefined
          ? []
          : [
              {
                id: "proc-1",
                projectId: "p1",
                status: input.sync,
                actionName: "project.syncPublicHttpRouting",
              },
            ],
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

/** The receipt of a write followed by the project's sync process. */
const following: OperationReceipt = {
  requestId: "req-1",
  operationId: "proc-1",
  executor: "zerops",
  affected: [{ family: "process", id: "proc-1" }],
  handles: ["proc-1"],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
};

/** The receipt of a write no process follows (none to follow, or found after a lost answer). */
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

const waiting = routing({ isSynced: false, everSynced: false });

describe("when an address write is done", () => {
  it("a domain added is not done while the sync following it runs, though Zerops holds it", () => {
    const read = reads({ routings: { rt1: waiting }, sync: "RUNNING" });
    expect(addDomain.settledBy?.(read, ADD, following)).toBeNull();
    expect(addDomain.reflected(read, ADD, following)).toBe(true);
  });

  it("a domain added is done once the sync following it finished, whatever its routing reads yet", () => {
    const read = reads({ routings: { rt1: waiting }, sync: "FINISHED" });
    expect(addDomain.settledBy?.(read, ADD, following)).toEqual({ kind: "succeeded" });
  });

  it("a domain added no sync follows is done once the organization's routings show it in place", () => {
    expect(
      addDomain.settledBy?.(reads({ routings: { rt1: waiting } }), ADD, unfollowed),
    ).toBeNull();
    const read = reads({ routings: { rt1: routing() } });
    expect(addDomain.settledBy?.(read, ADD, unfollowed)).toEqual({ kind: "succeeded" });
  });

  it.each<{
    readonly name: string;
    readonly routings?: Readonly<Record<string, PublicRoutingValue>>;
    readonly unread?: "routings";
    readonly handles: ReadonlyArray<string> | null;
  }>([
    {
      name: "its domains to its service and port, waiting",
      routings: { rt1: waiting },
      handles: ["address:routing:rt1"],
    },
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
      name: "not a routing being removed",
      routings: { rt1: routing({ isSynced: false, deleteOnSync: true }) },
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

  it("a domain whose putting in place failed fails, and says so", () => {
    const read = reads({
      routings: { rt1: routing({ isSynced: false, everSynced: false }) },
      sync: "FAILED",
    });
    expect(addDomain.settledBy?.(read, ADD, following)).toEqual({
      kind: "failed",
      reason: "Zerops couldn't put the domain in place.",
    });
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
    const marked = reads({ routings: { rt1: routing({ isSynced: false, deleteOnSync: true }) } });
    expect(removeDomain.settledBy?.(marked, intent, unfollowed)).toBeNull();
    const gone = reads({ routings: { rt1: routing({ deleteOnSync: true }) } }, [
      left(routingsScope(ORG), "rt1"),
    ]);
    expect(removeDomain.settledBy?.(gone, intent, unfollowed)).toEqual({ kind: "succeeded" });
  });

  it("putting waiting domain changes live is done once none waits", () => {
    const intent = { kind: "publish-domains", orgId: ORG, projectId: "p1" } as const;
    const held = reads({ routings: { rt1: routing({ isSynced: false }) } });
    expect(publishDomains.settledBy?.(held, intent, unfollowed)).toBeNull();
    expect(
      publishDomains.settledBy?.(reads({ routings: { rt1: routing() } }), intent, unfollowed),
    ).toEqual({ kind: "succeeded" });
  });

  it("putting waiting domain changes live is not done while the project's routings are unread", () => {
    const intent = { kind: "publish-domains", orgId: ORG, projectId: "p1" } as const;
    const read = reads({ unread: "routings" });
    expect(publishDomains.settledBy?.(read, intent, unfollowed)).toBeNull();
    expect(publishDomains.effectHandles?.(read, intent) ?? null).toBeNull();
  });

  it("putting waiting port changes live is not done while the organization's ports are unread", () => {
    const intent = { kind: "publish-ports", orgId: ORG, projectId: "p1" } as const;
    const read = reads({ unread: "ports" });
    expect(publishPorts.settledBy?.(read, intent, unfollowed)).toBeNull();
    expect(publishPorts.effectHandles?.(read, intent) ?? null).toBeNull();
    expect(publishPorts.settledBy?.(reads({}), intent, unfollowed)).toEqual({ kind: "succeeded" });
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
    const held = reads({ ports: { pr1: port({ isSynced: false, everSynced: false }) } });
    expect(openPort.settledBy?.(held, intent, unfollowed)).toBeNull();
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

  it("a write a sync follows is observed in the project's processes, one no process follows in its routings", () => {
    expect(addDomain.observedIn?.(ADD, following)).toEqual({
      family: "process",
      listing: "history",
      ownerId: "p1",
    });
    expect(addDomain.observedIn?.(ADD, unfollowed)).toEqual({
      family: "publicRouting",
      listing: PROJECT_ROUTINGS_LISTING,
      ownerId: "p1",
    });
  });
});
