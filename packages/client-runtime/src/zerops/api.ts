/**
 * Zerops account client — sign-in, TOTP, refresh, and the read-only project
 * calls the Zerops Mate entry flow needs.
 *
 * Deliberately plain async/await (no Effect runtime): this talks to the Zerops
 * REST API, not to a mate server, so it needs neither the contracts package nor
 * the orchestration machinery. It is shared by web and mobile so both clients
 * hold **one** Zerops auth model.
 *
 * The access token stays on the client. It is presented to the Zerops API and,
 * once per identity bootstrap, to the mate server — nowhere else, and never
 * persisted server-side.
 */

import { isThrowawayName } from "../authorization/zeropsThrowaway.ts";
import { readProjectProcesses, type ActivityProcess } from "./activity/dto.ts";
import {
  buildZeropsContainerUrl,
  isZcpService,
  mateContainerOf,
  severalMatesLine,
  zeropsRegionFromPublicZone,
} from "./containerAddress.ts";
import { withMateProjectRole } from "./mateAccess.ts";
import { planProjectIsolation, type ProjectEnvEntry } from "./projectIsolation.ts";
import { projectProcessSearchBody, zcpCreationUnderWay } from "./projectCreation.ts";
import {
  findHeldMateKey,
  makeTokenWriteLock,
  mateAdminKeys,
  MATE_SELF_PROJECT_ROLE,
  newestMateKey,
  planMateKey,
  type TokenWriteHold,
} from "./groupReach.ts";
import type {
  ZeropsIntegrationToken,
  ZeropsProjectGrant,
  ZeropsProjectRole,
  ZeropsTokenDelegation,
} from "./groupReach.ts";
import type { HqPlacement } from "./hq/placement.ts";
import {
  buildCreateProjectBody,
  buildDevelopmentContainerImportBody,
  buildZcpServiceImportYaml,
  generateVscodePassword,
  nextZcpServiceName,
  type ZeropsAgentType,
} from "./newProject.ts";
import {
  ZEROPS_CAPTCHA_ERROR_CODE,
  buildZeropsRegistrationBody,
  type ZeropsRegistrationInput,
} from "./registration.ts";
import {
  isUsableZeropsSession,
  isZeropsSession,
  requiresZeropsTwoFactor,
  type ZeropsSession,
} from "./session.ts";

export const DEFAULT_ZEROPS_API_BASE = "https://api.app-prg1.zerops.io";

const PUBLIC_API_PREFIX = "/api/rest/public";

/** A throwaway delete's own deadline; it never runs on a caller's signal. */
export const THROWAWAY_DELETE_TIMEOUT_MS = 15_000;
/** How long an app version's archive may take to upload. */
const APP_VERSION_UPLOAD_TIMEOUT_MS = 120_000;

export interface ZeropsClientMembership {
  readonly id: string;
  readonly clientId?: string;
  readonly userId?: string;
  readonly status?: string;
  readonly roleCode?: string;
  /** Independent capability flags; never infer these from NO_ACCESS. */
  readonly canCreateProjects?: boolean;
  readonly canViewFinances?: boolean;
  readonly canEditFinances?: boolean;
  readonly client?: {
    readonly id?: string;
    readonly accountName?: string;
    readonly companyName?: string;
  };
}

/** The account's picture, as `GET /user/info` returns it; every URL may be null. */
export interface ZeropsUserAvatar {
  readonly smallAvatarUrl?: string | null;
  readonly largeAvatarUrl?: string | null;
  readonly externalAvatarUrl?: string | null;
}

export interface ZeropsUser {
  readonly id: string;
  readonly email: string;
  readonly fullName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly avatar?: ZeropsUserAvatar | null;
  readonly clientUserList?: ReadonlyArray<ZeropsClientMembership>;
}

/** One organization the signed-in account belongs to. */
export interface ZeropsOrganization {
  readonly id: string;
  readonly name: string;
  readonly membershipId: string;
  readonly roleCode?: string;
  readonly canCreateProjects?: boolean;
  readonly canViewFinances?: boolean;
  readonly canEditFinances?: boolean;
}

export interface ZeropsLocation {
  readonly id: string;
  readonly name: string;
  readonly pingUrl: string;
}

/**
 * One row of `GET /client/{org}/user/list`. Open about what it does not
 * promise: the platform names a person in more than one place, and a member
 * with none of them is shown by their e-mail rather than by a blank.
 */
export interface ZeropsOrganizationMember {
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly id: string;
  readonly userId?: string;
  readonly status?: string;
  readonly roleCode?: string;
  readonly canCreateProjects?: boolean;
  readonly user?: {
    readonly id?: string;
    readonly fullName?: string;
    readonly firstName?: string;
    readonly lastName?: string;
    readonly email?: string;
    /** The same record `GET /user/info` carries; the official app draws members with it. */
    readonly avatar?: ZeropsUserAvatar | null;
  };
}

export interface ZeropsProject {
  readonly userRoles?: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly clientId?: string;
  readonly created?: string;
  readonly publicZone?: string;
  readonly zeropsSubdomainHost?: string;
  readonly mode?: string;
  /**
   * The project's tags. Carries this product's group membership and
   * environment role (`groups.ts`) alongside whatever the user tagged the
   * project with themselves.
   *
   * Optional because a caller may be holding a project this client wrote by
   * hand in a test, not because the platform omits it: measured 2026-09-05,
   * all three read paths — `GET /client/{id}/project`, `POST /project/search`
   * and `GET /project/{id}` — return it.
   */
  readonly tagList?: ReadonlyArray<string>;
  /**
   * Where the organization's HQ places this project (ADR 0002): its application, its kind, its
   * Mate's face. Not a platform field: the client joins it from HQ's structure where
   * projects enter the screen (`placeProjects`), and it is absent while that structure is unknown
   * or places no such project.
   */
  readonly hq?: HqPlacement;
  readonly hqTool?: "gitea";
  /** Round-tripped by every project write, which must not blank it. */
  readonly description?: string;
  /**
   * Round-tripped by every record write (`writeProject`). `PUT
   * /project/{id}` replaces the record, so a tag write that omitted these two
   * would quietly take a shared IPv4 away or reset somebody's credit limit on
   * any project.
   */
  readonly publicIpV4Shared?: boolean;
  readonly maxCreditLimit?: number | null;
}

/**
 * The body of `PUT /project/{id}` that writes a project's name and tags.
 *
 * Five fields, and `userRoles` is not among them. The platform replaces the
 * record, and `userRoles` is an object on the wire whose omission means "leave
 * the roles alone" and whose inclusion would rewrite who can reach the
 * project. A name or a tag write has no business doing that.
 */
function projectWriteBody(input: {
  readonly name: string;
  readonly description?: string | undefined;
  readonly tagList: ReadonlyArray<string>;
  readonly publicIpV4Shared?: boolean | undefined;
  readonly maxCreditLimit?: number | null | undefined;
}): {
  readonly name: string;
  readonly description: string;
  readonly tagList: ReadonlyArray<string>;
  readonly publicIpV4Shared: boolean;
  readonly maxCreditLimit: number | null;
} {
  return {
    name: input.name,
    description: input.description ?? "",
    // The list the writer planned (`withZeropsMateTag`): the project's own tags with the marker.
    tagList: input.tagList,
    publicIpV4Shared: input.publicIpV4Shared ?? false,
    maxCreditLimit: input.maxCreditLimit ?? null,
  };
}

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
 * Measured on `acme-docs-dev` 2026-09-06 (`verified.md`).
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
 * says. Measured on `scratch-playground` 2026-09-06 (`verified.md`).
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

/** The dashboard's "Last 24 Hours": hourly buckets, 24 of them. */
export interface ZeropsStatHistoryWindow {
  /** `1m`, `1h`, `1d`, `1w` or `1M` — the bucket. */
  readonly timeGroupBy: string;
  /** How many buckets back from now. */
  readonly limit: number;
  /** An IANA zone; buckets are aligned to it. */
  readonly timeZone: string;
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
  readonly githubIntegration?: ZeropsGitIntegration | null;
  readonly gitlabIntegration?: ZeropsGitIntegration | null;
  readonly publicGitSource?: {
    readonly branchName?: string | null;
    readonly repositoryUrl?: string | null;
  } | null;
}

/** One corner of the vertical autoscaling envelope; `null` where the platform has no value. */
export interface ZeropsAutoscalingResource {
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

/**
 * A managed service — a database, a cache, a storage: any type category but a
 * runtime's `USER`, the line the service map draws between its data and its
 * runtimes (`topology.ts`). A service whose category is not known is taken as
 * one that runs code.
 */
function isManagedService(service: ZeropsService): boolean {
  const category = service.serviceStackTypeInfo?.serviceStackTypeCategory;
  return category !== undefined && category !== "USER";
}

/** One record from `GET /service-stack/{id}/env`. */
export interface ZeropsServiceEnvVar {
  readonly id: string;
  readonly key: string;
  readonly content: string;
}

/**
 * The service env key zcp keys every mate-shaped effect off. Nothing about
 * Zerops Mate happens in a container without it: no bundle, no unit, no
 * `/mate/` location. Spelled here once because it is a contract with zcp, not
 * a value this client is free to choose.
 */
const ZEROPS_MATE_ENV_KEY = "ZCP_MATE_ENABLED";

/**
 * zcp's own reading of that flag: `1` or `true`, case-insensitive, surrounding
 * space tolerated. Deliberately forgiving, because it is a value a person
 * types into a service's env in the Zerops GUI, where a silently ignored
 * spelling is indistinguishable from a broken feature.
 */
export function readsAsEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export interface ZeropsRegistrationResponse {
  readonly auth: ZeropsSession;
  readonly user: ZeropsUser | null;
  /** Organization selected by a platform hand-over, when it named one. */
  readonly clientId?: string;
  /**
   * Whether the pool handed this account a ready project. `false` means the
   * pool is exhausted and the account has to create one — a fact about the
   * platform's stock, never an error.
   */
  readonly zcpClaimed?: boolean;
}

export interface ZeropsLoginResponse {
  readonly auth: ZeropsSession;
  /** Null while a second factor is still outstanding. */
  readonly user: ZeropsUser | null;
}

/**
 * Why a Zerops call failed, in the terms the UI branches on. `expired-session`
 * means the credential is gone (the client has already signed itself out);
 * `forbidden` means this account may not touch that resource and the session
 * is still good.
 */
export type ZeropsApiErrorKind =
  | "network"
  | "uncertain"
  | "expired-session"
  | "forbidden"
  | "not-found"
  | "invalid-input"
  | "server"
  | "unexpected";

/**
 * A project write its admission refused before anything was sent: nothing reached Zerops, so it
 * cannot have landed. Says the admission's own words; `refusal` is what the admission threw.
 */
export class ZeropsWriteNotSent extends Error {
  readonly refusal: unknown;

  constructor(refusal: unknown) {
    super(
      typeof refusal === "object" &&
        refusal !== null &&
        "message" in refusal &&
        typeof refusal.message === "string"
        ? refusal.message
        : "The write was not sent.",
    );
    this.name = "ZeropsWriteNotSent";
    this.refusal = refusal;
  }
}

export class ZeropsApiError extends Error {
  readonly kind: ZeropsApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  /** What the platform itself said, when it said anything; `null` for a status alone. */
  readonly detail: string | null;
  /** How long a throttled request was asked to wait (its `Retry-After`); `null` when unsaid. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    kind: ZeropsApiErrorKind,
    status: number | null = null,
    code: string | null = null,
    detail: string | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ZeropsApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The longest a `Retry-After` holds a read: a header asking for a day is read as ten minutes. */
export const RETRY_AFTER_CAP_MS = 10 * 60_000;

/**
 * A `Retry-After` header as milliseconds from `nowMs`: delta seconds or an HTTP date; `null` when
 * absent or unreadable, never negative and never past `RETRY_AFTER_CAP_MS`.
 */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Math.min(RETRY_AFTER_CAP_MS, Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.min(RETRY_AFTER_CAP_MS, Math.max(0, at - nowMs));
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
  const region = zeropsRegionFromPublicZone(project.publicZone);
  if (!region) return undefined;
  return port.port === 80
    ? `https://${service.name}-${project.zeropsSubdomainHost}.${region}.zerops.app`
    : buildZeropsContainerUrl(service.name, project.zeropsSubdomainHost, port.port, region);
}

/**
 * Every org the account is an active member of. An account can belong to
 * several; callers select one exact membership before loading scoped data.
 */
export function zeropsClientsFromUser(user: ZeropsUser): ReadonlyArray<ZeropsOrganization> {
  const seen = new Set<string>();
  const organizations: ZeropsOrganization[] = [];
  for (const membership of user.clientUserList ?? []) {
    if (membership.status && membership.status !== "ACTIVE") continue;
    const id = membership.clientId ?? membership.client?.id ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    organizations.push({
      id,
      membershipId: membership.id,
      name: membership.client?.accountName ?? membership.client?.companyName ?? "Organization",
      ...(membership.roleCode ? { roleCode: membership.roleCode } : {}),
      ...(membership.canCreateProjects !== undefined
        ? { canCreateProjects: membership.canCreateProjects }
        : {}),
      ...(membership.canViewFinances !== undefined
        ? { canViewFinances: membership.canViewFinances }
        : {}),
      ...(membership.canEditFinances !== undefined
        ? { canEditFinances: membership.canEditFinances }
        : {}),
    });
  }
  return organizations;
}

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

function findString(value: unknown, keys: ReadonlyArray<string>): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const candidate of Object.values(record)) {
    const nested = findString(candidate, keys);
    if (nested) return nested;
  }
  return null;
}

/** The platform's answer for an integration token it no longer has (`deleteIntegrationToken`). */
const isTokenGone = (cause: unknown): boolean =>
  cause instanceof ZeropsApiError &&
  cause.status === 400 &&
  cause.code === "clientUserConnectionNotFound";

function errorKindFor(status: number, code: string | null): ZeropsApiErrorKind {
  if (status === 401) return "expired-session";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 400) {
    // The API answers a made-up id with `400 projectNotFound`, so "gone" and
    // "malformed" have to be separated by the code, not the status.
    return code && /notFound$/i.test(code) ? "not-found" : "invalid-input";
  }
  if (status >= 500) return "server";
  return "unexpected";
}

async function apiErrorFromResponse(response: Response): Promise<ZeropsApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON error response still carries a useful status.
  }
  const code = findString(body, ["code", "errorCode"]);
  const backendMessage = findString(body, ["message", "detail", "description"]);
  const kind = errorKindFor(response.status, code);
  const message =
    kind === "expired-session"
      ? "Your Zerops session has expired. Sign in again."
      : kind === "forbidden"
        ? "This Zerops account is not allowed to do that."
        : (backendMessage ?? `Zerops API request failed (${response.status}).`);
  return new ZeropsApiError(
    message,
    kind,
    response.status,
    code,
    backendMessage ?? null,
    // @effect-diagnostics-next-line globalDate:off -- an HTTP date is read against the wall clock it names.
    parseRetryAfterMs(response.headers.get("retry-after"), Date.now()),
  );
}

export interface ZeropsApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchImplementation;
  /** Fired whenever the held session changes — persist it, or clear on null. */
  readonly onSessionChange?: (session: ZeropsSession | null) => Promise<void> | void;
  /**
   * Runs every renewal of `stale`. It either runs `refresh` — the network
   * refresh, which also stores its answer — or answers a session another tab
   * already renewed for this login, which is held without being stored again.
   * A refusal it throws leaves the held session and storage as they are.
   * Without it, every renewal is a network refresh.
   */
  readonly renewSession?: (
    stale: ZeropsSession,
    refresh: () => Promise<ZeropsSession>,
  ) => Promise<ZeropsSession>;
  /**
   * Holds one integration token's read-then-write at a time (`mate:token:{id}`), shared with
   * every other writer of the account's tokens in this browser. Without it, this client's own
   * writes queue per token in memory.
   */
  readonly holdToken?: TokenWriteHold;
}

export interface ZeropsDataHttpRequest {
  readonly path: string;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly operationKind: "read" | "project-write";
  readonly signal: AbortSignal;
  readonly beforeWrite?: () => Promise<void>;
  /** Background data failures are scoped and never sign the account out. */
  readonly background: boolean;
}

/**
 * Where the client asks, just before it sends each project write, whether
 * project writes are admitted now (DESIGN §4.3). It may wait for them to be;
 * what it rejects with reaches the write's caller as it came, never as a
 * write that failed or may have happened, because nothing was sent.
 */
export interface WriteAdmission {
  readonly beforeProjectWrite: () => Promise<void>;
}

interface RequestOptions {
  /**
   * Explicit transport intent. POST is also used for Zerops reads, so method
   * and URL shape cannot safely decide access admission or uncertainty.
   */
  readonly operationKind?: "read" | "account-write" | "project-write";
  readonly authenticated?: boolean;
  readonly retryAfterRefresh?: boolean;
  /** Rechecked immediately before every project-mutating fetch, including retries. */
  readonly beforeProjectWrite?: () => Promise<void>;
  /**
   * Whether a 401 that survives a refresh attempt (or a refresh that itself
   * fails) signs the account out via `onSessionChange(null)`. Defaults to
   * `true` for every ordinary call — an expired session should sign a person
   * out of the UI they are looking at. `false` is for a background reader
   * whose own 401 is not evidence the account's session is gone (a poll that
   * only proves that ONE endpoint refused THIS request): it still surfaces the
   * 401 as a thrown `ZeropsApiError`, it just never clears the held session
   * out from under whatever else is using it.
   */
  readonly clearSessionOnUnauthorized?: boolean;
  /** Told the access token each attempt carries, just before it is sent. */
  readonly sentWith?: (accessToken: string) => void;
  /**
   * Whether a request lost in transport may still have been carried out, so
   * its failure is `uncertain` rather than `network`. Defaults to whether it
   * writes a project.
   */
  readonly mayHaveWritten?: boolean;
  /** The answer carries no JSON (an upload's empty body): it is not read. */
  readonly ignoreAnswer?: boolean;
}

/**
 * Whether a mint carries no rights at all: `NO_ACCESS` and an empty project
 * list, with the flags every mint here sends as false (spec-mate C6). Such a
 * mint is an `account-write`; one that names no project list is left to the
 * platform's default and stays a `project-write`, as does every grant.
 */
function grantsNothing(mint: {
  readonly roleCode: ZeropsProjectRole;
  readonly projects?: ReadonlyArray<ZeropsProjectGrant>;
}): boolean {
  return mint.roleCode === "NO_ACCESS" && mint.projects?.length === 0;
}

/**
 * Whether the platform refused a project variable because the key is already
 * there. Its words are the only marker: the code is the generic
 * `invalidUserInput` every bad body gets.
 */
function waitForPromiseOrAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  if (signal == null) return promise;
  if (signal.aborted)
    return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The request was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(cause);
      },
    );
  });
}

export interface ListProjectsOptions {
  readonly statuses?: ReadonlyArray<string>;
  readonly limit?: number;
  /** Stops every page read of the listing. */
  readonly signal?: AbortSignal;
}

/** Offset pagination is shared by the direct list and permission-filtered
 * search. A changing count, duplicate page, or short incomplete response must
 * be retried as an inventory read, never published as confirmed deletion. */
async function readProjectPages<T extends { readonly id: string }>(
  limit: number,
  load: (offset: number) => Promise<{
    readonly items: ReadonlyArray<T> | undefined;
    readonly total: number | undefined;
  }>,
): Promise<ReadonlyArray<T>> {
  const projects: T[] = [];
  const seen = new Set<string>();
  let expectedTotal: number | undefined;
  const incomplete = () =>
    new ZeropsApiError("Zerops returned an incomplete project inventory.", "unexpected");
  if (!Number.isInteger(limit) || limit < 1) throw incomplete();
  for (let page = 0; page < 100; page += 1) {
    const response = await load(projects.length);
    if (!Array.isArray(response.items)) throw incomplete();
    if (response.total !== undefined) {
      if (
        !Number.isInteger(response.total) ||
        response.total < 0 ||
        (expectedTotal !== undefined && expectedTotal !== response.total)
      )
        throw incomplete();
      expectedTotal = response.total;
    }
    for (const project of response.items) {
      if (seen.has(project.id)) throw incomplete();
      seen.add(project.id);
      projects.push(project);
    }
    if (expectedTotal !== undefined) {
      if (projects.length === expectedTotal) return projects;
      if (projects.length > expectedTotal || response.items.length === 0) throw incomplete();
    } else if (response.items.length < limit) return projects;
  }
  throw incomplete();
}

/**
 * A Mate's key is named as the platform named the one it used to mint with the container,
 * `zcp-<project>`: `findHeldMateKey` finds either by that and its grant.
 */
function mateKeyName(projectName: string): string {
  return `zcp-${projectName}`;
}

/**
 * Owns request serialization so N parallel 401s cause exactly one refresh, and
 * so the caller never has to think about the Authorization header.
 */
/** A routing of a project's own domains (`GET /project/{id}/public-http-routing`). */
export interface ZeropsPublicHttpRouting {
  readonly id: string;
  /** Whether it is in place as it reads, or waits for the project's routings to be synced. */
  readonly isSynced: boolean;
  readonly domains: ReadonlyArray<{
    readonly domainName: string;
    /** The certificate's state: `ACTIVE` once the domain serves over HTTPS. */
    readonly sslStatus: string | undefined;
    /** Why the certificate could not be installed, where the platform says. */
    readonly sslError: string | undefined;
  }>;
}

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export function publicHttpRoutingsOf(
  items: ReadonlyArray<unknown>,
): ReadonlyArray<ZeropsPublicHttpRouting> {
  return items.flatMap((item): ReadonlyArray<ZeropsPublicHttpRouting> => {
    if (typeof item !== "object" || item === null) return [];
    const { id, isSynced, domains } = item as {
      readonly id?: unknown;
      readonly isSynced?: unknown;
      readonly domains?: unknown;
    };
    const routingId = textOf(id);
    if (routingId === undefined) return [];
    return [
      {
        id: routingId,
        isSynced: isSynced === true,
        domains: (Array.isArray(domains) ? domains : []).flatMap((domain: unknown) => {
          if (typeof domain !== "object" || domain === null) return [];
          const { domainName, sslStatus, sslCertificateInstallationError } = domain as {
            readonly domainName?: unknown;
            readonly sslStatus?: unknown;
            readonly sslCertificateInstallationError?: unknown;
          };
          const name = textOf(domainName);
          return name === undefined
            ? []
            : [
                {
                  domainName: name,
                  sslStatus: textOf(sslStatus),
                  sslError: textOf(sslCertificateInstallationError),
                },
              ];
        }),
      },
    ];
  });
}

/**
 * The container's creation process out of the processes a container import answered with: its
 * `stack.create`, else the first it named; none where it named none.
 */
function importProcessOf(processes: ReadonlyArray<unknown> | undefined): string | undefined {
  const named = (processes ?? []).flatMap((process) => {
    if (typeof process !== "object" || process === null) return [];
    const { id, actionName } = process as { readonly id?: unknown; readonly actionName?: unknown };
    return typeof id === "string" && id.length > 0 ? [{ id, actionName }] : [];
  });
  return (named.find((process) => process.actionName === "stack.create") ?? named[0])?.id;
}

export class ZeropsApiClient {
  /** Asked before every project write; none admits every write. */
  #writeAdmission: WriteAdmission | null = null;
  /**
   * Admits this client's project writes through `admission` from now on: the
   * account epoch's own, which refuses them once that epoch closed.
   */
  admitWritesThrough(admission: WriteAdmission): void {
    this.#writeAdmission = admission;
  }
  readonly #baseUrl: string;
  readonly #fetch: FetchImplementation;
  readonly #onSessionChange: (session: ZeropsSession | null) => Promise<void> | void;
  readonly #renewSession: NonNullable<ZeropsApiClientOptions["renewSession"]>;
  #session: ZeropsSession | null = null;
  #generation = 0;
  #refreshPromise: Promise<ZeropsSession> | null = null;
  /** OR'd across every caller sharing the current `#refreshPromise` — see `#refreshSession`'s doc comment. */
  #refreshClearOnFailure = true;

  constructor(options: ZeropsApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_ZEROPS_API_BASE).replace(/\/+$/, "");
    // Bound to globalThis on purpose: the browser's `fetch` is brand-checked
    // against Window, so storing the bare function and calling it as
    // `this.#fetch(...)` throws "Illegal invocation".
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onSessionChange = options.onSessionChange ?? (() => undefined);
    this.#renewSession = options.renewSession ?? ((_stale, refresh) => refresh());
    this.#holdToken = options.holdToken ?? makeTokenWriteLock();
  }

  get session(): ZeropsSession | null {
    return this.#session;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  /**
   * The account epoch this client is in. It moves on every sign-out and every
   * session adopted from storage or a hand-over, so whatever one account
   * accrues in this tab can be keyed to it and left behind with it.
   */
  get accountEpoch(): number {
    return this.#generation;
  }

  /** Authenticated transport seam for the central data adapter. */
  requestData(input: ZeropsDataHttpRequest): Promise<unknown> {
    return this.#request(
      input.path,
      {
        method: input.method ?? "GET",
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: input.signal,
      },
      {
        operationKind: input.operationKind,
        ...(input.beforeWrite === undefined ? {} : { beforeProjectWrite: input.beforeWrite }),
        clearSessionOnUnauthorized: !input.background,
      },
    );
  }

  /**
   * Renews the held session once, for a background reader: the same refresh every request makes
   * after a 401. A renewal the platform refuses ends the session — nothing repairs it until the
   * person signs in again — while one that never reached the platform leaves it held.
   */
  async renewHeldSession(): Promise<void> {
    await this.#refreshSession(true);
  }

  /** Adopts a session read back from storage without re-notifying the owner. */
  restoreSession(session: ZeropsSession): void {
    this.#nextGeneration();
    this.#session = session;
  }

  /**
   * Holds a session another tab renewed for this same login. Requests in
   * flight keep their generation, and nothing is stored: the other tab did.
   */
  adoptRenewedSession(session: ZeropsSession): void {
    this.#session = session;
  }

  /**
   * Drops a session another tab removed. Requests in flight lose their
   * answers, and storage is left alone: by now it may hold that tab's next
   * session, which is not this tab's to clear.
   */
  forgetSession(): void {
    this.#generation += 1;
    this.#session = null;
  }

  /**
   * Adopts a session minted elsewhere: the bearer the sign-in hand-over
   * delivers (`zerops/handover.ts`), with no refresh token, or — dev builds
   * only — a full `/auth/login` session an agent injects.
   *
   * It is **proven before it is stored**: a dead token that reached storage
   * would render a signed-in-looking UI that fails on its first real call. So
   * it is held in memory, spent on one read, and only persisted once that read
   * comes back. Without a refresh token, a later 401 clears the session
   * instead of trying to refresh it.
   */
  async adoptSession(input: {
    readonly accessToken: string;
    readonly refreshToken?: string;
  }): Promise<ZeropsSession> {
    const accessToken = input.accessToken.trim();
    if (!accessToken) {
      throw new ZeropsApiError(
        "That Zerops sign-in carried no credential. Start again.",
        "invalid-input",
      );
    }
    const refreshToken = input.refreshToken?.trim();
    const session: ZeropsSession = refreshToken ? { accessToken, refreshToken } : { accessToken };
    const generation = this.#nextGeneration();
    this.#session = session;
    try {
      // A refusal here is not a held session ending, so it must not announce one.
      await this.#readUser(null, { retryAfterRefresh: false, clearSessionOnUnauthorized: false });
    } catch (cause) {
      if (generation === this.#generation) this.#session = null;
      throw cause;
    }
    this.#assertGeneration(generation);
    await this.#setSession(session);
    this.#assertGeneration(generation);
    return session;
  }

  async signOutLocally(): Promise<void> {
    this.#nextGeneration();
    await this.#setSession(null);
  }

  /** `POST /registration` — signs up and returns an immediately usable session. */
  async register(input: ZeropsRegistrationInput): Promise<ZeropsRegistrationResponse> {
    if (!input.turnstileToken.trim()) {
      // The platform refuses a registration without a captcha token, so there
      // is nothing to gain by sending one — and the caller needs the same
      // typed failure it would get from the server.
      throw new ZeropsApiError(
        "Cloudflare captcha verification failed. Please try again.",
        "invalid-input",
        400,
        ZEROPS_CAPTCHA_ERROR_CODE,
      );
    }
    const response = await this.#request<ZeropsRegistrationResponse>(
      "/registration",
      { method: "POST", body: JSON.stringify(buildZeropsRegistrationBody(input)) },
      { authenticated: false, retryAfterRefresh: false, operationKind: "account-write" },
    );
    if (!isZeropsSession(response.auth)) {
      throw new ZeropsApiError("Zerops returned an invalid sign-up session.", "unexpected");
    }
    await this.#setSession(response.auth);
    return response;
  }

  async login(email: string, password: string): Promise<ZeropsLoginResponse> {
    const response = await this.#request<ZeropsLoginResponse>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email: email.trim(), password }) },
      { authenticated: false, retryAfterRefresh: false, operationKind: "account-write" },
    );
    if (!isZeropsSession(response.auth)) {
      throw new ZeropsApiError("Zerops returned an invalid sign-in session.", "unexpected");
    }
    // A half-session (2FA outstanding) is held in memory so the TOTP call can
    // authenticate with it; storage refuses it (see session.ts).
    await this.#setSession(response.auth);
    return response;
  }

  async verifyTotp(code: string): Promise<ZeropsSession> {
    if (!requiresZeropsTwoFactor(this.#session)) {
      throw new ZeropsApiError(
        "Start a Zerops sign-in before entering a two-factor code.",
        "invalid-input",
      );
    }
    const response = await this.#request<{
      readonly auth: ZeropsSession;
      readonly newRecoveryToken?: string;
    }>(
      "/2fa/totp/login",
      { method: "POST", body: JSON.stringify({ token: code.trim() }) },
      { retryAfterRefresh: false, operationKind: "account-write" },
    );
    const session = response.newRecoveryToken
      ? { ...response.auth, newRecoveryToken: response.newRecoveryToken }
      : response.auth;
    if (!isUsableZeropsSession(session)) {
      await this.#setSession(null);
      throw new ZeropsApiError("Zerops returned an invalid two-factor session.", "unexpected");
    }
    await this.#setSession(session);
    return session;
  }

  async logout(): Promise<void> {
    const session = this.#session;
    // Local closure precedes network work, including an offline logout. This
    // request holds the old credential and cannot clear a subsequent login.
    await this.signOutLocally();
    if (session) {
      const response = await this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!response.ok && response.status !== 401) throw await apiErrorFromResponse(response);
    }
  }

  /** Ends the account epoch: nothing asked for in it runs in the next. */
  #nextGeneration(): number {
    this.#generation += 1;
    return this.#generation;
  }

  #assertGeneration(generation: number): void {
    if (generation !== this.#generation) {
      throw new ZeropsApiError("This account session has ended.", "expired-session", 401);
    }
  }

  readonly #holdToken: TokenWriteHold;

  fetchUser(signal?: AbortSignal): Promise<ZeropsUser> {
    return this.#readUser(signal ?? null, {});
  }

  async #readUser(signal: AbortSignal | null, options: RequestOptions): Promise<ZeropsUser> {
    const generation = this.#generation;
    const user = await this.#request<ZeropsUser>("/user/info", { signal }, options);
    // @effect-diagnostics-next-line globalDate:off -- dated on the wall clock its readers' Clock reads.
    this.#verified = { user, atMs: Date.now(), generation };
    return user;
  }

  /**
   * The user the platform last answered `GET /user/info` with for this session, and when — so a
   * reader moments after the session's own read takes it rather than asking again.
   */
  verifiedUser(): { readonly user: ZeropsUser; readonly atMs: number } | null {
    const verified = this.#verified;
    return verified === null || verified.generation !== this.#generation
      ? null
      : { user: verified.user, atMs: verified.atMs };
  }

  #verified: {
    readonly user: ZeropsUser;
    readonly atMs: number;
    readonly generation: number;
  } | null = null;

  /**
   * The organizations whose direct project list refused this account, each with the account epoch
   * it refused in. Zerops answers `GET /client/{id}/project` with 403 for a Developer or Guest
   * membership, whose access is per project, and that is its final answer for the person: their
   * lists read `/project/search` from then on, the read the platform applies their roles to.
   */
  readonly #projectListRefusals = new Map<string, number>();

  /** Whether `clientId`'s direct project list refused this account in this epoch. */
  projectListRefused(clientId: string): boolean {
    return this.#projectListRefusals.get(clientId) === this.#generation;
  }

  /** Keeps `clientId`'s direct project list refused for the rest of this account epoch. */
  noteProjectListRefused(clientId: string): void {
    this.#projectListRefusals.set(clientId, this.#generation);
  }

  /**
   * `GET /client/{id}/project` — the direct read. It is lag-free: a project is
   * visible here before its create call has even returned, while the
   * Elasticsearch-backed `POST /project/search` trails it. Anything just
   * created is resolved through this call, never through a search.
   */
  async listClientProjects(
    clientId: string,
    options: ListProjectsOptions = {},
  ): Promise<ReadonlyArray<ZeropsProject>> {
    const limit = options.limit ?? 500;
    return readProjectPages(limit, async (offset) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (offset) query.set("offset", String(offset));
      if (options.statuses?.length) query.set("statuses", options.statuses.join(","));
      const response = await this.#request<{
        readonly list?: ReadonlyArray<ZeropsProject>;
        // `total` is what it answers (measured 2026-09-18); without it the
        // reader had no count to check a page against, so a page the platform
        // cut short read as the end of the account rather than as a failure.
        readonly total?: number;
        readonly totalCount?: number;
      }>(`/client/${clientId}/project?${query.toString()}`, { signal: options.signal ?? null });
      return { items: response.list, total: response.total ?? response.totalCount };
    });
  }

  /**
   * Lists the projects this membership may actually see.
   *
   * OWNER/ADMIN-style memberships use the lag-free client read. Zerops
   * intentionally rejects that endpoint for Developer/Guest memberships,
   * whose access is expressed by per-project roles; the same `/project/search`
   * query used by the platform GUI applies those permissions server-side.
   */
  async listAccessibleClientProjects(
    clientId: string,
    options: ListProjectsOptions = {},
  ): Promise<ReadonlyArray<ZeropsProject>> {
    return (await this.readAccessibleClientProjects(clientId, options)).projects;
  }

  /**
   * `listAccessibleClientProjects`, saying which read answered. `direct` is the
   * lag-free client read, whose rows carry each project's `userRoles` exactly as
   * `GET /project/{id}` does (measured 2026-10-01, 6 of 6 projects equal). The
   * search fallback's rows carry only the searcher's own grants (measured
   * 2026-10-03 as the KRLS Developer: Cyd's row named their `OWNER` alone, its
   * own read the Mate key's `BASIC_USER` beside it), so a caller judging access
   * or anyone's grant from a row trusts only a direct one.
   */
  async readAccessibleClientProjects(
    clientId: string,
    options: ListProjectsOptions = {},
  ): Promise<{ readonly projects: ReadonlyArray<ZeropsProject>; readonly direct: boolean }> {
    if (!this.projectListRefused(clientId)) {
      try {
        return { projects: await this.listClientProjects(clientId, options), direct: true };
      } catch (cause) {
        if (!(cause instanceof ZeropsApiError) || cause.kind !== "forbidden") throw cause;
        this.noteProjectListRefused(clientId);
      }
    }

    const limit = options.limit ?? 500;
    const projects = await readProjectPages(limit, async (offset) => {
      const response = await this.#request<{
        readonly items?: ReadonlyArray<ZeropsProject>;
        readonly totalHits?: number;
      }>(
        "/project/search",
        {
          method: "POST",
          signal: options.signal ?? null,
          body: JSON.stringify({
            limit,
            ...(offset ? { offset } : {}),
            search: [{ name: "clientId", operator: "eq", value: clientId }],
          }),
        },
        { operationKind: "read" },
      );
      return { items: response.items, total: response.totalHits };
    });
    if (!options.statuses?.length) return { projects, direct: false };
    const statuses = new Set(options.statuses);
    return { projects: projects.filter((project) => statuses.has(project.status)), direct: false };
  }

  /**
   * `PUT /project/{id}` with `name` and `tagList` — the one call that writes a
   * project's name and tags, and only the TagWriter makes it
   * (`data/tagWriter.ts`), with a record it just read and changed.
   *
   * `project` is the read the record came from: the platform replaces the
   * record, so the fields the write must not change are round-tripped from it
   * (`projectWriteBody`), and `userRoles` is never sent.
   */
  async writeProject(
    project: ZeropsProject,
    record: { readonly name: string; readonly tagList: ReadonlyArray<string> },
  ): Promise<ZeropsProject> {
    return this.#request<ZeropsProject>(
      `/project/${project.id}`,
      {
        method: "PUT",
        body: JSON.stringify(
          projectWriteBody({
            name: record.name,
            description: project.description,
            tagList: record.tagList,
            publicIpV4Shared: project.publicIpV4Shared,
            maxCreditLimit: project.maxCreditLimit,
          }),
        ),
      },
      { operationKind: "project-write" },
    );
  }

  /**
   * Hands a Mate to a person — or takes it away (guide 0.8, D11).
   *
   * A per-project role override, written by an org owner or admin. It is the
   * verb the hand-over cases need: a Mate created for a colleague, a leaver's,
   * a reassignment. Without one the colleague is whatever the org says they
   * are, which for a plain member is `READ_ONLY` — they see the Mate and never
   * open it.
   *
   * It is written on the person, `PUT /client-user/{id}/roles`, never on the
   * project: `PUT /project/{id}` with `userRoles` replaces the project's whole
   * list, refuses to name an integration token (`400 userNotFound`), and a
   * list of people only drops the Mate key's own grant (measured 2026-10-03,
   * `f7-handover-probe.json`). The person's list is read and sent back whole
   * with this project's role set — or, `null`, without it: what a hand over
   * takes from the Mate's previous owner (F23) — so their other projects keep
   * theirs. What it answers is the project as the platform holds it after the
   * write.
   */
  async setProjectMemberRole(input: {
    readonly projectId: string;
    /** The `clientUser` id — what a project's `userRoles` names. */
    readonly clientUserId: string;
    readonly roleCode: ZeropsProjectRole | null;
  }): Promise<ZeropsProject> {
    const generation = this.#generation;
    this.#assertGeneration(generation);
    const roles = `/client-user/${input.clientUserId}/roles`;
    const held = await this.#request<{
      readonly projectRoleList?: ReadonlyArray<{
        readonly projectId: string;
        readonly roleCode: string;
      }>;
    }>(roles, {}, { operationKind: "read" });
    this.#assertGeneration(generation);
    await this.#request(
      roles,
      {
        method: "PUT",
        body: JSON.stringify({
          projectRoleList: withMateProjectRole(
            held.projectRoleList,
            input.projectId,
            input.roleCode,
          ),
        }),
      },
      { operationKind: "project-write" },
    );
    this.#assertGeneration(generation);
    return this.fetchProject(input.projectId);
  }

  /**
   * Imports a group's recipe into an existing project — the step that turns an
   * empty environment into the group's application.
   *
   * The YAML must carry `services:` and must NOT carry a `project:` block; the
   * platform rejects one outright (`projectImportProjectIncluded`, measured
   * 2026-09-05). `recipeServicesYaml` in `recipeStore.ts` is the transform from
   * a published recipe to what this accepts.
   *
   * Nothing here reaches into a container: the recipe comes from the store and
   * the import is a platform call with the user's own token, so creating an
   * environment never depends on another environment being alive.
   */
  importServicesIntoProject(
    projectId: string,
    servicesYaml: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<ZeropsServiceImportResult> {
    return this.#request<ZeropsServiceImportResult>(
      `/project/${projectId}/service-stack/import`,
      {
        method: "POST",
        signal: signal ?? null,
        body: JSON.stringify({ yaml: servicesYaml }),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * `POST /client/{id}/integration-token` — mints a token and returns its
   * value, which the platform shows exactly once.
   *
   * No flags, ever: `canCreateProjects` and the finance flags are what turn a
   * token into something that can name a person at a door (3.2), and nothing
   * this client mints needs them.
   *
   * A mint that grants anything is a `project-write`, admitted by the account
   * window and `beforeWrite`; one that grants nothing is an `account-write`,
   * which neither holds up.
   */
  async mintIntegrationToken(
    input: {
      readonly clientId: string;
      readonly name: string;
      readonly roleCode: ZeropsProjectRole;
      readonly projects?: ReadonlyArray<ZeropsProjectGrant>;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{ readonly id: string; readonly token: string }> {
    const { id, token } = await this.#mintIntegrationToken(input, signal, beforeWrite);
    return { id, token };
  }

  /**
   * Mints a throwaway — `NO_ACCESS`, no projects, no flags — for one door
   * (`authorization/zeropsThrowaway.ts`).
   *
   * It carries no rights, so it is an `account-write` that a closed account
   * window does not hold up (spec-mate C6): the door decides what it opens,
   * with its own key, when it is presented.
   *
   * `beforeMint` is a wait of the caller's own — a rate budget — that the
   * mint queues behind. The wait belongs to the account epoch the mint was
   * asked in: one that ends meanwhile refuses the mint with
   * `expired-session`, so nothing is minted as whoever signed in since.
   *
   * `mintingToken` is the session access token the mint carried. The
   * throwaway is deleted with that token and no other
   * ({@link deleteThrowaway}), so its deletion never acts as whoever holds
   * this client by then.
   */
  async mintThrowaway(
    input: { readonly clientId: string; readonly name: string },
    options: { readonly signal?: AbortSignal; readonly beforeMint?: () => Promise<void> } = {},
  ): Promise<{ readonly id: string; readonly token: string; readonly mintingToken: string }> {
    const generation = this.#generation;
    await options.beforeMint?.();
    this.#assertGeneration(generation);
    return this.#mintIntegrationToken(
      { clientId: input.clientId, name: input.name, roleCode: "NO_ACCESS", projects: [] },
      options.signal,
      undefined,
    );
  }

  async #mintIntegrationToken(
    input: {
      readonly clientId: string;
      readonly name: string;
      readonly roleCode: ZeropsProjectRole;
      readonly projects?: ReadonlyArray<ZeropsProjectGrant>;
    },
    signal: AbortSignal | undefined,
    beforeWrite: (() => Promise<void>) | undefined,
  ): Promise<{ readonly id: string; readonly token: string; readonly mintingToken: string }> {
    let mintingToken: string | undefined;
    const response = await this.#request<{ readonly id?: string; readonly token?: string }>(
      `/client/${input.clientId}/integration-token`,
      {
        method: "POST",
        signal: signal ?? null,
        body: JSON.stringify({
          name: input.name,
          roleCode: input.roleCode,
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          ...(input.projects === undefined ? {} : { projects: input.projects }),
        }),
      },
      {
        operationKind: grantsNothing(input) ? "account-write" : "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
        // A token exists whether or not its answer arrives.
        mayHaveWritten: true,
        sentWith: (accessToken) => {
          mintingToken = accessToken;
        },
      },
    );
    if (!response.token || !response.id || mintingToken === undefined) {
      throw new ZeropsApiError(
        "Zerops accepted the token but did not return it in full, so it can neither be used nor taken back.",
        "uncertain",
      );
    }
    return { id: response.id, token: response.token, mintingToken };
  }

  /**
   * `DELETE /client/{id}/integration-token/{tokenId}` — takes a token back.
   *
   * The other half of every throwaway: one is minted for a single call and
   * deleted seconds later, and a deletion is immediate at the platform (the
   * value answers `401` within about 0.6 s, measured 2026-09-15).
   *
   * A token the platform no longer has is deleted already: it answers `400
   * clientUserConnectionNotFound` for one, as a Mate's key is once the project it alone reached is
   * deleted (measured live, 2026-10-05). That answer, and only that one, is the delete done.
   */
  async deleteIntegrationToken(
    input: { readonly clientId: string; readonly tokenId: string },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.#request(
        `/client/${input.clientId}/integration-token/${input.tokenId}`,
        { method: "DELETE", signal: signal ?? null },
        {
          operationKind: "project-write",
          ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
        },
      );
    } catch (cause) {
      if (!isTokenGone(cause)) throw cause;
    }
  }

  /**
   * `DELETE /client/{id}/integration-token/{tokenId}` for a throwaway, and for
   * nothing else: a name that is not a throwaway's is refused before anything
   * is sent (spec-mate C5b).
   *
   * An `account-write`: deleting a throwaway only takes authority away, so no
   * access window gates it. It carries `token` — the access token the
   * throwaway was minted with — and never reads the session this client holds,
   * so after a sign-out and another sign-in it still acts as the person who
   * minted, or fails; it never refreshes, never clears a session, and outlives
   * the account epoch. It has its own {@link THROWAWAY_DELETE_TIMEOUT_MS} and
   * no caller's signal: giving up an exchange never keeps its throwaway alive.
   */
  async deleteThrowaway(
    input: { readonly clientId: string; readonly tokenId: string; readonly name: string },
    options: { readonly token: string },
  ): Promise<void> {
    if (!isThrowawayName(input.name)) {
      throw new ZeropsApiError(
        `"${input.name}" is not a throwaway, so it is not deleted as one.`,
        "invalid-input",
      );
    }
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}${PUBLIC_API_PREFIX}/client/${input.clientId}/integration-token/${input.tokenId}`,
        {
          method: "DELETE",
          signal: AbortSignal.timeout(THROWAWAY_DELETE_TIMEOUT_MS),
          headers: { Accept: "application/json", Authorization: `Bearer ${options.token}` },
        },
      );
    } catch (cause) {
      throw new ZeropsApiError(
        cause instanceof Error
          ? `Network error contacting Zerops: ${cause.message}`
          : "Network error contacting Zerops.",
        "network",
      );
    }
    if (!response.ok) throw await apiErrorFromResponse(response);
  }

  /**
   * `PUT /client/{id}/integration-token/{tokenId}/regenerate` — a new value for
   * a token nobody holds the value of any more.
   *
   * The old value dies at once and whoever regenerates becomes the token's
   * creator (measured 2026-09-15), so this is only ever right where nothing is
   * using the old value yet.
   */
  async regenerateIntegrationToken(
    input: { readonly clientId: string; readonly tokenId: string },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<string> {
    const response = await this.#request<{ readonly token?: string }>(
      `/client/${input.clientId}/integration-token/${input.tokenId}/regenerate`,
      { method: "PUT", signal: signal ?? null },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
    if (!response.token) {
      throw new ZeropsApiError(
        "Zerops regenerated the token but did not return its value, so it cannot be used.",
        "uncertain",
      );
    }
    return response.token;
  }

  /** `GET /project/{id}` — also the membership check: 200 member, 403 not. */
  fetchProject(projectId: string, signal?: AbortSignal): Promise<ZeropsProject> {
    return this.#request<ZeropsProject>(`/project/${projectId}`, { signal: signal ?? null });
  }

  /**
   * `GET /project/{id}/log` — a signed URL for the project's log backend
   * (auth rides inside the URL itself; the backend ignores an Authorization
   * header). The response's `url` arrives as `GET https://…` (a legacy
   * method-prefixed form); the prefix is stripped here so no caller has to
   * know about it. Never logged: it is a bearer credential in URL form.
   *
   * `clearSessionOnUnauthorized: false` — this backs a build-log read behind
   * an advisory overlay, not a user-initiated action, so its own 401 must
   * never sign the whole UI out.
   */
  async fetchProjectLogAccess(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<{ readonly url: string }> {
    const response = await this.#request<{ readonly url: string }>(
      `/project/${projectId}/log`,
      { signal: signal ?? null },
      { clearSessionOnUnauthorized: false, operationKind: "read" },
    );
    return { url: response.url.replace(/^GET\s+/, "") };
  }

  /**
   * `POST /web-socket/login` — trades the account's current access token for a
   * short-lived `webSocketToken`, the credential the platform push channel's
   * upgrade URL carries (`docs/internals/zerops/verified.md` "platform
   * websocket from a browser origin", `token` the measured field name — a
   * live probe succeeded with it; `frontend-legacy`'s own `accessToken`
   * naming is unmeasured against this endpoint, so it is not sent).
   *
   * Retries a `401` itself rather than going through `#request`'s own retry:
   * that retry re-sends the exact `init.body` string it was given, so it
   * would resend the STALE token in the body under the FRESH one in the
   * `Authorization` header. Building the body fresh per attempt is the fix.
   * `clearSessionOnUnauthorized: false` on every attempt: this backs a
   * background reconnect (`platformWatch.ts`), not a user-initiated action,
   * so its own 401 must never sign the whole UI out from under something
   * else using the session.
   */
  async exchangeWebSocketToken(signal?: AbortSignal): Promise<{ readonly webSocketToken: string }> {
    const attempt = (): Promise<{ readonly webSocketToken: string }> => {
      const session = this.#session;
      if (!session) {
        throw new ZeropsApiError(
          "Sign in to Zerops before opening a live connection.",
          "expired-session",
          401,
        );
      }
      return this.#request<{ readonly webSocketToken: string }>(
        "/web-socket/login",
        {
          method: "POST",
          body: JSON.stringify({ token: session.accessToken }),
          ...(signal === undefined ? {} : { signal }),
        },
        {
          retryAfterRefresh: false,
          clearSessionOnUnauthorized: false,
          operationKind: "read",
        },
      );
    };

    try {
      return await attempt();
    } catch (cause) {
      if (
        !(cause instanceof ZeropsApiError) ||
        cause.kind !== "expired-session" ||
        !this.#session?.refreshToken
      ) {
        throw cause;
      }
      await waitForPromiseOrAbort(this.#refreshSession(false), signal);
      return attempt();
    }
  }

  /**
   * `POST /client/{clientId}/project` with an explicit tag list, and nothing
   * else — no container: a Mate's comes after its project is attached to its
   * application (`importDevelopmentContainer`), and a production environment
   * is a project that deliberately has no agent (`createEnvironment.ts`). The
   * caller owns the tags, and this client must not decide them.
   */
  async createProject(
    input: {
      readonly clientId: string;
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly location?: string;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<ZeropsProject> {
    return this.#request<ZeropsProject>(
      `/client/${input.clientId}/project`,
      {
        method: "POST",
        signal: signal ?? null,
        body: JSON.stringify(
          buildCreateProjectBody({
            clientId: input.clientId,
            name: input.name,
            tagList: input.tagList.includes("mate") ? ["mate"] : [],
            ...(input.location ? { location: input.location } : {}),
          }),
        ),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * `DELETE /project/{id}` — takes a project off the account. The platform
   * answers with the deleting process and the project is gone shortly after
   * (measured 2026-09-16). What the product deletes through this is a project
   * whose creation the platform itself failed — the half that was built — and
   * a Mate its person deletes, its environment whole.
   */
  async deleteProject(
    projectId: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{ readonly processId: string }> {
    const response = await this.#request<{ readonly id?: unknown }>(
      `/project/${projectId}`,
      { method: "DELETE", signal: signal ?? null },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
    if (typeof response.id !== "string" || response.id.length === 0)
      throw new ZeropsApiError(
        "Zerops accepted the deletion but did not return its process, so it cannot be followed.",
        "uncertain",
      );
    return { processId: response.id };
  }

  /**
   * `PUT /project/{id}/first-class-recipe/development-container` — the zcp
   * that carries the agent, imported into a project that already exists,
   * holding the Mate's own key.
   *
   * The key is minted here, by the person, with its own project and nothing
   * more: `BASIC_USER` there, no grant on any other project (ADR 0003), no
   * delegation. It goes into the container
   * as the secret `ZCP_API_KEY`, and the platform is asked for no token of
   * its own (`createIntegrationToken: false`). The platform's would be
   * `ADMIN`, a project variable every service can read, and a one-time
   * delegation — three things a later step had to take back, from a browser
   * that might have gone by then.
   *
   * Every write is safe to make again, so a press tried again finishes what
   * the first one started:
   * - a project that has its container already makes no write at all, and one holding several zcp
   *   services is refused, naming them: a project holds one Mate (audit D2);
   * - a key an earlier press minted, its container never imported, is reused
   *   — set to its own project alone where it is still `ADMIN` (`planMateKey`),
   *   and its value regenerated, because the value is shown once and nothing
   *   kept it — never a second key beside it.
   *
   * The value lives in this call alone: it is in the import's body and in no
   * answer, no log and no error.
   */
  async importDevelopmentContainer(
    input: {
      readonly clientId: string;
      readonly projectId: string;
      /** The project's name: the key is `zcp-<name>`, as the platform names its own. */
      readonly projectName: string;
      readonly zcpVersion?: string;
      readonly agents?: ReadonlyArray<ZeropsAgentType>;
      /** The tier's runtimes, for zcp to import on boot (`MATE_SETUP_RUNTIMES`). */
      readonly setupRuntimesYaml?: string;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{
    readonly serviceName: string;
    readonly imported: boolean;
    /** The container's creation process Zerops answered the import with, where it named one. */
    readonly processId?: string;
  }> {
    const services = await this.listProjectServices(input.projectId, signal);
    const container = mateContainerOf(services);
    if (container.kind === "several") throw new Error(severalMatesLine(container.names));
    if (container.kind === "one") return { serviceName: container.service.name, imported: false };

    const generation = this.#generation;
    const grants: ReadonlyArray<ZeropsProjectGrant> = [
      { projectId: input.projectId, roleCode: MATE_SELF_PROJECT_ROLE },
    ];
    const tokens = await this.listIntegrationTokens(input.clientId, signal);
    const earlier = newestMateKey(tokens, input.projectId);
    this.#assertGeneration(generation);
    if (earlier !== undefined) {
      // A key is regenerated only where no container holds it: a zcp the platform is still
      // creating does, though the listing above may not show it yet.
      const processes = await this.#request<{ readonly items?: ReadonlyArray<unknown> }>(
        "/process/search",
        {
          method: "POST",
          signal: signal ?? null,
          body: JSON.stringify(projectProcessSearchBody(input)),
        },
        { operationKind: "read" },
      );
      if (zcpCreationUnderWay(Array.isArray(processes.items) ? processes.items : [])) {
        throw new Error("Its container is still being created. Try again in a minute.");
      }
      this.#assertGeneration(generation);
    }
    let apiKey: string;
    if (earlier === undefined) {
      apiKey = (
        await this.mintIntegrationToken(
          {
            clientId: input.clientId,
            name: mateKeyName(input.projectName),
            roleCode: "NO_ACCESS",
            projects: grants,
          },
          signal,
          beforeWrite,
        )
      ).token;
    } else {
      // The write replaces the key's whole project list: it is planned from the key as read
      // under its lock, every token writer's, and lowers its org role to none. Found by its name,
      // a key that reaches another project by then is not the Mate's: it is neither narrowed nor
      // handed to the container.
      await this.#holdToken(earlier.id, async () => {
        const current = (await this.listIntegrationTokens(input.clientId, signal)).find(
          (token) => token.id === earlier.id,
        );
        if (current === undefined) return;
        this.#assertGeneration(generation);
        const plan = planMateKey({
          token: current,
          selfProjectId: input.projectId,
          foundBy: "name",
        });
        if (plan.kind === "not-its-key") {
          throw new Error(
            `The key ${current.name} reaches another project now, so it is not reused. Try again.`,
          );
        }
        if (plan.kind === "held") return;
        await this.setIntegrationTokenProjects(
          {
            clientId: input.clientId,
            tokenId: current.id,
            name: current.name,
            projects: plan.projects,
          },
          signal,
          beforeWrite,
        );
      });
      this.#assertGeneration(generation);
      apiKey = await this.regenerateIntegrationToken(
        { clientId: input.clientId, tokenId: earlier.id },
        signal,
        beforeWrite,
      );
    }

    const serviceName = nextZcpServiceName(services.map((service) => service.name));
    this.#assertGeneration(generation);
    const answered = await this.#request<{ readonly processes?: ReadonlyArray<unknown> }>(
      `/project/${input.projectId}/first-class-recipe/development-container`,
      {
        method: "PUT",
        signal: signal ?? null,
        body: JSON.stringify(
          buildDevelopmentContainerImportBody({
            serviceImportYaml: buildZcpServiceImportYaml({
              serviceName,
              vscodePassword: generateVscodePassword(),
              apiKey,
              ...(input.zcpVersion ? { zcpVersion: input.zcpVersion } : {}),
              ...(input.agents ? { agents: input.agents } : {}),
              ...(input.setupRuntimesYaml ? { setupRuntimesYaml: input.setupRuntimesYaml } : {}),
            }),
          }),
        ),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
    const processId = importProcessOf(answered.processes);
    return { serviceName, imported: true, ...(processId === undefined ? {} : { processId }) };
  }

  /**
   * `POST /client/{id}/project/import` — creates a project **and** its
   * services from one whole-project document.
   *
   * The path for an environment that does not exist yet, in place of create
   * then import-services: the platform's own preprocessor runs over the
   * document, so a recipe's `<@generateRandomString(<32>)>` arrives as a real
   * secret rather than the literal directive (measured 2026-09-06 — a probe
   * import came back with `APP_KEY` set to 32 generated characters). Project
   * tags contain only the Mate marker; HQ binds the accepted project id to
   * its birth intent and owns its membership.
   *
   * `recipeProjectImportYaml` composes the document.
   */
  async importProject(
    clientId: string,
    yaml: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{
    readonly projectId: string;
    readonly serviceStacks?: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly processes: ReadonlyArray<{ readonly id: string }>;
    }>;
  }> {
    return this.#request(
      `/client/${clientId}/project/import`,
      { method: "POST", body: JSON.stringify({ yaml }), signal: signal ?? null },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * `GET /client/{id}/user/list` — the org's members, so a Mate a person
   * cannot open can still say **whose** it is.
   *
   * Any token of the org may read it, integration tokens included (measured
   * 2026-09-15). What comes back is metadata — names, e-mails, roles — and
   * never a credential.
   */
  async listOrganizationMembers(
    clientId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsOrganizationMember>> {
    // `clientUserList`, not `items` — the member list is its own shape
    // (measured 2026-09-18; `ZeropsThrowawayIdentity.ts` says the same).
    const body = await this.#request<{
      readonly clientUserList?: ReadonlyArray<ZeropsOrganizationMember>;
      readonly items?: ReadonlyArray<ZeropsOrganizationMember>;
      readonly list?: ReadonlyArray<ZeropsOrganizationMember>;
    }>(`/client/${clientId}/user/list?limit=100`, { signal: signal ?? null });
    return body.clientUserList ?? body.items ?? body.list ?? [];
  }

  /**
   * `GET /client/{id}/integration-token/list` — every token on the account,
   * with the project grants each one carries.
   *
   * The bare `…/integration-token` GET answers 405; the listing is under
   * `/list` (measured 2026-09-06). `groupReach.ts` picks a Mate's own token
   * out of this. The platform answers the whole list: `limit` and `offset`
   * are ignored (measured 2026-10-03).
   */
  async listIntegrationTokens(
    clientId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsIntegrationToken>> {
    const body = await this.#request<{ readonly list?: ReadonlyArray<ZeropsIntegrationToken> }>(
      `/client/${clientId}/integration-token/list`,
      { signal: signal ?? null },
    );
    return body.list ?? [];
  }

  /**
   * `GET /client/{id}/integration-token/{tokenId}` — one token, with the project grants it
   * carries, in the shape the list gives each (HQ and the Mate's door read a token this way): one
   * small answer where the list is every token on the account, whole. `undefined` once the token
   * is gone.
   */
  async readIntegrationToken(
    clientId: string,
    tokenId: string,
    signal?: AbortSignal,
  ): Promise<ZeropsIntegrationToken | undefined> {
    try {
      return await this.#request<ZeropsIntegrationToken>(
        `/client/${clientId}/integration-token/${tokenId}`,
        { signal: signal ?? null },
      );
    } catch (cause) {
      if (cause instanceof ZeropsApiError && cause.kind === "not-found") return undefined;
      throw cause;
    }
  }

  /**
   * `PUT /client/{id}/integration-token/{tokenId}` — rewrites what a token
   * reaches, in place.
   *
   * The token **string does not change**, so a container already holding it
   * gains or loses sight of a project immediately, with nothing written into
   * its environment and no restart (measured 2026-09-06: a read of a sibling
   * went 200 → 403 → 200 across two of these calls, on one unchanged token).
   * That is what lets a Mate's key be lowered where it runs.
   *
   * The whole body is sent because the platform replaces the record: omitting
   * a field is not "leave it alone", it is "set it to nothing".
   */
  async setIntegrationTokenProjects(
    input: {
      readonly clientId: string;
      readonly tokenId: string;
      readonly name: string;
      readonly projects: ReadonlyArray<ZeropsProjectGrant>;
      /**
       * The token's own org role, round-tripped. `PUT` replaces the record, so
       * omitting it would change the token's org role.
       */
      readonly roleCode?: string | undefined;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    await this.#request(
      `/client/${input.clientId}/integration-token/${input.tokenId}`,
      {
        method: "PUT",
        signal: signal ?? null,
        body: JSON.stringify({
          name: input.name,
          roleCode: input.roleCode ?? "NO_ACCESS",
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          projects: input.projects,
        }),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * HQ's append-only birth journal. The direct env file reflects writes before project search
   * (verified.md, 2026-10-02); expose only this plain metadata, never unrelated env values.
   */
  async readProjectBirthEnv(projectId: string): Promise<ReadonlyMap<string, string>> {
    const response = await this.#request<{ readonly envFile: string }>(
      `/project/${projectId}/env-file`,
      {},
      { operationKind: "read" },
    );
    const entries = new Map<string, string>();
    for (const line of response.envFile.split("\n")) {
      const match = /^(MATE_HQ_BIRTH_[A-Za-z0-9_]+)="((?:[^"\\]|\\.)*)"$/u.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) continue;
      const escapes: Readonly<Record<string, string>> = { n: "\n", r: "\r", t: "\t" };
      entries.set(
        match[1],
        match[2].replace(/\\(.)/gu, (_, char: string) => escapes[char] ?? char),
      );
    }
    return entries;
  }

  /**
   * A create-once slot: project env keys are unique case-insensitively. Never update or delete
   * a birth slot. The process id is retained by the journal; it is not an env entry id.
   */
  async createProjectEnv(
    projectId: string,
    key: string,
    content: string,
  ): Promise<{ readonly processId: string }> {
    const response = await this.#request<{ readonly id: string }>(
      `/project/${projectId}/env`,
      { method: "POST", body: JSON.stringify({ key, content, sensitive: false }) },
      { operationKind: "project-write" },
    );
    return { processId: response.id };
  }

  /**
   * `POST /project/search` for one project, for its `envList` alone.
   *
   * The only read that carries project variables **with their entry ids**, and
   * an id is what every update and delete needs — `POST /project/{pid}/env`
   * answers with a *process* id, not the entry's (measured 2026-09-16). The
   * index trails the write path, so this is re-read rather than remembered.
   */
  async readProjectEnv(
    clientId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ProjectEnvEntry>> {
    const response = await this.#request<{
      readonly items?: ReadonlyArray<{ readonly envList?: ReadonlyArray<ProjectEnvEntry> }>;
    }>(
      "/project/search",
      {
        method: "POST",
        signal: signal ?? null,
        body: JSON.stringify({
          limit: 1,
          // The organization scopes every project search: an id on its own is
          // `400 invalidUserInput` — "clientId not defined" — which failed the
          // isolation step of a second Mate's creation (measured 2026-09-18).
          search: [
            { name: "id", operator: "eq", value: projectId },
            { name: "clientId", operator: "eq", value: clientId },
          ],
        }),
      },
      { operationKind: "read" },
    );
    return response.items?.[0]?.envList ?? [];
  }

  /**
   * `GET /project/{id}/service-stack` — the project's own services.
   *
   * Answered under `list`, not the `items` the search endpoints use (measured
   * 2026-09-18): reading only `items` made every project look empty.
   */
  async listProjectServices(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsService>> {
    const response = await this.#request<{
      readonly list?: ReadonlyArray<ZeropsService>;
      readonly items?: ReadonlyArray<ZeropsService>;
    }>(
      `/project/${projectId}/service-stack?limit=500`,
      { signal: signal ?? null },
      { operationKind: "read" },
    );
    return response.list ?? response.items ?? [];
  }

  /**
   * Stops a Mate's project handing its container's key — and its agent's
   * login — to every container in it (`projectIsolation.ts`, guide 0.10).
   *
   * The decision is the pure planner's; this reads what it needs, walks the
   * plan, and re-reads the entry ids before the delete because that is the
   * only place they come from. Safe to call on a project that has already been
   * through it: the plan is then empty and nothing, restarts included, runs.
   *
   * Returns whether the plan it ran restarted anything — the project's
   * services that run its code, whose running processes still hold the
   * sibling variables they captured at start; never a managed service, and
   * never the Mate's own container, which needs no restart of its own
   * (server commit 7d544119b, `projectIsolation.ts`).
   */
  async isolateProjectEnvironment(
    clientId: string,
    projectId: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{ readonly restarted: boolean; readonly steps: number }> {
    const generation = this.#generation;
    const [envList, services] = await Promise.all([
      this.readProjectEnv(clientId, projectId, signal),
      this.listProjectServices(projectId, signal),
    ]);
    const own = services.filter((service) => service.isSystem !== true);
    const plan = planProjectIsolation({
      envList,
      services: own.map((service) => ({
        name: service.name,
        isControlPlane: isZcpService(service),
        managed: isManagedService(service),
      })),
    });
    // The read has not caught up with a project this new. Nothing is written
    // from a list that cannot be complete; the caller comes back. `uncertain`
    // is the conservative kind here — nothing was written at all, and the step
    // is idempotent, so a caller that re-reads loses nothing.
    if (!plan.ok)
      throw new ZeropsApiError(
        "This project's variables have not all appeared yet, so its isolation was left alone.",
        "uncertain",
      );
    const { steps } = plan;
    const restarted = steps.some((step) => step.kind === "restart-service");
    if (steps.length === 0) return { restarted: false, steps: 0 };

    const write = {
      operationKind: "project-write" as const,
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    };
    const serviceIdByName = new Map(own.map((service) => [service.name, service.id]));
    const valueOf = (entryId: string): string =>
      envList.find((entry) => entry.id === entryId)?.content ?? "";
    let fresh = envList;

    for (const step of steps) {
      this.#assertGeneration(generation);
      switch (step.kind) {
        case "update-project-env":
          // `key` beside `content`: a body carrying content alone is
          // `400 invalidUserInput` — "key: field is required" — even for the
          // project's owner (measured 2026-09-16).
          await this.#request(
            `/project-env/${step.entryId}`,
            {
              method: "PUT",
              signal: signal ?? null,
              body: JSON.stringify({ key: step.key, content: step.content }),
            },
            write,
          );
          break;
        case "move-key-to-service": {
          const serviceId = serviceIdByName.get(step.serviceName);
          if (serviceId === undefined) {
            throw new ZeropsApiError(
              `The container "${step.serviceName}" is no longer in this project.`,
              "uncertain",
            );
          }
          const content = valueOf(step.fromEntryId);
          await this.#writeServiceEnvOnce(
            { clientId, serviceId, key: step.key, content, sensitive: true },
            signal,
            beforeWrite,
          );
          break;
        }
        case "reread-project-env":
          fresh = await this.readProjectEnv(clientId, projectId, signal);
          break;
        case "delete-project-env": {
          const entry = fresh.find((candidate) => candidate.key === step.key);
          // Gone already — a half-finished earlier run, or someone else's
          // edit. Nothing to take back.
          if (entry === undefined) break;
          await this.#request(
            `/project-env/${entry.id}`,
            { method: "DELETE", signal: signal ?? null },
            write,
          );
          break;
        }
        case "restart-service": {
          const serviceId = serviceIdByName.get(step.serviceName);
          if (serviceId === undefined) break;
          await this.restartService(serviceId, signal, beforeWrite);
          break;
        }
      }
    }
    return { restarted, steps: steps.length };
  }

  /**
   * The birth's hardening (spec-mate §3 B-1/B-2/B-3), whole: the token half
   * and the isolation half, together, for one Mate's own project.
   *
   * The token half sets the Mate's key to its own project alone at `BASIC_USER` (`planMateKey`):
   * the key HQ holds by id loses any other grant; a key found by its name is the Mate's only while
   * it holds nothing else, and is left as it is otherwise. Every delegation the token carries is
   * then dropped: the one-time mint the platform grants at creation, which nothing here needs
   * (`groupReach.ts`, guide 0.4).
   *
   * Idempotent, and cheap to prove so: a token already at `BASIC_USER` with
   * no wider grant plans nothing, a token with no delegations lists an empty
   * page, and `isolateProjectEnvironment` is already idempotent on its own.
   * A hardened Mate re-run through this makes no writes at all.
   *
   * `read-incomplete` from the isolation half is not caught here: it is the
   * same "the read has not caught up yet, come back" signal the caller
   * already knows from `isolateProjectEnvironment` alone, and swallowing it
   * here would hide a retryable wait behind a token/delegation write that
   * already succeeded.
   */
  async hardenMate(
    clientId: string,
    projectId: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
    /**
     * The id of the key the Mate's container holds, as the Mate named it to HQ: that key alone is
     * hardened, and the organization's token list is neither read nor matched (audit K3).
     */
    keyTokenId?: string,
  ): Promise<{
    readonly tokenLowered: boolean;
    /** Why a key of the Mate's could not be lowered — the platform refused this account the write. */
    readonly keyNotLowered: string | null;
    readonly delegationsDropped: number;
    readonly isolationSteps: number;
    readonly restarted: boolean;
  }> {
    const generation = this.#generation;
    let tokenLowered = false;
    let keyNotLowered: string | null = null;
    let delegationsDropped = 0;

    const foundBy = keyTokenId === undefined ? "name" : "id";
    const keys =
      keyTokenId === undefined ? await this.#mateKeys(clientId, projectId, signal) : [keyTokenId];
    for (const tokenId of keys) {
      // A key this account may not write — an org admin's adoption of a Mate whose key an owner
      // made — is said and left as it is: the rest of the harden still runs.
      try {
        await this.#hardenKey(
          clientId,
          projectId,
          tokenId,
          foundBy,
          generation,
          signal,
          beforeWrite,
          {
            lowered: () => {
              tokenLowered = true;
            },
            dropped: () => {
              delegationsDropped += 1;
            },
          },
        );
      } catch (cause) {
        if (!(cause instanceof ZeropsApiError) || cause.kind !== "forbidden") throw cause;
        keyNotLowered ??= cause.message;
      }
    }

    this.#assertGeneration(generation);
    const isolation = await this.isolateProjectEnvironment(
      clientId,
      projectId,
      signal,
      beforeWrite,
    );

    return {
      tokenLowered,
      keyNotLowered,
      delegationsDropped,
      isolationSteps: isolation.steps,
      restarted: isolation.restarted,
    };
  }

  /**
   * The keys of a Mate HQ knows no key id of, matched on the organization's token list: the one its
   * container holds — where two are its, the newest made before the container — and every other
   * still ADMIN on its project, a raced press's or an older platform key.
   */
  async #mateKeys(
    clientId: string,
    projectId: string,
    signal: AbortSignal | undefined,
  ): Promise<ReadonlyArray<string>> {
    const container = (await this.listProjectServices(projectId, signal)).find(isZcpService);
    const tokens = await this.listIntegrationTokens(clientId, signal);
    const token = findHeldMateKey(tokens, projectId, container?.created);
    return [
      ...new Set([
        ...(token === undefined ? [] : [token.id]),
        ...mateAdminKeys(tokens, projectId, container?.created).map((key) => key.id),
      ]),
    ];
  }

  /**
   * One key of a Mate set to its own project alone, and its delegations dropped; a key found by its
   * name that is not the Mate's as read is left as it is, delegations and all.
   */
  async #hardenKey(
    clientId: string,
    projectId: string,
    tokenId: string,
    foundBy: "id" | "name",
    generation: number,
    signal: AbortSignal | undefined,
    beforeWrite: (() => Promise<void>) | undefined,
    told: { readonly lowered: () => void; readonly dropped: () => void },
  ): Promise<void> {
    this.#assertGeneration(generation);
    // The write replaces the token's whole project list: it is planned from the token as read
    // by its id under its lock — one small answer, never the organization's whole list again.
    const plan = await this.#holdToken(tokenId, async () => {
      const current = await this.readIntegrationToken(clientId, tokenId, signal);
      if (current === undefined) return undefined;
      this.#assertGeneration(generation);
      const planned = planMateKey({ token: current, selfProjectId: projectId, foundBy });
      if (planned.kind !== "write") return planned;
      await this.setIntegrationTokenProjects(
        { clientId, tokenId: current.id, name: current.name, projects: planned.projects },
        signal,
        beforeWrite,
      );
      return planned;
    });
    if (plan?.kind === "not-its-key") return;
    if (plan?.kind === "write") told.lowered();

    this.#assertGeneration(generation);
    const delegations = await this.listIntegrationTokenDelegations({ clientId, tokenId }, signal);
    for (const delegation of delegations) {
      this.#assertGeneration(generation);
      await this.deleteIntegrationTokenDelegation(
        { clientId, tokenId, delegationId: delegation.id },
        signal,
        beforeWrite,
      );
      told.dropped();
    }
  }

  /**
   * The names of a service's own variables — never a value: whether a
   * variable the app wrote is there, as HQ's birth reads its own token's
   * (`hq/birth.ts`).
   */
  async listServiceVariableNames(
    serviceId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<string>> {
    return (await this.#serviceEnv(serviceId, signal)).map((entry) => entry.key);
  }

  /**
   * Whether a service holds the variable `key` — its presence, never its value or any other
   * variable: one key searched (`POST /user-data/search`); a sensitive value answers `REDACTED`.
   */
  async hasServiceVariable(
    input: { readonly clientId: string; readonly serviceId: string; readonly key: string },
    signal?: AbortSignal,
  ): Promise<boolean> {
    const found = await this.#request<{ readonly items?: ReadonlyArray<unknown> }>(
      "/user-data/search",
      {
        method: "POST",
        signal: signal ?? null,
        body: JSON.stringify({
          search: [
            { name: "clientId", operator: "eq", value: input.clientId },
            { name: "serviceStackId", operator: "eq", value: input.serviceId },
            { name: "key", operator: "eq", value: input.key },
          ],
          sort: [],
          limit: 1,
        }),
      },
    );
    return (found.items ?? []).length > 0;
  }

  /** `POST /service-stack/{id}/user-data` — one sensitive variable on a service, written once. */
  async writeServiceSecret(
    input: {
      readonly clientId: string;
      readonly serviceId: string;
      readonly key: string;
      readonly content: string;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    await this.#writeServiceEnvOnce({ ...input, sensitive: true }, signal, beforeWrite);
  }

  /**
   * `POST /service-stack/{id}/user-data`.
   *
   * A create the platform refuses is checked rather than swallowed: the only
   * way the key is already there is a run of this that moved it and then
   * failed before deleting the project entry, and in that case the move is
   * done. Anything else still throws, because losing the key silently would
   * leave a Mate that cannot reach the platform at all. The check reads that
   * one key (`POST /user-data/search`), never the service's every variable;
   * its value, sensitive, answers `REDACTED`, so the key's presence is the
   * answer.
   */
  async #writeServiceEnvOnce(
    input: {
      readonly clientId: string;
      readonly serviceId: string;
      readonly key: string;
      readonly content: string;
      readonly sensitive: boolean;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.#request(
        `/service-stack/${input.serviceId}/user-data`,
        {
          method: "POST",
          signal: signal ?? null,
          body: JSON.stringify({
            key: input.key,
            content: input.content,
            sensitive: input.sensitive,
          }),
        },
        {
          operationKind: "project-write",
          ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
        },
      );
    } catch (cause) {
      const found = await this.#request<{ readonly items?: ReadonlyArray<unknown> }>(
        "/user-data/search",
        {
          method: "POST",
          signal: signal ?? null,
          body: JSON.stringify({
            search: [
              { name: "clientId", operator: "eq", value: input.clientId },
              { name: "serviceStackId", operator: "eq", value: input.serviceId },
              { name: "key", operator: "eq", value: input.key },
            ],
            sort: [],
            limit: 1,
          }),
        },
      );
      if ((found.items ?? []).length === 0) throw cause;
    }
  }

  /**
   * `GET /client/{id}/integration-token/{tokenId}/delegation` — the one-time
   * mint permissions attached to a token.
   *
   * A person's call, not a token's: an integration token reading or deleting
   * a delegation is refused (`notAllowedForIntegrationToken`, measured
   * 2026-09-15), which is why this runs from the app with the owner's session
   * and never inside a Mate.
   *
   * The body is `{ list: [...] }` — the same hand-rolled shape zcp decodes
   * (`internal/platform/zerops_delegation.go`); the SDK does not cover it.
   */
  async listIntegrationTokenDelegations(
    input: { readonly clientId: string; readonly tokenId: string },
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsTokenDelegation>> {
    const body = await this.#request<{ readonly list?: ReadonlyArray<ZeropsTokenDelegation> }>(
      `/client/${input.clientId}/integration-token/${input.tokenId}/delegation`,
      { signal: signal ?? null },
    );
    return body.list ?? [];
  }

  /**
   * `DELETE /client/{id}/integration-token/{tokenId}/delegation/{delegationId}`
   * — takes back the one-time mint a Mate never asked for.
   */
  async deleteIntegrationTokenDelegation(
    input: {
      readonly clientId: string;
      readonly tokenId: string;
      readonly delegationId: string;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    await this.#request(
      `/client/${input.clientId}/integration-token/${input.tokenId}/delegation/${input.delegationId}`,
      { method: "DELETE", signal: signal ?? null },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * `PUT /service-stack/{id}/restart` with the user's own token. On a zcp
   * container a restart re-runs the platform recipe's install step, which
   * picks up the current zcp release. Answers the restart's process id.
   */
  async restartService(
    serviceId: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{ readonly processId: string | undefined }> {
    const process = await this.#request<{ readonly id?: unknown }>(
      `/service-stack/${serviceId}/restart`,
      { method: "PUT", signal: signal ?? null },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
    return { processId: typeof process?.id === "string" ? process.id : undefined };
  }

  /**
   * `PUT /service-stack/{id}/stop` with the user's own token — the first half
   * of bringing a FAILED service back: the platform refuses to restart one
   * (`serviceStackIsFailed`, "Try to stop the stack and then start it again";
   * three Mates after a platform outage, 2026-10-01). Answers the stop's
   * process id, which the caller waits on before the start.
   */
  async stopService(serviceId: string): Promise<{ readonly processId: string | undefined }> {
    const process = await this.#request<{ readonly id?: unknown }>(
      `/service-stack/${serviceId}/stop`,
      { method: "PUT" },
      { operationKind: "project-write" },
    );
    return { processId: typeof process?.id === "string" ? process.id : undefined };
  }

  /**
   * `GET /project/{id}/public-http-routing` — the project's routings of its own domains, each
   * domain with its certificate's state (`sslStatus`: `WAITING_FOR_DNS`, `ACTIVE`, …).
   */
  async listPublicHttpRoutings(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsPublicHttpRouting>> {
    const response = await this.#request<{
      readonly list?: ReadonlyArray<unknown>;
      readonly items?: ReadonlyArray<unknown>;
    }>(
      `/project/${projectId}/public-http-routing`,
      { signal: signal ?? null },
      {
        operationKind: "read",
      },
    );
    return publicHttpRoutingsOf(response.list ?? response.items ?? []);
  }

  /**
   * `POST /project/{id}/public-http-routing` — routes the domains to the locations, with SSL. It
   * serves nothing until the project's routings are synced (`syncPublicHttpRouting`).
   */
  async createPublicHttpRouting(
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
  ): Promise<void> {
    await this.#request(
      `/project/${projectId}/public-http-routing`,
      {
        method: "POST",
        signal: signal ?? null,
        body: JSON.stringify({ sslEnabled: true, ...routing }),
      },
      { operationKind: "project-write" },
    );
  }

  /** `PUT /project/{id}/sync-public-http-routing` — puts the project's routings in place: a process. */
  async syncPublicHttpRouting(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<{ readonly processId: string | undefined }> {
    const process = await this.#request<{ readonly id?: unknown }>(
      `/project/${projectId}/sync-public-http-routing`,
      { method: "PUT", signal: signal ?? null },
      { operationKind: "project-write" },
    );
    return { processId: typeof process?.id === "string" ? process.id : undefined };
  }

  /**
   * `GET /project/{id}/process` — the project's newest twenty processes, each with its app version
   * and why it failed: what HQ's update reads of its `hq` service's deploys (`hq/update.ts`).
   */
  async listProjectProcesses(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ActivityProcess>> {
    const document = await this.#request<unknown>(
      `/project/${projectId}/process?limit=20`,
      { signal: signal ?? null },
      { operationKind: "read" },
    );
    const processes = readProjectProcesses(document);
    if (processes === undefined) {
      throw new ZeropsApiError(
        "Zerops answered the project's processes in an unknown shape.",
        "unexpected",
      );
    }
    return processes;
  }

  /**
   * `PUT /service-stack/{id}/start` with the user's own token — starts a
   * STOPPED service (a zcp container included). Answers the start's process id.
   */
  async startService(serviceId: string): Promise<{ readonly processId: string | undefined }> {
    const process = await this.#request<{ readonly id?: unknown }>(
      `/service-stack/${serviceId}/start`,
      { method: "PUT" },
      { operationKind: "project-write" },
    );
    return { processId: typeof process?.id === "string" ? process.id : undefined };
  }

  /**
   * `PUT /project/{id}/start` with the user's own token — starts every
   * STOPPED service in a STOPPED project.
   */
  async startProject(projectId: string): Promise<void> {
    await this.#request(
      `/project/${projectId}/start`,
      { method: "PUT" },
      { operationKind: "project-write" },
    );
  }

  /** `GET /service-stack/{id}/env` — the service's own env records. */
  async #serviceEnv(
    serviceId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsServiceEnvVar>> {
    const body = await this.#request<{ readonly items?: ReadonlyArray<ZeropsServiceEnvVar> }>(
      `/service-stack/${serviceId}/env`,
      { signal: signal ?? null },
    );
    return body.items ?? [];
  }

  /**
   * `POST /service-stack/{id}/app-version` — the first of the three calls a deploy through the API
   * is (then {@link uploadAppVersionArchive} and {@link buildAndDeployAppVersion}). A version exists
   * whether or not its answer arrives, so a lost answer is `uncertain`.
   */
  async createAppVersion(
    serviceId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<{ readonly id: string }> {
    const response = await this.#request<{ readonly id?: string }>(
      `/service-stack/${serviceId}/app-version`,
      { method: "POST", signal: signal ?? null, body: JSON.stringify({ name }) },
      { operationKind: "project-write" },
    );
    if (!response.id) {
      throw new ZeropsApiError(
        "Zerops accepted the app version but did not return its id, so it cannot be deployed.",
        "uncertain",
      );
    }
    return { id: response.id };
  }

  /** `PUT /app-version/{id}/upload` — the code's `tar.gz`, as raw bytes; it answers no body. */
  async uploadAppVersionArchive(
    appVersionId: string,
    archive: Uint8Array<ArrayBuffer>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#request(
      `/app-version/${appVersionId}/upload`,
      {
        method: "PUT",
        signal: signal ?? AbortSignal.timeout(APP_VERSION_UPLOAD_TIMEOUT_MS),
        headers: { "Content-Type": "application/octet-stream" },
        body: archive,
      },
      { operationKind: "project-write", ignoreAnswer: true },
    );
  }

  /**
   * `PUT /app-version/{id}/build-and-deploy` — builds the uploaded code with `zeropsYaml`'s
   * `setup` entry and deploys it; the answer is the process that does so.
   */
  async buildAndDeployAppVersion(
    appVersionId: string,
    input: { readonly zeropsYaml: string; readonly setup: string },
    signal?: AbortSignal,
  ): Promise<{ readonly processId: string }> {
    const response = await this.#request<{ readonly id?: string }>(
      `/app-version/${appVersionId}/build-and-deploy`,
      {
        method: "PUT",
        signal: signal ?? null,
        body: JSON.stringify({ zeropsYaml: input.zeropsYaml, zeropsYamlSetup: input.setup }),
      },
      { operationKind: "project-write" },
    );
    if (!response.id) {
      throw new ZeropsApiError(
        "Zerops accepted the deploy but did not return its process, so it cannot be followed.",
        "uncertain",
      );
    }
    return { processId: response.id };
  }

  /**
   * `PUT /service-stack/{id}/enable-subdomain-access` — publish a service on
   * its `*.zerops.app` subdomain.
   *
   * A separate call rather than an import field because the import field does
   * not apply to a service created without code: a production environment
   * cloned from dev comes up unpublished whatever its recipe said, and answers
   * 502 after its first deploy until this runs (`verified.md`, 2026-09-07).
   */
  async enableSubdomainAccess(serviceId: string): Promise<void> {
    await this.#request(
      `/service-stack/${serviceId}/enable-subdomain-access`,
      { method: "PUT" },
      { operationKind: "project-write" },
    );
  }

  /** `POST /service-stack/{id}/user-data` — writes the Zerops Mate flag as on. */
  async #createMateFlag(serviceId: string): Promise<void> {
    await this.#request(
      `/service-stack/${serviceId}/user-data`,
      {
        method: "POST",
        // `sensitive` is required on every service userData write — the
        // platform rejects a body without it as "field is required".
        body: JSON.stringify({ key: ZEROPS_MATE_ENV_KEY, content: "1", sensitive: true }),
      },
      { operationKind: "project-write" },
    );
  }

  /**
   * Writes the Zerops Mate flag on for a container that is not serving it. Its restart is the
   * caller's next write: a service env change reaches a container's process environment only at
   * boot, which is the same boot `zcp init` reads it on.
   *
   * `ZCP_MATE_ENABLED` is the one input zcp keys every mate-shaped effect off — without it `zcp
   * init` does not register the mate step at all, so no bundle is installed, no `zerops@mate`
   * unit is created and nginx publishes no `/mate/` location.
   *
   * The write is an upsert done as delete-then-create, because the platform
   * exposes create and delete for a single key and no update. The bulk
   * env-file PUT is deliberately not used: it replaces the entire file and
   * silently drops every other var the user set.
   *
   * A flag that already reads as on is left completely alone — not rewritten
   * to the same value. That is what makes this safe to offer for a container
   * that is merely away (from a browser the two are indistinguishable): a
   * yaml-baked key cannot be deleted at all, so a needless delete-then-create
   * would turn a working container into an error.
   *
   * The create can race the platform's own read path, so it is followed by
   * one read-back; a miss there gets exactly one more create attempt, never
   * an unbounded retry loop.
   */
  async writeMateFlag(serviceId: string): Promise<void> {
    const generation = this.#generation;
    const current = (await this.#serviceEnv(serviceId)).find(
      (entry) => entry.key === ZEROPS_MATE_ENV_KEY,
    );
    if (current !== undefined && readsAsEnabled(current.content)) return;
    if (current) {
      this.#assertGeneration(generation);
      await this.#request(
        `/user-data/${current.id}`,
        { method: "DELETE" },
        { operationKind: "project-write" },
      );
    }
    this.#assertGeneration(generation);
    await this.#createMateFlag(serviceId);

    const after = (await this.#serviceEnv(serviceId)).find(
      (entry) => entry.key === ZEROPS_MATE_ENV_KEY,
    );
    if (!after || !readsAsEnabled(after.content)) {
      this.#assertGeneration(generation);
      await this.#createMateFlag(serviceId);
    }
  }

  async #setSession(session: ZeropsSession | null): Promise<void> {
    if (session === null) this.#nextGeneration();
    this.#session = session;
    await this.#onSessionChange(session);
  }

  /**
   * `clearOnFailure` governs only what happens when the refresh itself fails
   * (no refresh token, the refresh call rejected, an unusable refreshed
   * session) — a SUCCESSFUL refresh always adopts the new session regardless.
   *
   * Concurrent callers SHARE one in-flight refresh, and its outcome is an OR
   * across every caller that joined it: if the background poller starts the
   * refresh with `false` and a user-initiated request piggybacks with `true`
   * before it settles, a failure still clears the session — the user-facing
   * caller's stricter preference wins, whichever caller happened to start
   * the request. Only when EVERY joiner opted out does a failure leave the
   * (now-dead) session in place for the poller alone to observe as a 401.
   */
  async #refreshSession(clearOnFailure = true): Promise<ZeropsSession> {
    if (this.#refreshPromise) {
      this.#refreshClearOnFailure ||= clearOnFailure;
      return this.#refreshPromise;
    }
    const generation = this.#generation;
    const current = this.#session;
    if (!current?.refreshToken) {
      if (clearOnFailure) await this.#setSession(null);
      throw new ZeropsApiError(
        "Your Zerops session has expired. Sign in again.",
        "expired-session",
        401,
      );
    }

    this.#refreshClearOnFailure = clearOnFailure;
    const refresh = async () => {
      const response = await this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${current.accessToken}`,
        },
        body: JSON.stringify({ refreshTokenId: current.refreshToken }),
      });
      this.#assertGeneration(generation);
      if (!response.ok) {
        const error = await apiErrorFromResponse(response);
        this.#assertGeneration(generation);
        if (error.kind === "expired-session" && this.#refreshClearOnFailure) {
          await this.#setSession(null);
        }
        throw error;
      }
      // `/auth/refresh` answers with the session fields at the top level, not
      // wrapped in `auth` the way `/auth/login` does.
      const session = (await response.json()) as ZeropsSession;
      this.#assertGeneration(generation);
      if (!isUsableZeropsSession(session)) {
        if (this.#refreshClearOnFailure) await this.#setSession(null);
        throw new ZeropsApiError(
          "Zerops returned an invalid refreshed session.",
          "expired-session",
          401,
        );
      }
      await this.#setSession(session);
      return session;
    };
    this.#refreshPromise = (async () => {
      const renewed = await this.#renewSession(current, refresh);
      this.#assertGeneration(generation);
      if (renewed !== this.#session) this.adoptRenewedSession(renewed);
      return renewed;
    })().finally(() => {
      this.#refreshPromise = null;
      this.#refreshClearOnFailure = true;
    });

    return this.#refreshPromise;
  }

  async #request<T = unknown>(
    path: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const method = init.method ?? "GET";
    const operationKind = options.operationKind ?? (method === "GET" ? "read" : "project-write");
    const mutatesProject = operationKind === "project-write";
    const mayHaveWritten = options.mayHaveWritten ?? mutatesProject;
    const generation = this.#generation;
    const authenticated = options.authenticated ?? true;
    const retryAfterRefresh = options.retryAfterRefresh ?? true;
    const clearSessionOnUnauthorized = options.clearSessionOnUnauthorized ?? true;

    /** A refusal before anything was sent reaches the caller as one: never as maybe written. */
    let refusedBeforeSending = false;
    const run = async () => {
      if (mutatesProject) {
        try {
          if (this.#writeAdmission !== null) {
            await waitForPromiseOrAbort(this.#writeAdmission.beforeProjectWrite(), init.signal);
          }
          await options.beforeProjectWrite?.();
        } catch (cause) {
          refusedBeforeSending = true;
          // The caller's own giving up stays an abort; anything else is the admission's refusal.
          if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
          throw new ZeropsWriteNotSent(cause);
        }
        // An admission can wait, and whoever holds the session once it
        // resolves is not necessarily who asked for the write.
        this.#assertGeneration(generation);
      }
      const session = this.#session;
      if (authenticated && session) options.sentWith?.(session.accessToken);
      return this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
          ...(authenticated && session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        },
      });
    };

    let response: Response;
    try {
      response = await run();
      this.#assertGeneration(generation);
      if (response.status === 401 && retryAfterRefresh) {
        const session = this.#session;
        if (session?.refreshToken) {
          await waitForPromiseOrAbort(
            this.#refreshSession(clearSessionOnUnauthorized),
            init.signal,
          );
          response = await run();
          this.#assertGeneration(generation);
        }
        if (response.status === 401 && clearSessionOnUnauthorized) await this.#setSession(null);
      }
    } catch (cause) {
      if (cause instanceof ZeropsApiError || refusedBeforeSending) throw cause;
      if (mayHaveWritten)
        throw new ZeropsApiError(
          "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.",
          "uncertain",
        );
      throw new ZeropsApiError(
        cause instanceof Error
          ? `Network error contacting Zerops: ${cause.message}`
          : "Network error contacting Zerops.",
        "network",
      );
    }

    if (!response.ok) {
      const error = await apiErrorFromResponse(response);
      if (mutatesProject && response.status >= 500)
        throw new ZeropsApiError(
          "Zerops could not confirm whether this operation finished. Check the project before trying again.",
          "uncertain",
          response.status,
        );
      throw error;
    }
    if (response.status === 204 || options.ignoreAnswer === true) return undefined as T;
    const result = (await response.json()) as T;
    this.#assertGeneration(generation);
    return result;
  }
}
