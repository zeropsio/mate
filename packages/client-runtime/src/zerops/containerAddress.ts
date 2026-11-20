/**
 * Which service is a zcp container, and where a service port answers publicly.
 *
 * Pure: no network, no clock, no platform globals, so a projection can derive a
 * container's presence without reaching the API client.
 */
import type { ZeropsProject } from "./api/project.ts";
import type { ZeropsService, ZeropsServicePort } from "./api/service.ts";

/**
 * The zcp container's service type. A control plane is identified by its
 * **type**, never by its hostname: the hostname is editable, and a Mate whose
 * container was renamed must still be recognised as one.
 */
const ZCP_SERVICE_TYPE_PREFIX = "zcp@";

export function isZcpService(service: ZeropsService): boolean {
  return (service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? "").startsWith(
    ZCP_SERVICE_TYPE_PREFIX,
  );
}

/**
 * A project's Mate container, one Mate per project (audit D2): its one zcp service, none, or the
 * names of the several a project holds — never one of them picked as its Mate.
 */
type MateContainer =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly service: ZeropsService }
  | { readonly kind: "several"; readonly names: ReadonlyArray<string> };

export function mateContainerOf(services: ReadonlyArray<ZeropsService>): MateContainer {
  const containers = services.filter(isZcpService);
  if (containers.length === 0) return { kind: "none" };
  if (containers.length === 1) return { kind: "one", service: containers[0]! };
  return { kind: "several", names: containers.map((service) => service.name) };
}

/** What a project holding several zcp services is told where it would become a Mate. */
export function severalMatesLine(names: ReadonlyArray<string>): string {
  return `This project has more than one Zerops Control Plane (${names.join(", ")}). A project holds one Mate: delete the others in Zerops, then try again.`;
}

/**
 * The domain a project's Zerops subdomains answer under, from its `publicZone`: a region's
 * `"fte23….prg1-zerops.zone"` gives `prg1.zerops.app`; a dev platform's
 * `"….<name>.dev-zerops.cloud"` gives that platform's app domain (its zcp service's
 * `zeropsSubdomain`, read 2026-11-02). The container origin must never hard-code a region:
 * `publicZone` already rides in the project detail both clients fetch. Returns null when the zone
 * has neither shape.
 */
export function zeropsSubdomainDomainFromPublicZone(publicZone: string): string | null {
  const region = /\.([a-z0-9-]+)-zerops\.zone$/i.exec(publicZone)?.[1];
  if (region !== undefined) return `${region}.zerops.app`;
  const development = /\.([a-z0-9-]+)\.dev-zerops\.cloud$/i.exec(publicZone)?.[1];
  return development === undefined ? null : `app-${development}.zerops.dev`;
}

/** The public origin of one service port: `https://<service>-<subdomain>-<port>.<domain>`. */
export function buildZeropsContainerUrl(
  serviceName: string,
  subdomainHost: string,
  port: number,
  domain: string,
): string {
  return `https://${serviceName}-${subdomainHost}-${port}.${domain}`;
}

/**
 * The public subdomain origin of one of a service's ports, or `undefined`
 * when this port has none — the service itself has subdomain access turned
 * off, the port carries no HTTP scheme, or the project has no public
 * subdomain at all (a project's `publicZone`/`zeropsSubdomainHost` come from
 * `fetchProject`, never from the lighter project embedded in a service-stack
 * list read).
 *
 * Port 80 measured (z3-eval, 2026-09-04) with NO port segment in the origin
 * — `https://weatherdash-26a7.prg1.zerops.app/` is 200,
 * `https://weatherdash-26a7-80.prg1.zerops.app/` is 502. Any other port
 * keeps its segment, matching `buildZeropsContainerUrl` (and
 * `candidates.ts`'s `containerOrigin`, which only ever asks for the zcp
 * container's 8080 and must keep working unchanged) — measured the same day:
 * `https://zcp-26a7-8080.prg1.zerops.app/` is 200,
 * `https://zcp-26a7.prg1.zerops.app/` is 502.
 */
export function servicePortOrigin(
  project: ZeropsProject,
  service: ZeropsService,
  port: ZeropsServicePort,
): string | undefined {
  if (service.subdomainAccess !== true) return undefined;
  if (port.scheme !== "http" && port.scheme !== "https") return undefined;
  if (!project.publicZone || !project.zeropsSubdomainHost) return undefined;
  const domain = zeropsSubdomainDomainFromPublicZone(project.publicZone);
  if (!domain) return undefined;
  return port.port === 80
    ? `https://${service.name}-${project.zeropsSubdomainHost}.${domain}`
    : buildZeropsContainerUrl(service.name, project.zeropsSubdomainHost, port.port, domain);
}
