/**
 * The client-side service map projection: correlates a project's service list
 * (`GET /project/{id}/service-stack`) with its live process list
 * (`GET /project/{id}/process`, `./activity/dto.ts`) into the presentation
 * model the service map, quick actions and chat chrome render from.
 *
 * Pure — no network, no timers. `useProjectTopology.ts` is the shell that
 * calls this on every project read; the websocket protocol that triggers
 * those reads lives in `platformWatch.ts` and never reaches this file (a push
 * is a signal, decoded no further than `type`/`subscriptionName`, and this
 * function never sees one).
 */
import type { ActivityProcess } from "./activity/dto.ts";
import {
  servicePortOrigin,
  type ZeropsProject,
  type ZeropsService,
  type ZeropsServicePort,
} from "./api.ts";

export type ZeropsTopologyGroup = "runtimes" | "data" | "infrastructure";

export interface ZeropsTopologyProject {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
}

export interface ZeropsTopologyService {
  readonly hostname: string;
  readonly serviceId: string;
  /** Type-version as the platform reports it, e.g. `nodejs@22`, `postgresql:single@18`. */
  readonly type: string;
  readonly status: string;
  readonly group: ZeropsTopologyGroup;
  /** True while `status` is unsettled, or an in-flight process names this service. */
  readonly transient: boolean;
  readonly subdomainUrl?: string;
  readonly ports: ReadonlyArray<ZeropsServicePort>;
}

export interface ZeropsTopologyView {
  readonly project: ZeropsTopologyProject;
  readonly services: ReadonlyArray<ZeropsTopologyService>;
  /** Advisory notes for the map. The client projection has none of its own yet. */
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Grouping — this is now the map's only source. The server's own copy
// (`apps/server/src/zerops/zeropsServiceTaxonomy.ts`, which grouped `zcp
// studio topology`'s `adoptionState`/`isInfrastructure` fields) is deleted;
// those fields do not exist on this REST read, so the same three groups are
// rebuilt here from `serviceStackTypeInfo` instead.
// ---------------------------------------------------------------------------

const ZCP_TYPE_PREFIX = "zcp";

/**
 * A type-version can carry an OS prefix — the platform reports runtimes as
 * `ubuntu/nodejs@22`, not `nodejs@22`. Managed types use a different
 * separator (`valkey:single@7.2`), so only a leading `<os>/` segment is
 * stripped.
 */
const withoutOsPrefix = (type: string): string => {
  const separator = type.indexOf("/");
  return separator < 0 ? type : type.slice(separator + 1);
};

/** Categories the Zerops API reports for a managed data service (POC finding). */
const MANAGED_DATA_CATEGORIES: ReadonlySet<string> = new Set(["STANDARD", "OBJECT_STORAGE"]);

/**
 * Which panel of the service map a service belongs in.
 *
 * Order matters: the zcp container's own type is user-category, so it has to
 * be claimed as infrastructure before the runtime branch sees it.
 */
function zeropsTopologyServiceGroup(service: ZeropsService): ZeropsTopologyGroup {
  const typeVersion = service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? "";
  if (withoutOsPrefix(typeVersion.toLowerCase()).startsWith(ZCP_TYPE_PREFIX)) {
    return "infrastructure";
  }
  const category = service.serviceStackTypeInfo?.serviceStackTypeCategory;
  if (category !== undefined && MANAGED_DATA_CATEGORIES.has(category)) {
    return "data";
  }
  return category === "USER" ? "runtimes" : "infrastructure";
}

/**
 * Platform service statuses that are settled. Everything else is treated as
 * transient — a status the platform adds later costs one extra poll, whereas
 * the inverse default would leave a service frozen mid-transition with
 * nothing to un-freeze it.
 */
const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "RUNNING",
  "STOPPED",
  "READY_TO_DEPLOY",
  "FAILED",
  "DELETED",
  "ACTION_FAILED",
  "CONTAINER_FAILED",
  "REPAIR_FAILED",
]);

const SERVICE_STATUS_PREFIX = "SERVICE_";

function isSettledZeropsStatus(status: string): boolean {
  const normalized = status.startsWith(SERVICE_STATUS_PREFIX)
    ? status.slice(SERVICE_STATUS_PREFIX.length)
    : status;
  return SETTLED_STATUSES.has(normalized);
}

/** `ProcessStatusEnum` values that mean the process is no longer moving. */
const TERMINAL_PROCESS_STATUSES: ReadonlySet<string> = new Set(["FINISHED", "FAILED", "CANCELED"]);

function inFlightServiceIds(processes: ReadonlyArray<ActivityProcess>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const process of processes) {
    if (TERMINAL_PROCESS_STATUSES.has(process.status)) continue;
    for (const id of process.serviceStackIds) ids.add(id);
  }
  return ids;
}

/** The first subdomain-enabled port's origin, or undefined when the service has none. */
function firstSubdomainUrl(project: ZeropsProject, service: ZeropsService): string | undefined {
  for (const port of service.ports ?? []) {
    const origin = servicePortOrigin(project, service, port);
    if (origin !== undefined) return origin;
  }
  return undefined;
}

/**
 * Correlates a project's service list and process list into the map's
 * presentation model. `apps/server`'s core/system service (isSystem) is
 * dropped: it is the project's own control-plane row, never something a user
 * manages.
 */
export function projectTopology(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService>,
  processes: ReadonlyArray<ActivityProcess>,
): ZeropsTopologyView {
  const inFlight = inFlightServiceIds(processes);

  const rows = services
    .filter((service) => !service.isSystem)
    .map((service): ZeropsTopologyService => {
      const subdomainUrl = firstSubdomainUrl(project, service);
      return {
        hostname: service.name,
        serviceId: service.id,
        type: service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? "",
        status: service.status,
        group: zeropsTopologyServiceGroup(service),
        transient: !isSettledZeropsStatus(service.status) || inFlight.has(service.id),
        ...(subdomainUrl === undefined ? {} : { subdomainUrl }),
        ports: service.ports ?? [],
      };
    });

  return {
    project: {
      id: project.id,
      name: project.name,
      ...(project.status ? { status: project.status } : {}),
    },
    services: rows,
    warnings: [],
  };
}
