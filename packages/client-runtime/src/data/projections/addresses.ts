/**
 * One place's addresses, as the addresses sheet shows them: every way the internet reaches one
 * project. Its own domains and how far each is from answering, each service's zerops.app address
 * and its switch, the project's IP addresses, and the ports it opens straight to the internet with
 * who may connect. Joined from the organization's routings, port routings and services and the
 * project's row; never a read of its own. A routing is in place once Zerops answers its write:
 * nothing publishes it after.
 *
 * @module data/projections/addresses
 */
import type { ZeropsProject } from "../../zerops/api/project.ts";
import { isZcpService } from "../../zerops/candidates.ts";
import { isRuntimeService } from "../../zerops/topology.ts";
import { derivePublicRoutes } from "../../zerops/publicRoutes.ts";
import { projectsScope } from "../families/project.ts";
import { portRoutingsScope, type PublicPortRoutingValue } from "../families/publicPortRouting.ts";
import type { PublicRoutingDomain, PublicRoutingValue } from "../families/publicRouting.ts";
import type { ServiceValue } from "../../zerops/projectServices.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness } from "./freshness.ts";
import type { ProjectKey } from "./processes.ts";
import { projectRoutings } from "./publicAccess.ts";
import { projectServices } from "./services.ts";
import type {
  AddressDomain,
  DomainFace,
  PlaceAddresses,
  PlaceIps,
  ZeropsAddress,
} from "../../zerops/placeAddresses.ts";

/** A place read in full that holds no domain of its own: a domain is worth offering. */
export function lacksOwnDomain(place: PlaceAddresses): boolean {
  return place.state === "ready" && place.domains.length === 0;
}

/**
 * The shared IPv4 of each region, by the name its project zones carry: a project's zone answers on
 * it while `publicIpV4Shared` is on (`dig +short A <zone>`, read 2026-10-14). The platform's rows
 * name it nowhere.
 */
const SHARED_IPV4: Readonly<Record<string, string>> = { prg1: "93.185.106.128" };

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

/** A routed domain's face, from its DNS check and certificate alone. */
export function domainFace(
  routing: PublicRoutingValue,
  domain: PublicRoutingDomain,
  ips: PlaceIps,
): DomainFace {
  if (domain.sslError !== undefined) return "certificate-failed";
  if (domain.dnsCheckStatus !== "OK")
    return domain.dnsCheckStatus === "FAILED" && foundElsewhere(domain, ips) ? "elsewhere" : "dns";
  if (!routing.sslEnabled) return "live";
  // A certificate being renewed is the one in place still serving.
  return domain.sslStatus === "ACTIVE" || domain.sslStatus === "BEING_RENEWED"
    ? "live"
    : "certificate";
}

/** Where a client connects to an open port. */
function portAddress(port: PublicPortRoutingValue, ips: PlaceIps): string | undefined {
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

function portsOf(
  read: ProjectionReads,
  { orgId, projectId }: ProjectKey,
  names: ReadonlyMap<string, string>,
  ips: PlaceIps,
): Pick<PlaceAddresses, "portsState" | "ports"> {
  const scope = portRoutingsScope(orgId);
  if (scopeFreshness(read, scope).unavailableReason !== undefined)
    return { portsState: "failed", ports: [] };
  if (read.coverage(scope) === "unknown") return { portsState: "reading", ports: [] };
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
      face: "live" as const,
      ...(address === undefined ? {} : { address }),
    };
  });
  return { portsState: "ready", ports };
}

const NOTHING = {
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
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
      readsProject,
      nothingDeployed:
        runtimes.length > 0 && runtimes.every((service) => service.activeAppVersion === null),
    };
  },
  equals: sameValue,
};
