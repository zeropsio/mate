/**
 * What an environment holds, in one line: the services a person put there and
 * when its code last landed.
 *
 * The platform's own services — the core, the build runtimes it spins up and
 * stops, the Mate's container — are not what somebody means by "what is in
 * stage", so they are left out; what remains is named by hostname, which is
 * the name the developer chose and the name every route and env var uses.
 * The deploy age is the newest active app version across those services: an
 * environment "was deployed" when any of its services last was.
 */
import type { ZeropsService } from "./api.ts";
import { isZcpService } from "./candidates.ts";
import { isPoolServiceType } from "./infrastructureType.ts";
import { isRuntimeService } from "./topology.ts";

export interface ZeropsEnvironmentServices {
  /** The developer's services by hostname, in name order. Empty for a project holding only the platform's. */
  readonly hostnames: ReadonlyArray<string>;
  /** When code last landed in any of them; absent when nothing has been deployed. */
  readonly deployedAt: string | undefined;
  /**
   * The same services with their ids, which a version read needs — the name
   * a version was deployed under lives on the service and is read per id
   * (`groupDeploys.ts`). Same order as {@link ZeropsEnvironmentServices.hostnames}.
   */
  readonly deployable: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
  /**
   * How each stands, as the platform says it (`ACTIVE`, `STOPPED`,
   * `CONTAINER_FAILED`…), and whether it runs the developer's code
   * (`isRuntimeService`): a runtime that failed takes a page down, a database
   * whose upgrade failed does not. Same order as
   * {@link ZeropsEnvironmentServices.hostnames}.
   */
  readonly statuses: ReadonlyArray<{
    readonly hostname: string;
    readonly status: string;
    readonly runtime: boolean;
    /**
     * A runtime the platform says holds no deploy (`activeAppVersion: null`): its container may
     * run, and nothing deployed runs in it. Absent where it holds one or that is not read.
     */
    readonly nothingDeployed?: true;
  }>;
  /**
   * The dev pools among them by hostname (`isPoolServiceType`), in name order. A pool declares a
   * port per container slot, each with its own subdomain whether or not a container holds it: its
   * routes are its leases' previews or nobody's, never addresses of the pool's own.
   */
  readonly pools: ReadonlyArray<string>;
}

function byName(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function newer(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

export function summarizeEnvironmentServices(
  services: ReadonlyArray<ZeropsService>,
): ZeropsEnvironmentServices {
  const own = services.filter((service) => service.isSystem !== true && !isZcpService(service));
  let deployedAt: string | undefined;
  for (const service of own) {
    const version = service.activeAppVersion;
    if (version === null || version === undefined) continue;
    deployedAt = newer(deployedAt, version.lastUpdate ?? version.created);
  }
  const ordered = [...own].sort((left, right) => byName(left.name, right.name));
  return {
    hostnames: ordered.map((service) => service.name),
    deployedAt,
    deployable: ordered.map((service) => ({ serviceId: service.id, hostname: service.name })),
    statuses: ordered.map((service) => {
      const runtime = isRuntimeService(service);
      return {
        hostname: service.name,
        status: service.status,
        runtime,
        ...(runtime && service.activeAppVersion === null ? { nothingDeployed: true as const } : {}),
      };
    }),
    pools: ordered
      .filter((service) =>
        isPoolServiceType(service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? ""),
      )
      .map((service) => service.name),
  };
}
