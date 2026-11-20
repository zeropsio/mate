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

import {
  ZeropsApiError,
  ZeropsWriteNotSent,
  ZeropsTargetWriteRefused,
  type ZeropsApiErrorKind,
} from "./errors.ts";
import type {
  ZeropsOrganization,
  ZeropsOrganizationInvitation,
  ZeropsUser,
} from "./api/account.ts";
import type { ZeropsProject } from "./api/project.ts";
import type { ZeropsService, ZeropsServiceImportResult } from "./api/service.ts";
import { admitContainer, setServiceVariable, type ZeropsServiceEnvVar } from "./api/variables.ts";
import {
  deleteIntegrationToken,
  deleteIntegrationTokenDelegation,
  listIntegrationTokenDelegations,
  listIntegrationTokens,
  mintIntegrationToken,
  readIntegrationToken,
  regenerateIntegrationToken,
  setIntegrationTokenProjects,
} from "./api/integrationTokens.ts";
import { isZcpService, mateContainerOf, severalMatesLine } from "./containerAddress.ts";
import { creationUserRoles, withProjectGrant, type ProjectGrant } from "./projectAccess.ts";
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
import type { ZeropsIntegrationToken, ZeropsProjectGrant } from "./groupReach.ts";
import {
  buildCreateProjectBody,
  buildZcpDeploymentYaml,
  buildZcpServiceImportYaml,
  generateVscodePassword,
  nextZcpServiceName,
  type MateBirthplace,
  type ZeropsAgentType,
  type ZeropsCorePackage,
} from "./newProject.ts";
import { mateBirthImportYaml } from "./recipeTier.ts";
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

/** The person's Zerops access token and, when the platform gave one, its expiry (ISO). */
export interface ZeropsAccess {
  readonly token: string;
  readonly expiresAt?: string;
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

/** The container's own Zerops key, as zcp and a Mate's server read it (spec-mate §3.3). */
const ZCP_API_KEY = "ZCP_API_KEY";

/**
 * The service env key zcp keys every mate-shaped effect off. Nothing about
 * Zerops Mate happens in a container without it: no bundle, no unit, no
 * `/mate/` location. Spelled here once because it is a contract with zcp, not
 * a value this client is free to choose.
 */
const ZEROPS_MATE_ENV_KEY = "ZCP_MATE_ENABLED";

/**
 * The only tags a project is born with: the Mate marker, and a Chief's (`apps/web/src/zerops/
 * chief.ts`). Its application's place is HQ's, never a tag.
 */
const BORN_TAGS: ReadonlyArray<string> = ["mate", "chief"];

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

interface ZeropsLoginResponse {
  readonly auth: ZeropsSession;
  /** Null while a second factor is still outstanding. */
  readonly user: ZeropsUser | null;
}

/** The longest a `Retry-After` holds a read: a header asking for a day is read as ten minutes. */
const RETRY_AFTER_CAP_MS = 10 * 60_000;

/**
 * A `Retry-After` header as milliseconds from `nowMs`: delta seconds or an HTTP date; `null` when
 * absent or unreadable, never negative and never past `RETRY_AFTER_CAP_MS`.
 */
function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Math.min(RETRY_AFTER_CAP_MS, Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.min(RETRY_AFTER_CAP_MS, Math.max(0, at - nowMs));
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

/**
 * Every organization whose invitation the account has not accepted yet: a `clientUserList` row
 * in `WAITING_AUTHORIZATION` (measured on test-ro's KRLS row, 2026-11-08). The row carries no
 * accept token. Only the invitation email has one (`PUT /user/authorize-client`), so Mate can
 * show the invitation but cannot accept it.
 */
export function zeropsInvitationsFromUser(
  user: ZeropsUser,
): ReadonlyArray<ZeropsOrganizationInvitation> {
  const joined = new Set(zeropsClientsFromUser(user).map((organization) => organization.id));
  const seen = new Set<string>();
  const invitations: ZeropsOrganizationInvitation[] = [];
  for (const membership of user.clientUserList ?? []) {
    if (membership.status !== "WAITING_AUTHORIZATION") continue;
    const id = membership.clientId ?? membership.client?.id ?? "";
    if (!id || joined.has(id) || seen.has(id)) continue;
    seen.add(id);
    invitations.push({
      id,
      name: membership.client?.accountName ?? membership.client?.companyName ?? "Organization",
    });
  }
  return invitations;
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

function errorKindFor(status: number, code: string | null): ZeropsApiErrorKind {
  if (status === 401) return "expired-session";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 400) {
    // A refresh token already spent or revoked: the session is over, whatever the status says.
    if (code === "refreshTokenInvalid") return "expired-session";
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
   * Renews the held session before a request once it expires within `withinMs` of `nowMs()`
   * (wall-clock milliseconds), so no request carries a token that renewal is about to revoke.
   * Without it, a session renews only after a request is refused.
   */
  readonly renewAhead?: { readonly withinMs: number; readonly nowMs: () => number };
  /**
   * Holds one integration token's read-then-write at a time (`mate:token:{id}`), shared with
   * every other writer of the account's tokens in this browser. Without it, this client's own
   * writes queue per token in memory.
   */
  readonly holdToken?: TokenWriteHold;
  /**
   * The session belongs to another party that keeps its refresh token (hq's session bridge). A
   * renewal hands it the refused session and holds what it answers; `null` says the session ended.
   * A `ZeropsApiError` it throws refuses the renewal and keeps the session.
   */
  readonly sessionOwner?: ZeropsSessionOwnerPort;
}

/** The party that renews a session this client holds only the access token of. */
export interface ZeropsSessionOwnerPort {
  readonly renew: (stale: ZeropsSession) => Promise<ZeropsSession | null>;
}

interface ZeropsDataHttpRequest {
  readonly path: string;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly operationKind: "read" | "project-write";
  readonly signal: AbortSignal;
  readonly beforeWrite?: () => Promise<void>;
  /**
   * Background data failures stay scoped: a background read's own 401 never signs the account
   * out, while a refresh the platform refuses still ends the session.
   */
  readonly background: boolean;
}

export interface RequestOptions {
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
   * Whether a 401 that survives a refresh attempt signs the account out via
   * `onSessionChange(null)`. Defaults to `true` for every ordinary call — an
   * expired session should sign a person out of the UI they are looking at.
   * `false` is for a background reader whose own 401 is not evidence the
   * account's session is gone (a poll that only proves that ONE endpoint
   * refused THIS request): it still surfaces the 401 as a thrown
   * `ZeropsApiError`, it just never clears the held session for that 401
   * alone. A refresh the platform refuses is that evidence: it ends the
   * session whichever way this is set.
   */
  readonly clearSessionOnUnauthorized?: boolean;
  /**
   * Whether a request lost in transport may still have been carried out, so
   * its failure is `uncertain` rather than `network`. Defaults to whether it
   * writes a project.
   */
  readonly mayHaveWritten?: boolean;
  /** The answer carries no JSON (an upload's empty body): it is not read. */
  readonly ignoreAnswer?: boolean;
}

export type ZeropsDoor = <T = unknown>(
  path: string,
  init?: RequestInit,
  options?: RequestOptions,
) => Promise<T>;

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

interface ListProjectsOptions {
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
  readonly #baseUrl: string;
  readonly #fetch: FetchImplementation;
  readonly #onSessionChange: (session: ZeropsSession | null) => Promise<void> | void;
  readonly #renewSession: NonNullable<ZeropsApiClientOptions["renewSession"]>;
  readonly #renewAhead: ZeropsApiClientOptions["renewAhead"];
  /** The session whose renewal ahead failed: it stays in use, and renews only once refused. */
  #renewAheadFailed: ZeropsSession | null = null;
  #session: ZeropsSession | null = null;
  #generation = 0;
  #refreshPromise: Promise<ZeropsSession> | null = null;
  readonly #sessionOwner: ZeropsSessionOwnerPort | undefined;

  constructor(options: ZeropsApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_ZEROPS_API_BASE).replace(/\/+$/, "");
    // Bound to globalThis on purpose: the browser's `fetch` is brand-checked
    // against Window, so storing the bare function and calling it as
    // `this.#fetch(...)` throws "Illegal invocation".
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onSessionChange = options.onSessionChange ?? (() => undefined);
    this.#renewSession = options.renewSession ?? ((_stale, refresh) => refresh());
    this.#renewAhead = options.renewAhead;
    this.#holdToken = options.holdToken ?? makeTokenWriteLock();
    this.#sessionOwner = options.sessionOwner;
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

  readonly door: ZeropsDoor = this.#request.bind(this);

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
    await this.#refreshSession();
  }

  /**
   * The held session's access token and its expiry, for the one call that hands them to HQ's
   * sign-in, once no renewal stands in front of it. `refused`, a token HQ refused, renews the
   * session first, as a request does after a 401, unless a renewal has already replaced it. A
   * personal token from the hand-over has no expiry.
   */
  async accessToken(refused?: string): Promise<ZeropsAccess> {
    const current = await this.#currentSession(null);
    const held =
      current !== null && current.accessToken === refused ? await this.#refreshSession() : current;
    if (held === null) throw new ZeropsApiError("Sign in to Zerops again.", "expired-session", 401);
    return held.expiresAt === undefined
      ? { token: held.accessToken }
      : { token: held.accessToken, expiresAt: held.expiresAt };
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
   * Adopts a session minted elsewhere: the full session a device login
   * collects (`zerops/deviceLogin.ts`), the bearer the sign-in hand-over
   * delivers (`zerops/handover.ts`), with no refresh token, or — dev builds
   * only — a full `/auth/login` session an agent injects.
   *
   * It is **proven before it is stored**: a dead token that reached storage
   * would render a signed-in-looking UI that fails on its first real call. So
   * it is held in memory, spent on one read, and only persisted once that read
   * comes back. Without a refresh token, a later 401 clears the session
   * instead of trying to refresh it. One that still owes a second factor is
   * refused: an approval never answers one.
   */
  async adoptSession(input: ZeropsSession): Promise<ZeropsSession> {
    const accessToken = input.accessToken.trim();
    if (!accessToken || requiresZeropsTwoFactor(input)) {
      throw new ZeropsApiError(
        "That Zerops sign-in carried no credential. Start again.",
        "invalid-input",
      );
    }
    const refreshToken = input.refreshToken?.trim();
    const session: ZeropsSession = {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.expiresIn === undefined ? {} : { expiresIn: input.expiresIn }),
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.tokenType === undefined ? {} : { tokenType: input.tokenType }),
    };
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

  /**
   * Ends `session` at the platform, after it was already forgotten here. One the
   * platform already refused (its access token expired) is first swapped, with
   * its own refresh token, for a pair this revoke alone uses. Never fails: the
   * person is signed out here whatever the platform answers. A personal token
   * (no refresh token) cannot revoke itself, so nothing is sent for one.
   */
  async revokeSession(session: ZeropsSession): Promise<void> {
    if (session.refreshToken === undefined) return;
    const logout = (accessToken: string) =>
      this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
    try {
      const first = await logout(session.accessToken);
      if (first.status !== 401) return;
      const renewed = await this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshTokenId: session.refreshToken }),
      });
      if (!renewed.ok) return;
      const fresh: unknown = await renewed.json();
      if (isZeropsSession(fresh)) await logout(fresh.accessToken);
    } catch {
      // Offline, or the platform failing: the session lapses on its own.
    }
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
   * 2026-10-03 as the Example Org Developer: Cyd's row named their `OWNER` alone, its
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
   * (`data/operations/executors/projectTags.ts`), with a record it just read and changed.
   *
   * `project` is the read the record came from: the platform replaces the
   * record, so the fields the write must not change are round-tripped from it
   * (`projectWriteBody`), and `userRoles` is never sent.
   */
  async writeProject(
    project: ZeropsProject,
    record: { readonly name: string; readonly tagList: ReadonlyArray<string> },
    beforeWrite?: () => Promise<void>,
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
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * `PUT /project/{id}` with `userRoles` — a project's people, given once, on a project just made
   * from an import document, which has no room for them. Taken from a project owner as well as an
   * organization admin, so its creator may give it; a person's own list is not
   * (`writeMemberProjectRoles`).
   *
   * Only on a project just made: the write replaces the whole list, cannot name an integration
   * token and drops a Mate key's own grant (F7, measured 2026-10-03) — no key holds one yet. The
   * list read is kept, its creator's `OWNER` with it, the chosen people set in it; the platform
   * replaces the record too, so its fields go back as they were read (`projectWriteBody`).
   */
  async writeNewProjectAccess(
    projectId: string,
    userRoles: ReadonlyArray<ProjectGrant>,
    beforeWrite?: () => Promise<void>,
  ): Promise<ZeropsProject> {
    const generation = this.#generation;
    this.#assertGeneration(generation);
    const project = await this.fetchProject(projectId);
    this.#assertGeneration(generation);
    const list = userRoles.reduce(
      (held, { clientUserId, roleCode }) => withProjectGrant(held, clientUserId, roleCode),
      project.userRoles ?? [],
    );
    return this.#request<ZeropsProject>(
      `/project/${projectId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...projectWriteBody({
            name: project.name,
            description: project.description,
            tagList: project.tagList ?? [],
            publicIpV4Shared: project.publicIpV4Shared,
            maxCreditLimit: project.maxCreditLimit,
          }),
          // One level deeper than a creation's list: a flat list is refused as invalid input.
          userRoles: { userRoles: creationUserRoles(list) },
        }),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
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
   * upgrade URL carries. The request body uses `token`.
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
    /** The access token the last attempt carried. */
    let sentToken: string | undefined;
    const attempt = async (): Promise<{ readonly webSocketToken: string }> => {
      const session = await this.#currentSession(signal);
      sentToken = session?.accessToken;
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
        !this.#renewable(this.#session)
      ) {
        throw cause;
      }
      // A renewal that replaced the token this login carried leaves nothing to renew again.
      if (this.#session.accessToken === sentToken)
        await waitForPromiseOrAbort(this.#refreshSession(), signal);
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
      /** Who reaches it from birth beyond their organization role (`zerops/projectAccess.ts`). */
      readonly userRoles?: ReadonlyArray<ProjectGrant>;
      /** The core package it is born on; Lightweight where absent. */
      readonly corePackage?: ZeropsCorePackage;
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
            tagList: BORN_TAGS.filter((tag) => input.tagList.includes(tag)),
            ...(input.location ? { location: input.location } : {}),
            ...(input.userRoles === undefined ? {} : { userRoles: input.userRoles }),
            ...(input.corePackage === undefined ? {} : { mode: input.corePackage }),
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
   * A Mate's birth as one `POST /project/{id}/service-stack/import` into the project that exists:
   * the zcp that carries the agent, holding the Mate's own key, first by `priority`, and the tier's
   * services beside it (`mateBirthImportYaml`), isolated by the project's own value. Zerops
   * creates them in their waves whether this browser stays or not. The zcp@1 type and its inline
   * `zeropsYaml` are an ordinary import's (the platform's import schema); the platform's own
   * first-class-recipe endpoint takes the container alone.
   *
   * The key is the Mate's own, established here by the person (`#establishMateKey`). It goes into
   * the container as the secret `ZCP_API_KEY`, and the platform is asked for no token of
   * its own (`createIntegrationToken: false`). The platform's would be
   * `ADMIN`, a project variable every service can read, and a one-time
   * delegation — three things a later step had to take back, from a browser
   * that might have gone by then.
   *
   * Every write is safe to make again, so a press tried again finishes what
   * the first one started:
   * - a project that has its container already makes no write at all, and one holding several zcp
   *   services is refused, naming them: a project holds one Mate (audit D2);
   * - a key an earlier press minted, its container never imported, is reused, never a second key
   *   beside it — only while no zcp is being created that may hold it already.
   *
   * The value lives in this call alone: it is in the import's body and in no
   * answer, no log and no error.
   *
   * Before the import the project admits the container (`admitContainer`): the one writer of the
   * project's `sshIsolation` and `envIsolation` (`zeropsio/zcp:docs/spec-mate.md` §2.8, C-13 and
   * the `envIsolation` row beside it).
   */
  async importDevelopmentContainer(
    input: {
      readonly clientId: string;
      readonly projectId: string;
      /** The project's name: the key is `zcp-<name>`, as the platform names its own. */
      readonly projectName: string;
      readonly zcpVersion?: string;
      readonly agents?: ReadonlyArray<ZeropsAgentType>;
      /** The tier's services as the birth imports them (`mateTier`); absent for a Mate alone. */
      readonly tierYaml?: string;
      readonly birthplace?: MateBirthplace;
    },
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
    /** Establish the actual credential's person context before handing it to its container. */
    onKeyEstablished?: (context: {
      readonly projectId: string;
      readonly keyHash: string;
    }) => Promise<void>,
  ): Promise<{
    readonly serviceName: string;
    readonly imported: boolean;
    /** The container's creation process Zerops answered the import with, where it named one. */
    readonly processId?: string;
  }> {
    let importRequested = false;
    try {
      const generation = this.#generation;
      const services = await this.listProjectServices(input.projectId, signal);
      this.#assertGeneration(generation);
      const container = mateContainerOf(services);
      if (container.kind === "several") throw new Error(severalMatesLine(container.names));
      if (container.kind === "one") return { serviceName: container.service.name, imported: false };

      const tokens = await listIntegrationTokens(this.door, input.clientId, signal);
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
      const { apiKey } = await this.#establishMateKey(
        { ...input, earlier },
        generation,
        signal,
        beforeWrite,
        onKeyEstablished,
      );

      const serviceName = nextZcpServiceName(services.map((service) => service.name));
      this.#assertGeneration(generation);
      await admitContainer(this.door, input.projectId, serviceName, signal, beforeWrite);
      this.#assertGeneration(generation);
      importRequested = true;
      const answered = await this.importServicesIntoProject(
        input.projectId,
        mateBirthImportYaml(
          buildZcpServiceImportYaml({
            serviceName,
            vscodePassword: generateVscodePassword(),
            apiKey,
            ...(input.zcpVersion ? { zcpVersion: input.zcpVersion } : {}),
            ...(input.agents ? { agents: input.agents } : {}),
            ...(input.birthplace ? { birthplace: input.birthplace } : {}),
            ...(this.#baseUrl === DEFAULT_ZEROPS_API_BASE
              ? {}
              : { apiHost: new URL(this.#baseUrl).host }),
          }),
          input.tierYaml,
        ),
        signal,
        beforeWrite,
      ).catch((cause: unknown) => {
        if (
          cause instanceof ZeropsApiError &&
          cause.status !== null &&
          cause.status >= 400 &&
          cause.status < 500
        )
          throw new ZeropsTargetWriteRefused(cause);
        throw cause;
      });
      const processId = importProcessOf(
        answered.serviceStacks?.find((stack) => stack.name === serviceName)?.processes,
      );
      return { serviceName, imported: true, ...(processId === undefined ? {} : { processId }) };
    } catch (cause) {
      if (
        !importRequested &&
        !(cause instanceof ZeropsWriteNotSent) &&
        !(cause instanceof ZeropsApiError && cause.kind === "uncertain")
      )
        throw new ZeropsWriteNotSent(cause);
      throw cause;
    }
  }

  /**
   * The Mate's own key, established by the person as a birth and an Enable do: minted with its own
   * project and nothing more — `BASIC_USER` there, no grant on any other project (ADR 0003), no
   * delegation — named `zcp-<project>` as the platform names its own. An earlier press's key
   * (`earlier`, `newestMateKey`) is reused instead, never a second key beside it: set to its own
   * project alone where it is still `ADMIN` (`planMateKey`) and its value regenerated, because the
   * value is shown once and nothing kept it. A key this call minted whose authorization
   * `onKeyEstablished` refused is deleted: no container will hold it.
   *
   * The value leaves only in the answer; `minted` names the key this call made, never an earlier
   * press's.
   */
  async #establishMateKey(
    input: {
      readonly clientId: string;
      readonly projectId: string;
      readonly projectName: string;
      readonly earlier: ZeropsIntegrationToken | undefined;
    },
    generation: number,
    signal: AbortSignal | undefined,
    beforeWrite: (() => Promise<void>) | undefined,
    onKeyEstablished:
      | ((context: { readonly projectId: string; readonly keyHash: string }) => Promise<void>)
      | undefined,
  ): Promise<{ readonly apiKey: string; readonly minted: string | undefined }> {
    const grants: ReadonlyArray<ZeropsProjectGrant> = [
      { projectId: input.projectId, roleCode: MATE_SELF_PROJECT_ROLE },
    ];
    const earlier = input.earlier;
    let apiKey: string;
    /** The key this call minted, never an earlier press's. */
    let minted: string | undefined;
    if (earlier === undefined) {
      const key = await mintIntegrationToken(
        this.door,
        {
          clientId: input.clientId,
          name: mateKeyName(input.projectName),
          roleCode: "NO_ACCESS",
          projects: grants,
        },
        signal,
        beforeWrite,
      );
      apiKey = key.token;
      minted = key.id;
    } else {
      // The write replaces the key's whole project list: it is planned from the key as read
      // under its lock, every token writer's, and lowers its org role to none. Found by its name,
      // a key that reaches another project by then is not the Mate's: it is neither narrowed nor
      // handed to the container.
      await this.#holdToken(earlier.id, async () => {
        const current = (await listIntegrationTokens(this.door, input.clientId, signal)).find(
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
        await setIntegrationTokenProjects(
          this.door,
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
      apiKey = await regenerateIntegrationToken(
        this.door,
        { clientId: input.clientId, tokenId: earlier.id },
        signal,
        beforeWrite,
      );
    }

    this.#assertGeneration(generation);
    if (onKeyEstablished !== undefined) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
      this.#assertGeneration(generation);
      const keyHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      try {
        await onKeyEstablished({ projectId: input.projectId, keyHash });
      } catch (cause) {
        // A key HQ did not authorize is a key no container holds: the one this call minted is
        // taken back, by the account that minted it; an earlier press's stays for the next to reuse.
        if (minted !== undefined && this.#generation === generation)
          await deleteIntegrationToken(
            this.door,
            { clientId: input.clientId, tokenId: minted },
            signal,
            beforeWrite,
          ).catch(() => undefined);
        throw cause;
      }
      this.#assertGeneration(generation);
    }
    return { apiKey, minted };
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
   * A Mate's key hardened (spec-mate §3 B-1/B-3), for one Mate's own project: the isolation is the
   * project's, set before the birth import (`admitContainer`), never written here.
   *
   * The token half sets the Mate's key to its own project alone at `BASIC_USER` (`planMateKey`):
   * the key HQ holds by id loses any other grant; a key found by its name is the Mate's only while
   * it holds nothing else, and is left as it is otherwise. Every delegation the token carries is
   * then dropped: the one-time mint the platform grants at creation, which nothing here needs
   * (`groupReach.ts`, guide 0.4).
   *
   * Idempotent, and cheap to prove so: a token already at `BASIC_USER` with
   * no wider grant plans nothing, and a token with no delegations lists an
   * empty page. A hardened Mate re-run through this makes no writes at all.
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

    return { tokenLowered, keyNotLowered, delegationsDropped };
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
    const tokens = await listIntegrationTokens(this.door, clientId, signal);
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
      const current = await readIntegrationToken(this.door, clientId, tokenId, signal);
      if (current === undefined) return undefined;
      this.#assertGeneration(generation);
      const planned = planMateKey({ token: current, selfProjectId: projectId, foundBy });
      if (planned.kind !== "write") return planned;
      await setIntegrationTokenProjects(
        this.door,
        { clientId, tokenId: current.id, name: current.name, projects: planned.projects },
        signal,
        beforeWrite,
      );
      return planned;
    });
    if (plan?.kind === "not-its-key") return;
    if (plan?.kind === "write") told.lowered();

    this.#assertGeneration(generation);
    const delegations = await listIntegrationTokenDelegations(
      this.door,
      { clientId, tokenId },
      signal,
    );
    for (const delegation of delegations) {
      this.#assertGeneration(generation);
      await deleteIntegrationTokenDelegation(
        this.door,
        { clientId, tokenId, delegationId: delegation.id },
        signal,
        beforeWrite,
      );
      told.dropped();
    }
  }

  /** Redeploy a Mate whose container has no active app version, retaining its saved run config. */
  async deployMate(
    serviceId: string,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<void>,
  ): Promise<{ readonly processId: string }> {
    const generation = this.#generation;
    const service = await this.#request<ZeropsService>(`/service-stack/${serviceId}`, {
      signal: signal ?? null,
    });
    if (
      !isZcpService(service) ||
      service.status !== "READY_TO_DEPLOY" ||
      service.activeAppVersion !== null
    )
      throw new ZeropsApiError(
        "This Mate no longer needs a deployment. Refresh its status.",
        "invalid-input",
      );
    const env = await this.#serviceEnv(serviceId, signal);
    const saved = env.find((entry) => entry.key === "ZEROPS_YAML")?.content;
    // Reuse existing secrets, including older Mates without a dedicated integration key.
    // Publishing a code-server container still requires the password creation requires.
    const configured = env.some(
      (entry) => entry.key === "VSCODE_PASSWORD" && entry.content.length > 0,
    );
    if (!saved || !configured)
      throw new ZeropsApiError(
        "The Mate's saved deployment settings are unavailable.",
        "invalid-input",
      );
    let zeropsYaml: string;
    try {
      zeropsYaml = buildZcpDeploymentYaml(service.name, saved);
    } catch {
      throw new ZeropsApiError(
        "The Mate's saved run configuration is unavailable.",
        "invalid-input",
      );
    }
    this.#assertGeneration(generation);
    const answer = await this.#request<{ readonly process?: { readonly id?: string } }>(
      `/service-stack/${serviceId}/trigger-pipeline`,
      {
        method: "PUT",
        signal: signal ?? null,
        body: JSON.stringify({ zeropsYaml, enableSubdomainAccess: true }),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
    if (!answer.process?.id)
      throw new ZeropsApiError(
        "Zerops accepted the deployment but did not return its process, so it cannot be followed.",
        "uncertain",
      );
    return { processId: answer.process.id };
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

  /** `POST /service-stack/{id}/user-data` — writes the Zerops Mate flag as on. */
  async #createMateFlag(serviceId: string, beforeWrite?: () => Promise<void>): Promise<void> {
    await this.#request(
      `/service-stack/${serviceId}/user-data`,
      {
        method: "POST",
        // `sensitive` is required on every service userData write — the platform rejects a body
        // without it as "field is required". The flag is no secret, and a sensitive value reads
        // back as `REDACTED`: never as on, so the read-back below would create it a second time.
        body: JSON.stringify({ key: ZEROPS_MATE_ENV_KEY, content: "1", sensitive: false }),
      },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  }

  /**
   * Gives a container made without Mate the Mate's own key, as a birth gives its zcp
   * (`#establishMateKey`): the person establishes the key, and it is written as the secret
   * `ZCP_API_KEY` of the container's zcp service, over the one there or beside the project's
   * variable of that name — a service's own variable outranks its project's (zerops-docs
   * `features/env-variables`, Variable Precedence). The key the platform made with the container
   * is never reused nor read: it is `sudo`, which HQ's Mate door never admits, and a plain
   * project variable on older containers. Its restart, the boot that reads the key, is the
   * caller's. No observe authorization is asked for: HQ grants one only to a Mate placed in an
   * application, and an Enabled Mate is placed in none (`authorize-observe` asks once it is).
   *
   * A key this call minted that no variable came to hold is deleted. The value lives in this call
   * alone: in the variable's body and in no answer, no log and no error.
   */
  async installMateKey(
    input: {
      readonly clientId: string;
      readonly projectId: string;
      /** The project's name: the key is `zcp-<name>`, as the platform names its own. */
      readonly projectName: string;
      readonly serviceId: string;
    },
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    const generation = this.#generation;
    let written = false;
    try {
      const earlier = newestMateKey(
        await listIntegrationTokens(this.door, input.clientId),
        input.projectId,
      );
      this.#assertGeneration(generation);
      const { apiKey, minted } = await this.#establishMateKey(
        { ...input, earlier },
        generation,
        undefined,
        beforeWrite,
        undefined,
      );
      const write = { key: ZCP_API_KEY, content: apiKey, sensitive: true };
      try {
        const current = (await this.#serviceEnv(input.serviceId)).find(
          (entry) => entry.key === ZCP_API_KEY,
        );
        this.#assertGeneration(generation);
        written = true;
        await setServiceVariable(this.door, input.serviceId, current, write, beforeWrite);
      } catch (cause) {
        // A key no variable holds is taken back, by the account that minted it.
        if (
          minted !== undefined &&
          this.#generation === generation &&
          !(cause instanceof ZeropsApiError && cause.kind === "uncertain")
        )
          await deleteIntegrationToken(
            this.door,
            { clientId: input.clientId, tokenId: minted },
            undefined,
            beforeWrite,
          ).catch(() => undefined);
        throw cause;
      }
    } catch (cause) {
      if (
        !written &&
        !(cause instanceof ZeropsWriteNotSent) &&
        !(cause instanceof ZeropsApiError && cause.kind === "uncertain")
      )
        throw new ZeropsWriteNotSent(cause);
      throw cause;
    }
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
  async writeMateFlag(serviceId: string, beforeWrite?: () => Promise<void>): Promise<void> {
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
        {
          operationKind: "project-write",
          ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
        },
      );
    }
    this.#assertGeneration(generation);
    await this.#createMateFlag(serviceId, beforeWrite);

    const after = (await this.#serviceEnv(serviceId)).find(
      (entry) => entry.key === ZEROPS_MATE_ENV_KEY,
    );
    if (!after || !readsAsEnabled(after.content)) {
      this.#assertGeneration(generation);
      await this.#createMateFlag(serviceId, beforeWrite);
    }
  }

  async #setSession(session: ZeropsSession | null): Promise<void> {
    if (session === null) this.#nextGeneration();
    this.#session = session;
    await this.#onSessionChange(session);
  }

  /**
   * Renews the held session: one `/auth/refresh` shared by every caller that
   * asks while it runs, a background reader's as much as a person's. A
   * renewed session is adopted. A refresh the platform refuses
   * (`expired-session`), an unusable session in its answer, or no refresh
   * token to renew with ends the held session: nothing repairs it until the
   * person signs in again. Any other failure — the network, a 403 or 5xx
   * answer — rejects and leaves the session held. An answer that arrives
   * after another login replaced this one changes nothing.
   */
  async #refreshSession(): Promise<ZeropsSession> {
    if (this.#refreshPromise) return this.#refreshPromise;
    const generation = this.#generation;
    const current = this.#session;
    if (!this.#renewable(current)) {
      await this.#setSession(null);
      throw new ZeropsApiError(
        "Your Zerops session has expired. Sign in again.",
        "expired-session",
        401,
      );
    }

    const refresh = async () => {
      const response = await this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}/auth/refresh`, {
        method: "POST",
        // No bearer: the refresh token is the credential, and the access token
        // it replaces may already be refused.
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshTokenId: current.refreshToken }),
      });
      this.#assertGeneration(generation);
      if (!response.ok) {
        const error = await apiErrorFromResponse(response);
        this.#assertGeneration(generation);
        if (error.kind === "expired-session") await this.#setSession(null);
        throw error;
      }
      // `/auth/refresh` answers with the session fields at the top level, not
      // wrapped in `auth` the way `/auth/login` does.
      const session = (await response.json()) as ZeropsSession;
      this.#assertGeneration(generation);
      if (!isUsableZeropsSession(session)) {
        await this.#setSession(null);
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
      const renewed =
        this.#sessionOwner === undefined
          ? await this.#renewSession(current, refresh)
          : await this.#renewWithOwner(this.#sessionOwner, current, generation);
      this.#assertGeneration(generation);
      if (renewed !== this.#session) this.adoptRenewedSession(renewed);
      return renewed;
    })().finally(() => {
      this.#refreshPromise = null;
    });

    return this.#refreshPromise;
  }

  /** A session this client can renew: one with a refresh token, or any while its owner renews it. */
  #renewable(session: ZeropsSession | null): session is ZeropsSession {
    return session !== null && (this.#sessionOwner !== undefined || Boolean(session.refreshToken));
  }

  /** The owner's answer for `stale`. An owner that can't answer leaves the session held, as a network failure does. */
  async #renewWithOwner(
    owner: ZeropsSessionOwnerPort,
    stale: ZeropsSession,
    generation: number,
  ): Promise<ZeropsSession> {
    let renewed: ZeropsSession | null;
    try {
      renewed = await owner.renew(stale);
    } catch (cause) {
      if (cause instanceof ZeropsApiError) throw cause;
      throw new ZeropsApiError("Couldn't reach Zerops to renew the session.", "network");
    }
    this.#assertGeneration(generation);
    if (renewed !== null) return renewed;
    await this.#setSession(null);
    throw new ZeropsApiError(
      "Your Zerops session has ended. Sign in again.",
      "expired-session",
      401,
    );
  }

  /**
   * The held session once no renewal stands in front of it: a renewal already under way is
   * waited for, and one that is due runs first. A renewal the platform refuses ends the session,
   * and the request with it. Any other failed renewal leaves the held session in use and says
   * nothing: the platform's refusal of it, if any, is the request's to answer.
   */
  #currentSession(
    signal: AbortSignal | null | undefined,
  ): ZeropsSession | null | Promise<ZeropsSession | null> {
    const held = this.#session;
    // Without a renewal in front, the request leaves in this same tick.
    if (this.#refreshPromise === null && !this.#renewalDue(held)) return held;
    return this.#afterRenewal(held, signal);
  }

  async #afterRenewal(
    held: ZeropsSession | null,
    signal: AbortSignal | null | undefined,
  ): Promise<ZeropsSession | null> {
    const generation = this.#generation;
    try {
      await waitForPromiseOrAbort(this.#refreshSession(), signal);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      if (this.#session === held) this.#renewAheadFailed = held;
    }
    this.#assertGeneration(generation);
    return this.#session;
  }

  #renewalDue(held: ZeropsSession | null): boolean {
    if (this.#renewAhead === undefined || held?.refreshToken === undefined) return false;
    if (held === this.#renewAheadFailed || held.expiresAt === undefined) return false;
    const expiresAtMs = Date.parse(held.expiresAt);
    return (
      Number.isFinite(expiresAtMs) &&
      expiresAtMs - this.#renewAhead.nowMs() < this.#renewAhead.withinMs
    );
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
    /** The access token the last attempt carried. */
    let sentToken: string | undefined;
    const run = async () => {
      if (mutatesProject || options.beforeProjectWrite !== undefined) {
        try {
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
      const current = authenticated ? this.#currentSession(init.signal) : null;
      let session: ZeropsSession | null;
      try {
        session = current instanceof Promise ? await current : current;
      } catch (cause) {
        // Given up on while it waited for a renewal: nothing was sent.
        refusedBeforeSending = true;
        throw cause;
      }
      sentToken = session?.accessToken;
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
        if (this.#renewable(session)) {
          // A renewal that replaced the token this request carried revoked it: the request
          // repeats with the renewed one, and renewing again would revoke that under others.
          if (session.accessToken === sentToken)
            await waitForPromiseOrAbort(this.#refreshSession(), init.signal);
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
