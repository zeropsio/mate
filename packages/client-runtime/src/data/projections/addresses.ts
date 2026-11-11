/**
 * One place's addresses, as the addresses sheet shows them: every way the internet reaches one
 * project. Its own domains and how far each is from answering, each service's zerops.app address
 * and its switch, the project's IP addresses, and the ports it opens straight to the internet with
 * who may connect. Joined from the organization's routings, port routings and services and the
 * project's row; never a read of its own.
 *
 * A domain or port change waits until the project's routings of that kind are put in place, and
 * putting one in place puts every waiting one there too, anybody's (read 2026-10-14): `waiting`
 * names them, so a surface asks before it puts somebody else's change live.
 *
 * @module data/projections/addresses
 */
import type { ZeropsProject } from "../../zerops/api.ts";
import { isZcpService } from "../../zerops/candidates.ts";
import { isRuntimeService } from "../../zerops/topology.ts";
import { derivePublicRoutes } from "../../zerops/publicRoutes.ts";
import { projectsScope } from "../families/project.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import type { PublicRoutingDomain, PublicRoutingValue } from "../families/publicRouting.ts";
import type { ServiceValue } from "../families/service.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness } from "./freshness.ts";
import type { ProjectKey } from "./processes.ts";
import { projectRoutings } from "./publicAccess.ts";
import { projectServices } from "./services.ts";

/**
 * How far a domain is from answering, in the order a new one goes through:
 * - `going-live`: added, waiting to be put in place;
 * - `changing`: in place before, an edit of its routing waiting;
 * - `removing`: removed, waiting to be put in place;
 * - `dns`: in place, the person's DNS not pointing here yet (checking, or pointing nowhere);
 * - `elsewhere`: in place, the DNS check found it at another address;
 * - `certificate`: the DNS is right, its certificate on its way;
 * - `certificate-failed`: the certificate could not be installed;
 * - `live`: it answers.
 */
export type DomainFace =
  | "going-live"
  | "changing"
  | "removing"
  | "dns"
  | "elsewhere"
  | "certificate"
  | "certificate-failed"
  | "live";

/** Where a domain or a path of it leads: a service's web port. */
export interface AddressTarget {
  readonly serviceId: string;
  /** The service's hostname, or its id while the service is not read. */
  readonly serviceName: string;
  readonly port: number;
  readonly path: string;
}

export interface AddressDomain {
  readonly routingId: string;
  readonly domainName: string;
  /** Every domain its routing holds, this one included: removing one keeps the others. */
  readonly routingDomains: ReadonlyArray<string>;
  /** Where it leads, its routing's locations in order. */
  readonly targets: ReadonlyArray<AddressTarget>;
  readonly sslEnabled: boolean;
  readonly face: DomainFace;
  /** The address it answers at once live: its first location's. */
  readonly url: string;
  /** What the last DNS check found it at; empty while it points nowhere. */
  readonly resolvedIps: ReadonlyArray<string>;
  /** Who answers for its DNS: where the person adds its records. */
  readonly nameServers: ReadonlyArray<string>;
  /** When the platform last looked it up, on its clock. */
  readonly checkedAt?: string;
  /** Why its certificate could not be installed, as the platform says it. */
  readonly sslError?: string;
}

/** A service's zerops.app address and its switch: one per service that serves the web. */
export interface ZeropsAddress {
  readonly serviceId: string;
  readonly serviceName: string;
  /** Whether its zerops.app address is on (`subdomainAccess`). */
  readonly on: boolean;
  /** Its addresses while on, one per web port. */
  readonly hosts: ReadonlyArray<{
    readonly port: number;
    readonly url: string;
    readonly host: string;
  }>;
  /** The web port turning it on publishes: its lowest. */
  readonly port: number;
}

export interface PlaceIps {
  /** The project's own IPv6: every project has one. */
  readonly v6?: string;
  /** The project's own IPv4, the paid add-on; absent while it has none. */
  readonly ownV4?: string;
  /**
   * The region's shared IPv4, free, for web traffic only: an A record may point at it, with an
   * AAAA at `v6` beside it. Absent for a region this build does not know.
   */
  readonly sharedV4?: string;
  /** The project's own DNS name, the target of a CNAME. */
  readonly zone?: string;
  /** Whether that name answers on the shared IPv4 too, not only on `v6` (`publicIpV4Shared`). */
  readonly zoneHasSharedV4: boolean;
}

/** One port opened straight to the internet, and who may connect. */
export interface DirectPort {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  /** `IP_V6` or `IP_V4`. */
  readonly publicIpType: string;
  readonly publicPort: number;
  readonly internalPort: number;
  /** `tcp` or `udp`. */
  readonly internalProtocol: string;
  /** `WHITELIST`: only `ranges` may connect; `BLACKLIST`: everyone but them. */
  readonly firewallPolicy: string;
  readonly ranges: ReadonlyArray<string>;
  readonly face: "going-live" | "changing" | "removing" | "live";
  /** Where a client connects, `[ipv6]:port` or `ipv4:port`; absent while the IP is not read. */
  readonly address?: string;
}

/** A change waiting to be put in place: putting any change of its kind live puts it live too. */
export interface WaitingChange {
  readonly id: string;
  /** What it does, in a person's words: "shop.com → app · port 3000", "Removing api.shop.com". */
  readonly label: string;
}

/** A service port a domain may point at, or one that may be opened straight to the internet. */
export interface ServicePortChoice {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly port: number;
  readonly protocol: string;
}

export interface PlaceAddresses {
  /** `reading` until services, routings and the project are read; `failed` where any is refused. */
  readonly state: "ready" | "reading" | "failed";
  readonly domains: ReadonlyArray<AddressDomain>;
  readonly zerops: ReadonlyArray<ZeropsAddress>;
  readonly ips: PlaceIps;
  /** The ports, read apart: a viewer refused them still sees the rest. */
  readonly portsState: "ready" | "reading" | "failed";
  readonly ports: ReadonlyArray<DirectPort>;
  /** Web ports a new domain may point at, by service. */
  readonly webTargets: ReadonlyArray<ServicePortChoice>;
  /** Ports that may be opened straight to the internet, by service. */
  readonly portTargets: ReadonlyArray<ServicePortChoice>;
  /** Domain changes waiting to be put in place, anybody's. */
  readonly waitingDomains: ReadonlyArray<WaitingChange>;
  /** Port changes waiting to be put in place, anybody's. */
  readonly waitingPorts: ReadonlyArray<WaitingChange>;
  /** The organization's routings are refused to the viewer: demand the project's own listing. */
  readonly readsProject: boolean;
  /**
   * The platform says nothing deployed runs here: it has runtimes, and every one holds no deploy
   * (`activeAppVersion: null`). False where one runs a deploy, or that is not read.
   */
  readonly nothingDeployed: boolean;
}

/** A place read in full that holds no domain of its own: a domain is worth offering. */
export function lacksOwnDomain(place: PlaceAddresses): boolean {
  return place.state === "ready" && place.domains.length === 0;
}

/**
 * The shared IPv4 of each region, by the name its project zones carry: a project's zone answers on
 * it while `publicIpV4Shared` is on (`dig +short A <zone>`, read 2026-10-14). The platform's rows
 * name it nowhere.
 */
export const SHARED_IPV4: Readonly<Record<string, string>> = { prg1: "93.185.106.128" };

/** The region a project lives in, from its zone (`<id>.prg1-zerops.zone`) or subdomain host. */
export function regionOf(project: Pick<ZeropsProject, "publicZone" | "zeropsSubdomainHost">) {
  const zone = /\.([a-z0-9]+)-zerops\.zone\.?$/u.exec(project.publicZone ?? "");
  if (zone !== null) return zone[1];
  const host = /\.([a-z0-9]+)\.zerops\.app\.?$/u.exec(project.zeropsSubdomainHost ?? "");
  return host?.[1];
}

export function placeIps(project: ZeropsProject): PlaceIps {
  const region = regionOf(project);
  const sharedV4 = region === undefined ? undefined : SHARED_IPV4[region];
  return {
    ...(project.publicIpV6 === undefined ? {} : { v6: project.publicIpV6 }),
    ...(project.publicIpV4 == null ? {} : { ownV4: project.publicIpV4 }),
    ...(sharedV4 === undefined ? {} : { sharedV4 }),
    ...(project.publicZone === undefined ? {} : { zone: project.publicZone }),
    zoneHasSharedV4: project.publicIpV4Shared === true,
  };
}

/** Whether the DNS check found the domain at an address that is none of the project's. */
function foundElsewhere(domain: PublicRoutingDomain, ips: PlaceIps): boolean {
  const ours = new Set([ips.v6, ips.ownV4, ips.sharedV4].filter((ip) => ip !== undefined));
  const found = domain.resolvedIps ?? [];
  return found.some((ip) => !ours.has(ip));
}

export function domainFace(
  routing: PublicRoutingValue,
  domain: PublicRoutingDomain,
  ips: PlaceIps,
): DomainFace {
  if (routing.deleteOnSync === true) return "removing";
  if (!routing.isSynced) return routing.everSynced === true ? "changing" : "going-live";
  if (domain.sslError !== undefined) return "certificate-failed";
  if (domain.dnsCheckStatus !== "OK")
    return domain.dnsCheckStatus === "FAILED" && foundElsewhere(domain, ips) ? "elsewhere" : "dns";
  if (!routing.sslEnabled) return "live";
  // A certificate being renewed is the one in place still serving.
  return domain.sslStatus === "ACTIVE" || domain.sslStatus === "BEING_RENEWED"
    ? "live"
    : "certificate";
}

export function portFace(port: PublicPortRoutingValue): DirectPort["face"] {
  if (port.deleteOnSync === true) return "removing";
  if (!port.isSynced) return port.everSynced === true ? "changing" : "going-live";
  return "live";
}

/** Where a client connects to an open port. */
export function portAddress(port: PublicPortRoutingValue, ips: PlaceIps): string | undefined {
  if (port.publicIpType === "IP_V6")
    return ips.v6 === undefined ? undefined : `[${ips.v6}]:${port.publicPort}`;
  return ips.ownV4 === undefined ? undefined : `${ips.ownV4}:${port.publicPort}`;
}

export interface DnsRecord {
  readonly type: "A" | "AAAA" | "CNAME";
  /** The record's name: the domain itself, in full. */
  readonly name: string;
  readonly value: string;
}

/**
 * The records a domain needs at the person's DNS provider. An A at the project's own IPv4, else
 * at the region's shared one, and an AAAA at its IPv6: the pair works for a domain and for any
 * subdomain of it. On the shared IPv4 the AAAA is required, not only advised: the shared address
 * tells its projects' domains apart by it.
 *
 * `cname` is the one-record way, at the project's zone: for a subdomain, or an apex where the DNS
 * provider flattens CNAMEs. The zone answers on the project's IPv6, and on the shared IPv4 only
 * while that is included in it (`ipv4`); with an IPv4 of the project's own, whether the zone
 * answers there is unread, so no CNAME is offered.
 *
 * A wildcard (`*.shop.com`) takes the same records under its own name, and its certificate a
 * CNAME more: `_acme-challenge.shop.com` at `shop.com.zerops.zone`, Zerops' DNS-01 answer.
 */
export function dnsAdvice(
  domainName: string,
  ips: PlaceIps,
): {
  readonly records: ReadonlyArray<DnsRecord>;
  /** Both records are needed: the A points at the shared IPv4. */
  readonly bothRequired: boolean;
  readonly cname?: DnsRecord & { readonly ipv4: boolean };
  readonly certificate?: DnsRecord;
} {
  const v4 = ips.ownV4 ?? ips.sharedV4;
  const records: DnsRecord[] = [];
  if (v4 !== undefined) records.push({ type: "A", name: domainName, value: v4 });
  if (ips.v6 !== undefined) records.push({ type: "AAAA", name: domainName, value: ips.v6 });
  const wildcardOf = domainName.startsWith("*.") ? domainName.slice(2) : undefined;
  return {
    records,
    bothRequired: ips.ownV4 === undefined && v4 !== undefined,
    ...(ips.zone !== undefined && (ips.zoneHasSharedV4 || ips.ownV4 === undefined)
      ? {
          cname: {
            type: "CNAME" as const,
            name: domainName,
            value: ips.zone,
            ipv4: ips.zoneHasSharedV4,
          },
        }
      : {}),
    ...(wildcardOf === undefined
      ? {}
      : {
          certificate: {
            type: "CNAME" as const,
            name: `_acme-challenge.${wildcardOf}`,
            value: `${wildcardOf}.zerops.zone`,
          },
        }),
  };
}

/**
 * The ports a domain may point at: the ones Zerops routes HTTP to, or that declare an HTTP scheme
 * (set at deploy, before any routing exists) — zcp's `webPorts` holds the Chief to the same.
 */
const webPorts = (service: ServiceValue) =>
  (service.ports ?? []).filter(
    (port) => port.httpRouting === true || port.scheme === "http" || port.scheme === "https",
  );

const reachable = (service: ServiceValue) => service.isSystem !== true && !isZcpService(service);

function zeropsAddresses(
  project: ZeropsProject,
  services: ReadonlyArray<ServiceValue>,
): ReadonlyArray<ZeropsAddress> {
  return services.filter(reachable).flatMap((service): ReadonlyArray<ZeropsAddress> => {
    const ports = webPorts(service)
      .map((port) => port.port)
      .sort((left, right) => left - right);
    const first = ports[0];
    if (first === undefined) return [];
    const on = service.subdomainAccess === true;
    return [
      {
        serviceId: service.id,
        serviceName: service.name,
        on,
        hosts: on
          ? derivePublicRoutes(project, [service]).map(({ port, url, host }) => ({
              port,
              url,
              host,
            }))
          : [],
        port: first,
      },
    ];
  });
}

const choice = (service: ServiceValue, port: { port: number; protocol?: string }) => ({
  serviceId: service.id,
  serviceName: service.name,
  port: port.port,
  protocol: port.protocol ?? "tcp",
});

function domainsOf(
  routings: ReadonlyArray<{ readonly id: string; readonly value: PublicRoutingValue }>,
  names: ReadonlyMap<string, string>,
  ips: PlaceIps,
): ReadonlyArray<AddressDomain> {
  return routings
    .filter(({ value }) => value.isEditable === true)
    .flatMap(({ id, value }) => {
      const targets = value.locations.map((location) => ({
        serviceId: location.serviceStackId,
        serviceName: names.get(location.serviceStackId) ?? location.serviceStackId,
        port: location.port,
        path: location.path,
      }));
      const path = targets[0]?.path ?? "/";
      return value.domains.map((domain) => ({
        routingId: id,
        domainName: domain.domainName,
        routingDomains: value.domains.map(({ domainName }) => domainName),
        targets,
        sslEnabled: value.sslEnabled,
        face: domainFace(value, domain, ips),
        url: `${value.sslEnabled ? "https" : "http"}://${domain.domainName}${path === "/" ? "" : path}`,
        resolvedIps: domain.resolvedIps ?? [],
        nameServers: domain.nameServers ?? [],
        ...(domain.lastDnsCheckAt === undefined ? {} : { checkedAt: domain.lastDnsCheckAt }),
        ...(domain.sslError === undefined ? {} : { sslError: domain.sslError }),
      }));
    })
    .sort((left, right) => left.domainName.localeCompare(right.domainName, "en"));
}

const targetLabel = (target: AddressTarget | undefined) =>
  target === undefined ? "" : ` → ${target.serviceName} · port ${target.port}`;

function waitingDomainsOf(
  routings: ReadonlyArray<{ readonly id: string; readonly value: PublicRoutingValue }>,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<WaitingChange> {
  return routings
    .filter(({ value }) => value.isEditable === true && !value.isSynced)
    .map(({ id, value }) => {
      const domains = value.domains.map(({ domainName }) => domainName).join(", ");
      const first = value.locations[0];
      const target =
        first === undefined
          ? undefined
          : {
              serviceId: first.serviceStackId,
              serviceName: names.get(first.serviceStackId) ?? first.serviceStackId,
              port: first.port,
              path: first.path,
            };
      return {
        id,
        label:
          value.deleteOnSync === true ? `Removing ${domains}` : `${domains}${targetLabel(target)}`,
      };
    });
}

function portsOf(
  read: ProjectionReads,
  { orgId, projectId }: ProjectKey,
  names: ReadonlyMap<string, string>,
  ips: PlaceIps,
): Pick<PlaceAddresses, "portsState" | "ports" | "waitingPorts"> {
  const scope = portRoutingsScope(orgId);
  if (scopeFreshness(read, scope).unavailableReason !== undefined)
    return { portsState: "failed", ports: [], waitingPorts: [] };
  if (read.coverage(scope) === "unknown")
    return { portsState: "reading", ports: [], waitingPorts: [] };
  const rows: { id: string; value: PublicPortRoutingValue }[] = [];
  for (const id of read.index("portRoutingProject", projectId)) {
    const fact = read.fact("publicPortRouting", id);
    if (fact.kind === "known") rows.push({ id, value: fact.value });
  }
  rows.sort(
    (left, right) =>
      left.value.publicPort - right.value.publicPort || left.id.localeCompare(right.id, "en"),
  );
  const ports = rows.map(({ id, value }) => {
    const address = portAddress(value, ips);
    return {
      id,
      serviceId: value.serviceStackId,
      serviceName: names.get(value.serviceStackId) ?? value.serviceStackId,
      publicIpType: value.publicIpType,
      publicPort: value.publicPort,
      internalPort: value.internalPort,
      internalProtocol: value.internalProtocol,
      firewallPolicy: value.firewallPolicy,
      ranges: value.firewallIpRanges,
      face: portFace(value),
      ...(address === undefined ? {} : { address }),
    };
  });
  return {
    portsState: "ready",
    ports,
    waitingPorts: ports
      .filter((port) => port.face !== "live")
      .map((port) => ({
        id: port.id,
        label:
          port.face === "removing"
            ? `Closing port ${port.publicPort}`
            : `Port ${port.publicPort} → ${port.serviceName} · port ${port.internalPort}`,
      })),
  };
}

const NOTHING = {
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  nothingDeployed: false,
} satisfies Omit<PlaceAddresses, "state" | "readsProject">;

export const addresses: Projection<ProjectKey, PlaceAddresses> = {
  name: "addresses",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, key) => {
    const services = projectServices.derive(read, key);
    const routings = projectRoutings(read, key);
    const readsProject = routings.readsProject;
    const project = read.fact("project", key.projectId);
    // Deleted, taken from the viewer, or missing from the organization's whole roster: nothing
    // of it will be read here.
    const unseen =
      project.kind === "deleted" ||
      project.kind === "withheld" ||
      (project.kind === "unknown" && read.coverage(projectsScope(key.orgId)) === "complete");
    if (services.unavailableReason !== undefined || routings.kind === "failed" || unseen)
      return { state: "failed", ...NOTHING, readsProject };
    if (services.services === undefined || routings.kind !== "read" || project.kind !== "known")
      return { state: "reading", ...NOTHING, readsProject };
    const row = project.value as ZeropsProject;
    const ips = placeIps(row);
    const names = new Map(services.services.map((service) => [service.id, service.name]));
    const live = services.services.filter(reachable);
    const runtimes = live.filter(isRuntimeService);
    return {
      state: routings.complete ? "ready" : "reading",
      domains: domainsOf(routings.rows, names, ips),
      zerops: zeropsAddresses(row, services.services),
      ips,
      ...portsOf(read, key, names, ips),
      webTargets: live.flatMap((service) => webPorts(service).map((port) => choice(service, port))),
      portTargets: live.flatMap((service) =>
        (service.ports ?? [])
          .filter((port) => port.portRouting === true)
          .map((port) => choice(service, port)),
      ),
      waitingDomains: waitingDomainsOf(routings.rows, names),
      readsProject,
      nothingDeployed:
        runtimes.length > 0 && runtimes.every((service) => service.activeAppVersion === null),
    };
  },
  equals: sameValue,
};
