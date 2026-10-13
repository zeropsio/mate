/**
 * A place's addresses written at Zerops, as the addresses sheet asks: a domain added or removed,
 * its DNS looked up again, a service's zerops.app address turned off, a port opened, changed or
 * closed, the project's own IPv4 asked for, and a project's waiting changes put in place.
 *
 * A domain or port write is followed by putting the project's routings of its kind in place, a
 * process that puts every waiting one there too: that process's end is the write's, its project's
 * process history held until then. A write no process follows — none to follow, or found after a
 * lost answer — is done once the routings show it in place, the project's routings held until
 * then. What the routings show of a write is its handle (`address:`), as the vault's are: put in
 * place or still waiting, it is how a lost answer is found again, never by asking again. Nothing
 * is said from a listing not read in full.
 *
 * @module data/operations/addressWrites
 */
import type { ZeropsPortRoutingWrite } from "../../zerops/api.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import {
  PROJECT_ROUTINGS_LISTING,
  projectRoutingsScope,
  routingsScope,
  type PublicRoutingValue,
} from "../families/publicRouting.ts";
import type { OperationReceipt, ScopeKey } from "../model.ts";
import { projectRoutings } from "../projections/publicAccess.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind, Settlement } from "./kind.ts";
import { historyHolding, settledByProcess } from "./processEnd.ts";

/** A port as a write sends it: the service it opens, where, and who may connect. */
export type PortRoutingWrite = ZeropsPortRoutingWrite & { readonly serviceId: string };

interface InProject {
  /** The organization whose link observes the project. */
  readonly orgId: string;
  readonly projectId: string;
}

declare module "../model.ts" {
  interface OperationIntents {
    readonly "add-domain": InProject & {
      /** The domains, put on one routing: `shop.com` and `www.shop.com` answer alike. */
      readonly domains: ReadonlyArray<string>;
      readonly serviceId: string;
      readonly port: number;
    };
    readonly "remove-domain": InProject & {
      readonly routingId: string;
      readonly domainName: string;
      /** The routing's other domains, kept; none, and the routing goes. */
      readonly keep: ReadonlyArray<string>;
      /** The routing as it reads, sent again with `keep`. */
      readonly locations: ReadonlyArray<{
        readonly path: string;
        readonly port: number;
        readonly serviceStackId: string;
      }>;
      readonly sslEnabled: boolean;
    };
    readonly "check-domain-dns": InProject & { readonly routingId: string };
    readonly "publish-domains": InProject;
    readonly "disable-subdomain-access": InProject & { readonly serviceId: string };
    readonly "open-port": InProject & PortRoutingWrite;
    readonly "change-port": InProject & PortRoutingWrite & { readonly portRoutingId: string };
    readonly "close-port": InProject & { readonly portRoutingId: string };
    readonly "publish-ports": InProject;
    readonly "request-ipv4": InProject;
  }
}

type AddressKind =
  | "add-domain"
  | "remove-domain"
  | "publish-domains"
  | "disable-subdomain-access"
  | "open-port"
  | "change-port"
  | "close-port"
  | "publish-ports"
  | "request-ipv4";

/** The kinds whose writes are the project's domain routings. */
const DOMAIN_KINDS: ReadonlySet<AddressKind> = new Set([
  "add-domain",
  "remove-domain",
  "publish-domains",
]);

type Rows<V> = ReadonlyArray<{ readonly id: string; readonly value: V }>;

/** The project's domain routings as a complete listing holds them; `null` while none does. */
function routingsIn(read: ProjectionReads, orgId: string, projectId: string) {
  const routings = projectRoutings(read, { orgId, projectId });
  return routings.kind === "read" && routings.complete ? routings.rows : null;
}

/** The project's ports as the organization's complete listing holds them; `null` while it doesn't. */
function portsIn(
  read: ProjectionReads,
  orgId: string,
  projectId: string,
): Rows<PublicPortRoutingValue> | null {
  if (read.coverage(portRoutingsScope(orgId)) !== "complete") return null;
  const rows: { id: string; value: PublicPortRoutingValue }[] = [];
  for (const id of read.index("portRoutingProject", projectId)) {
    const fact = read.fact("publicPortRouting", id);
    if (fact.kind === "known") rows.push({ id, value: fact.value });
  }
  return rows;
}

/**
 * Whether a complete listing no longer holds the routing: leaving says it serves nothing, though
 * the fact stays known (the families' leaving is `removed`). `null` while no listing is complete.
 */
function leftListing(read: ProjectionReads, scopes: ReadonlyArray<ScopeKey>, id: string) {
  for (const scope of scopes) {
    const listing = read.members(scope);
    if (listing.coverage === "complete") return !listing.ids.includes(id);
  }
  return null;
}

const sameSet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((item) => right.includes(item));

const removing = (value: { readonly deleteOnSync?: boolean }) => value.deleteOnSync === true;

/** A write the routings show: its handle, and whether it is in place yet. */
interface Shown {
  readonly handle: string;
  readonly live: boolean;
}

/** A routing being removed until a listing no longer holds it; `null` while none is complete. */
function going(
  handle: string,
  fact: { readonly kind: string; readonly value?: { readonly deleteOnSync?: boolean } },
  left: boolean | null,
): ReadonlyArray<Shown> | null {
  if (left === null) return null;
  if (left) return [{ handle, live: true }];
  return fact.kind === "known" && fact.value !== undefined && removing(fact.value)
    ? [{ handle, live: false }]
    : [];
}

/**
 * What the facts show of each write: empty while they show nothing of it, `null` while what they
 * would be read from is not read in full.
 */
const SHOWS: {
  readonly [K in AddressKind]: (
    read: ProjectionReads,
    intent: IntentOf<K>,
  ) => ReadonlyArray<Shown> | null;
} = {
  "add-domain": (read, intent) =>
    routingsIn(read, intent.orgId, intent.projectId)
      ?.filter(
        ({ value }) =>
          !removing(value) &&
          sameSet(
            value.domains.map(({ domainName }) => domainName),
            intent.domains,
          ) &&
          value.locations.some(
            ({ serviceStackId, port }) =>
              serviceStackId === intent.serviceId && port === intent.port,
          ),
      )
      .map(({ id, value }) => ({ handle: `address:routing:${id}`, live: value.isSynced })) ?? null,
  "remove-domain": (read, intent) => {
    const handle = `address:gone:${intent.routingId}`;
    const fact = read.fact("publicRouting", intent.routingId);
    if (intent.keep.length === 0)
      return going(
        handle,
        fact,
        leftListing(
          read,
          [routingsScope(intent.orgId), projectRoutingsScope(intent.orgId, intent.projectId)],
          intent.routingId,
        ),
      );
    if (fact.kind !== "known") return null;
    return sameSet(
      fact.value.domains.map(({ domainName }) => domainName),
      intent.keep,
    )
      ? [{ handle: `address:kept:${intent.routingId}`, live: fact.value.isSynced }]
      : [];
  },
  "publish-domains": (read, intent) => {
    const routings = routingsIn(read, intent.orgId, intent.projectId);
    if (routings === null) return null;
    return routings.some(({ value }) => value.isEditable === true && !value.isSynced)
      ? []
      : [{ handle: `address:published:${intent.projectId}`, live: true }];
  },
  "disable-subdomain-access": (read, intent) => {
    const service = read.fact("service", intent.serviceId);
    if (service.kind !== "known") return null;
    return service.value.subdomainAccess === false
      ? [{ handle: `address:closed:${intent.serviceId}`, live: true }]
      : [];
  },
  "open-port": (read, intent) =>
    portsIn(read, intent.orgId, intent.projectId)
      ?.filter(
        ({ value }) =>
          !removing(value) &&
          value.publicPort === intent.publicPort &&
          value.publicIpType === intent.publicIpType &&
          value.serviceStackId === intent.serviceId,
      )
      .map(({ id, value }) => ({ handle: `address:port:${id}`, live: value.isSynced })) ?? null,
  "change-port": (read, intent) => {
    const fact = read.fact("publicPortRouting", intent.portRoutingId);
    if (fact.kind !== "known") return null;
    const port = fact.value;
    return port.publicPort === intent.publicPort &&
      port.internalPort === intent.internalPort &&
      port.internalProtocol === intent.internalProtocol &&
      port.firewallPolicy === intent.firewallPolicy &&
      sameSet(port.firewallIpRanges, intent.firewallIpRanges)
      ? [{ handle: `address:port:${intent.portRoutingId}`, live: port.isSynced && !removing(port) }]
      : [];
  },
  "close-port": (read, intent) =>
    going(
      `address:gone:${intent.portRoutingId}`,
      read.fact("publicPortRouting", intent.portRoutingId),
      leftListing(read, [portRoutingsScope(intent.orgId)], intent.portRoutingId),
    ),
  "publish-ports": (read, intent) => {
    const ports = portsIn(read, intent.orgId, intent.projectId);
    if (ports === null) return null;
    return ports.some(({ value }) => !value.isSynced)
      ? []
      : [{ handle: `address:published-ports:${intent.projectId}`, live: true }];
  },
  "request-ipv4": (read, intent) => {
    const project = read.fact("project", intent.projectId);
    if (project.kind !== "known") return null;
    return typeof project.value.publicIpV4 === "string"
      ? [{ handle: `address:ipv4:${intent.projectId}`, live: true }]
      : [];
  },
};

/** Whether a process follows the write: its receipt is that process's. */
const followsProcess = (receipt: OperationReceipt) =>
  receipt.affected.some(({ family }) => family === "process");

/** What the person is told when the process that puts it in place fails. */
const FAILED: { readonly [K in AddressKind]: string } = {
  "add-domain": "Zerops couldn't put the domain in place.",
  "remove-domain": "Zerops couldn't remove the domain.",
  "publish-domains": "Zerops couldn't put the waiting domain changes in place.",
  "disable-subdomain-access": "Zerops couldn't close the address.",
  "open-port": "Zerops couldn't open the port.",
  "change-port": "Zerops couldn't change the port.",
  "close-port": "Zerops couldn't close the port.",
  "publish-ports": "Zerops couldn't put the waiting port changes in place.",
  "request-ipv4": "Zerops couldn't give the project its own IPv4.",
};

function addressKind<K extends AddressKind>(kind: K): OperationKind<K> {
  const shows = SHOWS[kind] as (
    read: ProjectionReads,
    intent: IntentOf<K>,
  ) => ReadonlyArray<Shown> | null;
  // Every address intent is one project's (`InProject`); the generic kind cannot say so.
  const projectOf = (intent: IntentOf<K>) => (intent as unknown as InProject).projectId;
  return {
    kind,
    executor: "zerops",
    reflected: (read, intent) => (shows(read, intent)?.length ?? 0) > 0,
    settledBy: (read, intent, receipt): Settlement | null => {
      if (followsProcess(receipt)) return settledByProcess(read, receipt, () => FAILED[kind]);
      return shows(read, intent)?.some(({ live }) => live) === true ? { kind: "succeeded" } : null;
    },
    observedIn: (intent, receipt) => {
      if (followsProcess(receipt)) return historyHolding(projectOf(intent), receipt);
      // The organization's routings are its navigation, always read; the project's own listing
      // is what a viewer refused them reads, held while no screen does.
      return DOMAIN_KINDS.has(kind) && receipt.outcome.kind === "pending"
        ? { family: "publicRouting", listing: PROJECT_ROUTINGS_LISTING, ownerId: projectOf(intent) }
        : null;
    },
    effectHandles: (read, intent) => shows(read, intent)?.map(({ handle }) => handle) ?? null,
  };
}

export const addDomain = addressKind("add-domain");
export const removeDomain = addressKind("remove-domain");
export const publishDomains = addressKind("publish-domains");
export const disableSubdomainAccess = addressKind("disable-subdomain-access");
export const openPort = addressKind("open-port");
export const changePort = addressKind("change-port");
export const closePort = addressKind("close-port");
export const publishPorts = addressKind("publish-ports");
export const requestIpv4 = addressKind("request-ipv4");

/** Looking a domain up again: Zerops's answer is its end; the next check's row is its evidence. */
export const checkDomainDns: OperationKind<"check-domain-dns"> = {
  kind: "check-domain-dns",
  executor: "zerops",
  reflected: () => true,
};

export const ADDRESS_WRITE_KINDS = [
  addDomain,
  removeDomain,
  checkDomainDns,
  publishDomains,
  disableSubdomainAccess,
  openPort,
  changePort,
  closePort,
  publishPorts,
  requestIpv4,
] as const;
