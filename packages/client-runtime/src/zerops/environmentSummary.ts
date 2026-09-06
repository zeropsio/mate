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

export interface ZeropsEnvironmentServices {
  /** The developer's services by hostname, in name order. Empty for a project holding only the platform's. */
  readonly hostnames: ReadonlyArray<string>;
  /** When code last landed in any of them; absent when nothing has been deployed. */
  readonly deployedAt: string | undefined;
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
  return {
    hostnames: own.map((service) => service.name).sort(byName),
    deployedAt,
  };
}
