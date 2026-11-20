/** The service stack's records as the Zerops REST API returns them:
 * one resource of `../api.ts`'s client. */

/**
 * `POST /project/{id}/service-stack/import` — the services it created, each
 * with the processes bringing it up. Shape measured against the live API
 * 2026-09-05.
 */
export interface ZeropsServiceImportResult {
  readonly projectId: string;
  readonly projectName: string;
  readonly serviceStacks: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly processes?: ReadonlyArray<{ readonly id: string }>;
  }>;
}

export interface ZeropsServicePort {
  readonly port: number;
  readonly protocol?: string;
  readonly scheme?: string;
  readonly httpSupport?: boolean;
  /** Whether a domain may point at it: the platform refuses one that is not (read 2026-10-14). */
  readonly httpRouting?: boolean;
  /**
   * Whether it may be opened straight to the internet: a PostgreSQL service's `6432`, never its
   * `5432` (read 2026-10-14).
   */
  readonly portRouting?: boolean;
}

/** One `used`/`limit` pair of a current-stats item, in the unit its field name says. */
export interface ZeropsStatPair {
  readonly used: number;
  readonly limit: number;
}

/**
 * One item of `POST /current-stats/group-by-search` — a container's live
 * allocation when grouped by `containerId`. `vCpu` is the shared-CPU pair
 * (`cpu` is the dedicated one and reads `0/0` on a shared service).
 */
export interface ZeropsCurrentStat {
  readonly clientId?: string;
  readonly projectId?: string;
  readonly serviceStackId: string;
  readonly serviceId?: string;
  readonly containerId?: string;
  readonly cpu?: ZeropsStatPair;
  readonly vCpu?: ZeropsStatPair;
  readonly ramGBytes?: ZeropsStatPair;
  readonly diskGBytes?: ZeropsStatPair;
}

/**
 * One bucket of `POST /stats-history/group-by-search` grouped by service
 * stack: the allocation and use over `[from, till]`, in the unit the field
 * says.
 */
export interface ZeropsStatHistoryItem {
  readonly from: string;
  readonly till: string;
  readonly projectId?: string;
  readonly serviceStackId: string;
  readonly containerCount?: number;
  readonly cpuLimit?: number;
  readonly cpuUsed?: number;
  readonly vCpuLimit?: number;
  readonly vCpuUsed?: number;
  readonly ramLimit?: number;
  readonly ramUsed?: number;
  readonly diskLimit?: number;
  readonly diskUsed?: number;
}

/**
 * A git integration as the Zerops GUI's own service-stack template reads it
 * (`service-stack-info-chips.component.html`); every captured fixture carries
 * `null` here, so the field names are the GUI's, not a measurement.
 */
export interface ZeropsGitIntegration {
  readonly isActive?: boolean;
  readonly eventType?: string;
  readonly branchName?: string | null;
  readonly tagName?: string | null;
  readonly commit?: string | null;
  readonly repositoryFullName?: string | null;
}

/**
 * The deploy a service is running (`activeAppVersion`), as the list read
 * embeds it. `source` is `CLI`, `GIT`, `GITHUB`, `GITLAB`, `GUI` or `NONE`
 * (a runtime that has never been deployed still carries an `ACTIVE`
 * `NONE` version — measured on `z3-eval`'s `s3git1`).
 */
export interface ZeropsAppVersion {
  readonly id?: string;
  readonly name?: string | null;
  readonly status?: string;
  readonly source?: string;
  readonly created?: string;
  readonly lastUpdate?: string;
  /** When it became the service's active version: its containers started then. */
  readonly activationDate?: string | null;
  readonly githubIntegration?: ZeropsGitIntegration | null;
  readonly gitlabIntegration?: ZeropsGitIntegration | null;
  readonly publicGitSource?: {
    readonly branchName?: string | null;
    readonly repositoryUrl?: string | null;
  } | null;
}

/** One corner of the vertical autoscaling envelope; `null` where the platform has no value. */
interface ZeropsAutoscalingResource {
  readonly cpuCoreCount?: number | null;
  readonly memoryGBytes?: number | null;
  readonly diskGBytes?: number | null;
}

/**
 * A service's autoscaling as `GET /project/{id}/service-stack` reports it.
 * `currentAutoscaling` is the effective configuration — the profile's
 * defaults with the service's own overrides applied — which is what the
 * dashboard's autoscaling panel shows; `customAutoscaling` holds only the
 * overrides, mostly `null`.
 */
export interface ZeropsAutoscaling {
  readonly verticalAutoscaling?: {
    readonly minResource?: ZeropsAutoscalingResource | null;
    readonly maxResource?: ZeropsAutoscalingResource | null;
    /** `SHARED` or `DEDICATED`. */
    readonly cpuMode?: string | null;
    readonly startCpuCoreCount?: number | null;
  } | null;
  readonly horizontalAutoscaling?: {
    readonly minContainerCount?: number | null;
    readonly maxContainerCount?: number | null;
  } | null;
}

export interface ZeropsService {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly isSystem?: boolean;
  readonly subdomainAccess?: boolean;
  readonly ports?: ReadonlyArray<ZeropsServicePort>;
  readonly serviceStackTypeInfo?: {
    readonly serviceStackTypeName?: string;
    readonly serviceStackTypeVersionName?: string;
    readonly serviceStackTypeCategory?: string;
  };
  /** The exact runtime version, `v22.22.3` for a `nodejs@22`; empty on the core service. */
  readonly versionNumber?: string;
  /** `HA` or `NON_HA` on a managed service; `null` on a runtime. */
  readonly mode?: string | null;
  readonly created?: string;
  readonly lastUpdate?: string;
  readonly activeAppVersion?: ZeropsAppVersion | null;
  readonly githubIntegration?: ZeropsGitIntegration | null;
  readonly gitlabIntegration?: ZeropsGitIntegration | null;
  /** The effective autoscaling envelope; `null` on the core service. */
  readonly currentAutoscaling?: ZeropsAutoscaling | null;
}
