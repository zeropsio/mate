/**
 * Which service is a zcp container, and where a service port answers publicly.
 *
 * Pure: no network, no clock, no platform globals, so a projection can derive a
 * container's presence without reaching the API client.
 */
import type { ZeropsService } from "./api.ts";

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
 * Recovers the region (`"prg1"`, …) from a project's `publicZone`
 * (`"fte23….prg1-zerops.zone"`). The container origin must never hard-code a
 * region: `publicZone` already rides in the project detail both clients fetch.
 * Returns null when the zone does not match the shape.
 */
export function zeropsRegionFromPublicZone(publicZone: string): string | null {
  const match = /\.([a-z0-9-]+)-zerops\.zone$/i.exec(publicZone);
  return match?.[1] ?? null;
}

/** The public origin of one service port: `https://<service>-<subdomain>-<port>.<region>.zerops.app`. */
export function buildZeropsContainerUrl(
  serviceName: string,
  subdomainHost: string,
  port: number,
  region: string,
): string {
  return `https://${serviceName}-${subdomainHost}-${port}.${region}.zerops.app`;
}
