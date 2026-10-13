/**
 * A place's addresses written at Zerops, as the addresses sheet asks: a domain added or removed,
 * its DNS looked up again, a service's zerops.app address turned off, a port opened, changed or
 * closed, the project's own IPv4 asked for, and a project's waiting changes put in place.
 *
 * A domain or port write is followed by putting the project's routings of its kind in place, a
 * process that puts every waiting one there too. The write is done once the organization's
 * routings show it in place, and failed if that process failed; the project's process history is
 * held until then. A lost answer is resolved from the same routings, never by asking again: what
 * they show of the write is its handle (`address:`), as the vault's are.
 *
 * @module data/operations/addressWrites
 */
import type { ZeropsPortRoutingWrite } from "../../zerops/api.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import {
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

/** The project's domain routings as they read now: the organization's listing, or the project's. */
function routingsIn(
  read: ProjectionReads,
  orgId: string,
  projectId: string,
): ReadonlyArray<{ readonly id: string; readonly value: PublicRoutingValue }> {
  const routings = projectRoutings(read, { orgId, projectId });
  return routings.kind === "read" ? routings.rows : [];
}

function portsIn(read: ProjectionReads, projectId: string) {
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

const inPlace = (value: { readonly isSynced: boolean; readonly deleteOnSync?: boolean }) =>
  value.isSynced && value.deleteOnSync !== true;

/** What the routings show of each write now, as handles; empty while they show nothing of it. */
const SHOWS: {
  readonly [K in AddressKind]: (
    read: ProjectionReads,
    intent: IntentOf<K>,
  ) => ReadonlyArray<string>;
} = {
  "add-domain": (read, intent) =>
    routingsIn(read, intent.orgId, intent.projectId)
      .filter(
        ({ value }) =>
          inPlace(value) &&
          intent.domains.every((name) => value.domains.some((d) => d.domainName === name)),
      )
      .map(({ id }) => `address:routing:${id}`),
  "remove-domain": (read, intent) => {
    if (intent.keep.length === 0)
      return leftListing(
        read,
        [routingsScope(intent.orgId), projectRoutingsScope(intent.orgId, intent.projectId)],
        intent.routingId,
      ) === true
        ? [`address:gone:${intent.routingId}`]
        : [];
    const fact = read.fact("publicRouting", intent.routingId);
    if (fact.kind !== "known" || !inPlace(fact.value)) return [];
    return sameSet(
      fact.value.domains.map(({ domainName }) => domainName),
      intent.keep,
    )
      ? [`address:kept:${intent.routingId}`]
      : [];
  },
  "publish-domains": (read, intent) =>
    routingsIn(read, intent.orgId, intent.projectId).some(
      ({ value }) => value.isEditable === true && !value.isSynced,
    )
      ? []
      : [`address:published:${intent.projectId}`],
  "disable-subdomain-access": (read, intent) => {
    const service = read.fact("service", intent.serviceId);
    return service.kind === "known" && service.value.subdomainAccess === false
      ? [`address:closed:${intent.serviceId}`]
      : [];
  },
  "open-port": (read, intent) =>
    portsIn(read, intent.projectId)
      .filter(
        ({ value }) =>
          inPlace(value) &&
          value.publicPort === intent.publicPort &&
          value.publicIpType === intent.publicIpType &&
          value.serviceStackId === intent.serviceId,
      )
      .map(({ id }) => `address:port:${id}`),
  "change-port": (read, intent) => {
    const fact = read.fact("publicPortRouting", intent.portRoutingId);
    return fact.kind === "known" &&
      inPlace(fact.value) &&
      fact.value.publicPort === intent.publicPort &&
      fact.value.firewallPolicy === intent.firewallPolicy &&
      sameSet(fact.value.firewallIpRanges, intent.firewallIpRanges)
      ? [`address:port:${intent.portRoutingId}`]
      : [];
  },
  "close-port": (read, intent) =>
    leftListing(read, [portRoutingsScope(intent.orgId)], intent.portRoutingId) === true
      ? [`address:gone:${intent.portRoutingId}`]
      : [],
  "publish-ports": (read, intent) =>
    portsIn(read, intent.projectId).some(({ value }) => !value.isSynced)
      ? []
      : [`address:published-ports:${intent.projectId}`],
  "request-ipv4": (read, intent) => {
    const project = read.fact("project", intent.projectId);
    return project.kind === "known" && (project.value as { publicIpV4?: string }).publicIpV4
      ? [`address:ipv4:${intent.projectId}`]
      : [];
  },
};

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
  ) => ReadonlyArray<string>;
  return {
    kind,
    executor: "zerops",
    reflected: (read, intent) => shows(read, intent).length > 0,
    settledBy: (read, intent, receipt: OperationReceipt): Settlement | null => {
      if (shows(read, intent).length > 0) return { kind: "succeeded" };
      const end = settledByProcess(read, receipt, () => FAILED[kind]);
      return end?.kind === "failed" ? end : null;
    },
    // Every address intent is one project's (`InProject`); the generic kind cannot say so.
    observedIn: (intent, receipt) =>
      historyHolding((intent as unknown as InProject).projectId, receipt),
    effectHandles: (read, intent) => shows(read, intent),
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
