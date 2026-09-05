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
  type ZeropsCurrentStat,
  type ZeropsProject,
  type ZeropsService,
  type ZeropsServicePort,
  type ZeropsStatPair,
} from "./api.ts";

export type ZeropsTopologyGroup = "runtimes" | "data" | "infrastructure";

export interface ZeropsTopologyProject {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
}

/**
 * What a service holds right now, summed over its containers — the platform's
 * current-stats read (`searchCurrentStats`). `limit` is the allocation the
 * autoscaler has granted, `used` what the containers are actually consuming;
 * both in the unit the field says.
 */
export interface ZeropsServiceUsage {
  readonly containers: number;
  readonly cores: ZeropsStatPair;
  readonly memoryGb: ZeropsStatPair;
  readonly diskGb: ZeropsStatPair;
}

/** One public URL of a service: a subdomain-enabled HTTP(S) port. */
export interface ZeropsServiceRoute {
  readonly port: number;
  readonly url: string;
  /** The URL without its scheme — what a row shows and what a person copies. */
  readonly host: string;
}

/** The deploy a runtime is running; absent when it has never been deployed (`source: NONE`). */
export interface ZeropsServiceDeploy {
  /** `CLI`, `GIT`, `GITHUB`, `GITLAB` or `GUI`. */
  readonly source: string;
  /** When this version went live — the platform's `lastUpdate` on the active version. */
  readonly activatedAt?: string;
  readonly name?: string;
  readonly branch?: string;
  readonly commit?: string;
  readonly tag?: string;
  readonly repository?: string;
}

export interface ZeropsTopologyService {
  readonly hostname: string;
  readonly serviceId: string;
  /** Type-version as the platform reports it, e.g. `nodejs@22`, `postgresql:single@18`. */
  readonly type: string;
  /** The platform's display name for the type, e.g. `Node.js`, `MariaDB`. */
  readonly typeName?: string;
  /** The exact version running, e.g. `v22.22.3`. */
  readonly version?: string;
  /** `HA` or `NON_HA`; managed services only. */
  readonly mode?: string;
  readonly status: string;
  readonly group: ZeropsTopologyGroup;
  /** True while `status` is unsettled, or an in-flight process names this service. */
  readonly transient: boolean;
  /** The first public route's URL — kept for the callers that want one door. */
  readonly subdomainUrl?: string;
  /** Every public route, in port order. */
  readonly routes: ReadonlyArray<ZeropsServiceRoute>;
  readonly ports: ReadonlyArray<ZeropsServicePort>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly deploy?: ZeropsServiceDeploy;
  /** Absent until the first current-stats read answers, or when the service has no container. */
  readonly usage?: ZeropsServiceUsage;
}

export interface ZeropsTopologyView {
  readonly project: ZeropsTopologyProject;
  readonly services: ReadonlyArray<ZeropsTopologyService>;
  /** Advisory notes for the map. The client projection has none of its own yet. */
  readonly warnings: ReadonlyArray<string>;
  /**
   * Whether a current-stats read has answered at all. Until it has, a row's
   * missing `usage` means "not read yet" and a client reserves the space;
   * after it, a missing `usage` means the service holds no container.
   */
  readonly usageRead: boolean;
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

/** Every subdomain-enabled HTTP(S) port's origin, in declaration order. */
function serviceRoutes(
  project: ZeropsProject,
  service: ZeropsService,
): ReadonlyArray<ZeropsServiceRoute> {
  const routes: Array<ZeropsServiceRoute> = [];
  for (const port of service.ports ?? []) {
    const url = servicePortOrigin(project, service, port);
    if (url === undefined) continue;
    routes.push({ port: port.port, url, host: url.replace(/^https?:\/\//u, "") });
  }
  return routes;
}

const EMPTY_PAIR: ZeropsStatPair = { used: 0, limit: 0 };

const addPair = (left: ZeropsStatPair, right: ZeropsStatPair | undefined): ZeropsStatPair =>
  right === undefined ? left : { used: left.used + right.used, limit: left.limit + right.limit };

/**
 * Per-stack usage summed over the stack's containers. A container with a
 * dedicated core allocation reports it as `cpu`; a shared one as `vCpu` with
 * `cpu` at `0/0` — either way the cores it holds are the sum of both.
 */
function usageByStack(
  stats: ReadonlyArray<ZeropsCurrentStat>,
): ReadonlyMap<string, ZeropsServiceUsage> {
  const byStack = new Map<string, ZeropsServiceUsage>();
  for (const stat of stats) {
    const current = byStack.get(stat.serviceStackId) ?? {
      containers: 0,
      cores: EMPTY_PAIR,
      memoryGb: EMPTY_PAIR,
      diskGb: EMPTY_PAIR,
    };
    byStack.set(stat.serviceStackId, {
      containers: current.containers + 1,
      cores: addPair(addPair(current.cores, stat.cpu), stat.vCpu),
      memoryGb: addPair(current.memoryGb, stat.ramGBytes),
      diskGb: addPair(current.diskGb, stat.diskGBytes),
    });
  }
  return byStack;
}

const present = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value.length === 0 ? undefined : value;

const withKey = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

const NEVER_DEPLOYED_SOURCE = "NONE";

/** The running deploy, or undefined for a service that has none (managed, or a runtime never deployed). */
function serviceDeploy(service: ZeropsService): ZeropsServiceDeploy | undefined {
  const version = service.activeAppVersion;
  const source = present(version?.source);
  if (version === null || version === undefined || source === undefined) return undefined;
  if (source === NEVER_DEPLOYED_SOURCE) return undefined;
  const git = version.githubIntegration ?? version.gitlabIntegration;
  return {
    source,
    ...withKey("activatedAt", present(version.lastUpdate) ?? present(version.created)),
    ...withKey("name", present(version.name)),
    ...withKey("branch", present(git?.branchName) ?? present(version.publicGitSource?.branchName)),
    ...withKey("commit", present(git?.commit)),
    ...withKey("tag", present(git?.tagName)),
    ...withKey(
      "repository",
      present(git?.repositoryFullName) ?? present(version.publicGitSource?.repositoryUrl),
    ),
  };
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
  stats?: ReadonlyArray<ZeropsCurrentStat>,
): ZeropsTopologyView {
  const inFlight = inFlightServiceIds(processes);
  const usage = usageByStack(stats ?? []);

  const rows = services
    .filter((service) => !service.isSystem)
    .map((service): ZeropsTopologyService => {
      const routes = serviceRoutes(project, service);
      const subdomainUrl = routes[0]?.url;
      return {
        hostname: service.name,
        serviceId: service.id,
        type: service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? "",
        ...withKey("typeName", present(service.serviceStackTypeInfo?.serviceStackTypeName)),
        ...withKey("version", present(service.versionNumber)),
        ...withKey("mode", present(service.mode)),
        status: service.status,
        group: zeropsTopologyServiceGroup(service),
        transient: !isSettledZeropsStatus(service.status) || inFlight.has(service.id),
        ...(subdomainUrl === undefined ? {} : { subdomainUrl }),
        routes,
        ports: service.ports ?? [],
        ...withKey("createdAt", present(service.created)),
        ...withKey("updatedAt", present(service.lastUpdate)),
        ...withKey("deploy", serviceDeploy(service)),
        ...withKey("usage", usage.get(service.id)),
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
    usageRead: stats !== undefined,
  };
}

/**
 * The infrastructure `zcp` service's platform id, or undefined when the view
 * has none. Reads the same type-prefix test `zeropsTopologyServiceGroup`
 * classified it with — never the hostname, which a user is free to rename.
 */
export function zcpServiceIdFor(view: ZeropsTopologyView): string | undefined {
  return view.services.find(
    (service) =>
      service.group === "infrastructure" &&
      withoutOsPrefix(service.type.toLowerCase()).startsWith(ZCP_TYPE_PREFIX),
  )?.serviceId;
}
