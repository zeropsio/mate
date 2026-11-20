import type { ZeropsDoor } from "../api.ts";

/** The Zerops REST API's address resource, one of `../api.ts`'s client: a public port routing
 * as a write sends it, and the calls that add, change and remove domains, public ports, the
 * project's IPv4 and a service's zerops.app address. */

/**
 * A port opened straight to the internet, as a write sends it: on the project's own IPv6 (free)
 * or IPv4 (the paid add-on; refused as `publicIpTypeNotSupported` without one), to a port the
 * service may open (`portRouting`; else `portNotSupported`), never 80 or 443
 * (`publicPortRoutingReservedPort`) and only in 10–65435 (`portOutOfRange`). The firewall's ranges
 * are CIDRs of the port's own IP version, each with its mask: an IPv6 port refuses an IPv4 range
 * or a bare address as `publicPortRoutingInvalidIpFormat` (all read 2026-10-14).
 */
export interface ZeropsPortRoutingWrite {
  readonly publicIpType: "IP_V6" | "IP_V4";
  readonly publicPort: number;
  readonly internalPort: number;
  /** Lowercase: `TCP` is refused. */
  readonly internalProtocol: "tcp" | "udp";
  /** `WHITELIST`: only the ranges may connect; `BLACKLIST` with none: everyone may. */
  readonly firewallPolicy: "WHITELIST" | "BLACKLIST";
  readonly firewallIpRanges: ReadonlyArray<string>;
}

/** `POST /project/{id}/public-http-routing` — routes the domains to the locations, with SSL. */
export async function createPublicHttpRouting(
  door: ZeropsDoor,
  projectId: string,
  routing: {
    readonly domains: ReadonlyArray<string>;
    readonly locations: ReadonlyArray<{
      readonly path: string;
      readonly port: number;
      readonly serviceStackId: string;
    }>;
  },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/project/${projectId}/public-http-routing`,
    {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({ sslEnabled: true, ...routing }),
    },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/** `PUT /public-http-routing/{id}` — the routing's domains and locations, replaced whole. */
export async function updatePublicHttpRouting(
  door: ZeropsDoor,
  routingId: string,
  routing: {
    readonly domains: ReadonlyArray<string>;
    readonly locations: ReadonlyArray<{
      readonly path: string;
      readonly port: number;
      readonly serviceStackId: string;
    }>;
    readonly sslEnabled: boolean;
  },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/public-http-routing/${routingId}`,
    { method: "PUT", signal: signal ?? null, body: JSON.stringify(routing) },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/** `DELETE /public-http-routing/{id}` — removes the routing. */
export async function deletePublicHttpRouting(
  door: ZeropsDoor,
  routingId: string,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/public-http-routing/${routingId}`,
    { method: "DELETE", signal: signal ?? null },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/** `PUT /public-http-routing/{id}/trigger-domains-dns-check` — looks its domains up again. */
export async function checkPublicHttpRoutingDns(
  door: ZeropsDoor,
  routingId: string,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/public-http-routing/${routingId}/trigger-domains-dns-check`,
    { method: "PUT", signal: signal ?? null, body: JSON.stringify({ domains: null }) },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/** `POST /service-stack/{id}/public-port-routing` — opens a port of the service on the project's IP. */
export async function createPublicPortRouting(
  door: ZeropsDoor,
  serviceId: string,
  port: ZeropsPortRoutingWrite,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/service-stack/${serviceId}/public-port-routing`,
    {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({ ...port, firewallAllowMyIp: false }),
    },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/** `PUT /public-port-routing/{id}` — the port's routing replaced whole. */
export async function updatePublicPortRouting(
  door: ZeropsDoor,
  portRoutingId: string,
  port: ZeropsPortRoutingWrite,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/public-port-routing/${portRoutingId}`,
    {
      method: "PUT",
      signal: signal ?? null,
      body: JSON.stringify({ ...port, firewallAllowMyIp: false }),
    },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/** `DELETE /public-port-routing/{id}` — closes the port. */
export async function deletePublicPortRouting(
  door: ZeropsDoor,
  portRoutingId: string,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/public-port-routing/${portRoutingId}`,
    { method: "DELETE", signal: signal ?? null },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/**
 * `PUT /project/{id}/request-ipv4` — buys the project its own IPv4, the add-on billed every 30
 * days from purchased credit: a process (`instance.publicIpV4.request`).
 */
export async function requestProjectPublicIp(
  door: ZeropsDoor,
  projectId: string,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  const process = await door<{ readonly id?: unknown }>(
    `/project/${projectId}/request-ipv4`,
    { method: "PUT", signal: signal ?? null, body: "{}" },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
  return { processId: typeof process?.id === "string" ? process.id : undefined };
}

/**
 * `PUT /service-stack/{id}/disable-subdomain-access` — closes the service's zerops.app address:
 * a process, and its routing leaves the organization's listing.
 */
export async function disableSubdomainAccess(
  door: ZeropsDoor,
  serviceId: string,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  const process = await door<{ readonly id?: unknown }>(
    `/service-stack/${serviceId}/disable-subdomain-access`,
    { method: "PUT" },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
  return { processId: typeof process?.id === "string" ? process.id : undefined };
}

/**
 * `PUT /service-stack/{id}/enable-subdomain-access` — publish a service on
 * its `*.zerops.app` subdomain.
 *
 * A separate call rather than an import field because the import field does
 * not apply to a service created without code: a production environment
 * cloned from dev comes up unpublished whatever its recipe said, and answers
 * 502 after its first deploy until this runs.
 */
export async function enableSubdomainAccess(
  door: ZeropsDoor,
  serviceId: string,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/service-stack/${serviceId}/enable-subdomain-access`,
    { method: "PUT" },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}
