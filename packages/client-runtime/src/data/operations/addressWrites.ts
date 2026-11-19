/**
 * A place's addresses written at Zerops, as the addresses sheet asks: a domain added or removed,
 * its DNS looked up again, a service's zerops.app address turned off, a port opened, changed or
 * closed, and the project's own IPv4 asked for.
 *
 * A domain or port write is in place once Zerops answers it: nothing publishes it after (Zerops
 * dropped publishing public routings; its own app sends none since). It is done once the routings
 * show it, the project's routings held until then. A write a process follows (a zerops.app address
 * turned off, an IPv4 asked for) ends with that process, its project's process history held until
 * then. What the facts show of a write is its handle (`address:`), as the vault's are: how a lost
 * answer is found again, never by asking again. Nothing is said from a listing not read in full.
 *
 * @module data/operations/addressWrites
 */
import type { ZeropsPortRoutingWrite } from "../../zerops/api/routing.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import {
  PROJECT_ROUTINGS_LISTING,
  projectRoutingsScope,
  routingsScope,
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
    readonly "disable-subdomain-access": InProject & { readonly serviceId: string };
    readonly "open-port": InProject & PortRoutingWrite;
    readonly "change-port": InProject & PortRoutingWrite & { readonly portRoutingId: string };
    readonly "close-port": InProject & { readonly portRoutingId: string };
    readonly "request-ipv4": InProject;
  }
}

type AddressKind =
  | "add-domain"
  | "remove-domain"
  | "disable-subdomain-access"
  | "open-port"
  | "change-port"
  | "close-port"
  | "request-ipv4";

/** The kinds whose writes are the project's domain routings. */
const DOMAIN_KINDS: ReadonlySet<AddressKind> = new Set(["add-domain", "remove-domain"]);

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

/**
 * What the facts show of a write — its handles, none while they show nothing of it — and when
 * Zerops last changed each fact it was read from (`stamps`): an end is read only from what came
 * after the write's process.
 */
interface Evidence {
  readonly shown: ReadonlyArray<string>;
  readonly stamps: ReadonlyArray<string | undefined>;
}

/** A routing removed once a complete listing no longer holds it; `null` while none is complete. */
function removal(
  handle: string,
  fact: { readonly kind: string; readonly value?: { readonly lastUpdate?: string } },
  left: boolean | null,
): Evidence | null {
  if (left === null) return null;
  return {
    shown: left ? [handle] : [],
    stamps: fact.kind === "known" ? [fact.value?.lastUpdate] : [],
  };
}

/**
 * What the facts show of each write: nothing shown while they show nothing of it, `null` while
 * what they would be read from is not read in full.
 */
const SHOWS: {
  readonly [K in AddressKind]: (read: ProjectionReads, intent: IntentOf<K>) => Evidence | null;
} = {
  "add-domain": (read, intent) => {
    const routings = routingsIn(read, intent.orgId, intent.projectId);
    if (routings === null) return null;
    const ours = routings.filter(
      ({ value }) =>
        sameSet(
          value.domains.map(({ domainName }) => domainName),
          intent.domains,
        ) &&
        value.locations.some(
          ({ serviceStackId, port }) => serviceStackId === intent.serviceId && port === intent.port,
        ),
    );
    return {
      shown: ours.map(({ id }) => `address:routing:${id}`),
      stamps: ours.map(({ value }) => value.lastUpdate),
    };
  },
  "remove-domain": (read, intent) => {
    const fact = read.fact("publicRouting", intent.routingId);
    if (intent.keep.length === 0)
      return removal(
        `address:gone:${intent.routingId}`,
        fact,
        leftListing(
          read,
          [routingsScope(intent.orgId), projectRoutingsScope(intent.orgId, intent.projectId)],
          intent.routingId,
        ),
      );
    if (fact.kind !== "known") return null;
    return {
      shown: sameSet(
        fact.value.domains.map(({ domainName }) => domainName),
        intent.keep,
      )
        ? [`address:kept:${intent.routingId}`]
        : [],
      stamps: [fact.value.lastUpdate],
    };
  },
  "disable-subdomain-access": (read, intent) => {
    const service = read.fact("service", intent.serviceId);
    if (service.kind !== "known") return null;
    return {
      shown: service.value.subdomainAccess === false ? [`address:closed:${intent.serviceId}`] : [],
      stamps: [service.value.lastUpdate],
    };
  },
  "open-port": (read, intent) => {
    const ports = portsIn(read, intent.orgId, intent.projectId);
    if (ports === null) return null;
    const ours = ports.filter(
      ({ value }) =>
        value.publicPort === intent.publicPort &&
        value.publicIpType === intent.publicIpType &&
        value.serviceStackId === intent.serviceId,
    );
    return {
      shown: ours.map(({ id }) => `address:port:${id}`),
      stamps: ours.map(({ value }) => value.lastUpdate),
    };
  },
  "change-port": (read, intent) => {
    const fact = read.fact("publicPortRouting", intent.portRoutingId);
    if (fact.kind !== "known") return null;
    const port = fact.value;
    return {
      shown:
        port.publicPort === intent.publicPort &&
        port.internalPort === intent.internalPort &&
        port.internalProtocol === intent.internalProtocol &&
        port.firewallPolicy === intent.firewallPolicy &&
        sameSet(port.firewallIpRanges, intent.firewallIpRanges)
          ? [`address:port:${intent.portRoutingId}`]
          : [],
      stamps: [port.lastUpdate],
    };
  },
  "close-port": (read, intent) => {
    const fact = read.fact("publicPortRouting", intent.portRoutingId);
    return removal(
      `address:gone:${intent.portRoutingId}`,
      fact,
      leftListing(read, [portRoutingsScope(intent.orgId)], intent.portRoutingId),
    );
  },
  "request-ipv4": (read, intent) => {
    const project = read.fact("project", intent.projectId);
    if (project.kind !== "known") return null;
    return {
      shown:
        typeof project.value.publicIpV4 === "string" ? [`address:ipv4:${intent.projectId}`] : [],
      stamps: [project.value.lastUpdate],
    };
  },
};

/** Whether a process follows the write: its receipt is that process's. */
const followsProcess = (receipt: OperationReceipt) =>
  receipt.affected.some(({ family }) => family === "process");

/**
 * Whether Zerops changed every fact after the process the receipt follows ended, as its row
 * says: somebody's change since, read in full.
 */
function changedSinceEnd(
  read: ProjectionReads,
  receipt: OperationReceipt,
  stamps: ReadonlyArray<string | undefined>,
) {
  const process = read.fact("process", receipt.handles[0] ?? "");
  if (process.kind !== "known" || process.value.finished === undefined) return false;
  const ended = Date.parse(process.value.finished);
  return (
    stamps.length > 0 && stamps.every((stamp) => stamp !== undefined && Date.parse(stamp) > ended)
  );
}

/** What the person is told when the process that follows it fails. */
const FAILED: { readonly [K in AddressKind]: string } = {
  "add-domain": "Zerops couldn't put the domain in place.",
  "remove-domain": "Zerops couldn't remove the domain.",
  "disable-subdomain-access": "Zerops couldn't close the address.",
  "open-port": "Zerops couldn't open the port.",
  "change-port": "Zerops couldn't change the port.",
  "close-port": "Zerops couldn't close the port.",
  "request-ipv4": "Zerops couldn't give the project its own IPv4.",
};

function addressKind<K extends AddressKind>(kind: K): OperationKind<K> {
  const shows = SHOWS[kind] as (read: ProjectionReads, intent: IntentOf<K>) => Evidence | null;
  // Every address intent is one project's (`InProject`); the generic kind cannot say so.
  const projectOf = (intent: IntentOf<K>) => (intent as unknown as InProject).projectId;
  return {
    kind,
    executor: "zerops",
    reflected: (read, intent) => (shows(read, intent)?.shown.length ?? 0) > 0,
    settledBy: (read, intent, receipt): Settlement | null => {
      const evidence = shows(read, intent);
      if ((evidence?.shown.length ?? 0) > 0) return { kind: "succeeded" };
      if (!followsProcess(receipt)) return null;
      const end = settledByProcess(read, receipt, () => FAILED[kind]);
      if (end?.kind !== "succeeded") return end;
      // Finished while the facts don't show it yet: done once Zerops changed them after it ended
      // (somebody's change since), never on facts from before it, which would take back what the
      // sheet shows as the write's.
      return evidence !== null && changedSinceEnd(read, receipt, evidence.stamps) ? end : null;
    },
    observedIn: (intent, receipt) => {
      if (followsProcess(receipt)) return historyHolding(projectOf(intent), receipt);
      // The organization's routings are its navigation, always read; the project's own listing
      // is what a viewer refused them reads, held while no screen does.
      return DOMAIN_KINDS.has(kind) && receipt.outcome.kind === "pending"
        ? { family: "publicRouting", listing: PROJECT_ROUTINGS_LISTING, ownerId: projectOf(intent) }
        : null;
    },
    effectHandles: (read, intent) => shows(read, intent)?.shown ?? null,
  };
}

export const addDomain = addressKind("add-domain");
export const removeDomain = addressKind("remove-domain");
export const disableSubdomainAccess = addressKind("disable-subdomain-access");
export const openPort = addressKind("open-port");
const changePort = addressKind("change-port");
export const closePort = addressKind("close-port");
export const requestIpv4 = addressKind("request-ipv4");

/** Looking a domain up again: Zerops's answer is its end; the next check's row is its evidence. */
const checkDomainDns: OperationKind<"check-domain-dns"> = {
  kind: "check-domain-dns",
  executor: "zerops",
  reflected: () => true,
};

export const ADDRESS_WRITE_KINDS = [
  addDomain,
  removeDomain,
  checkDomainDns,
  disableSubdomainAccess,
  openPort,
  changePort,
  closePort,
  requestIpv4,
] as const;
