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

import { ZeropsApiError, ZeropsWriteNotSent, type ZeropsApiErrorKind } from "./errors.ts";
import type {
  ZeropsOrganization,
  ZeropsOrganizationInvitation,
  ZeropsUser,
} from "./api/account.ts";
import type { ZeropsProject } from "./api/project.ts";
import type { ZeropsService } from "./api/service.ts";
import type { ZeropsServiceEnvVar } from "./api/variables.ts";
import { listIntegrationTokens } from "./api/integrationTokens.ts";
import { isZcpService } from "./containerAddress.ts";
import type { ZeropsIntegrationToken } from "./groupReach.ts";
import { buildZcpDeploymentYaml } from "./newProject.ts";
import {
  isUsableZeropsSession,
  isZeropsSession,
  requiresZeropsTwoFactor,
  type ZeropsSession,
} from "./session.ts";

export const DEFAULT_ZEROPS_API_BASE = "https://api.app-prg1.zerops.io";

const PUBLIC_API_PREFIX = "/api/rest/public";

/** The person's Zerops access token and its expiry (ISO). */
export interface ZeropsAccess {
  readonly token: string;
  readonly expiresAt: string;
}

/**
 * Why a caller asks for the access token. `refused`, a token HQ refused, renews the session first
 * unless a renewal has already replaced it. `operationAtMs`, the wall-clock instant a person's
 * press hands the token to an HQ operation that runs on it after the request ends, renews first a
 * session {@link operationTokenFresh} says ends too soon.
 */
export type ZeropsAccessAsk = { readonly refused: string } | { readonly operationAtMs: number };

/**
 * The least life a token handed to an HQ operation has: one hour, the maintainers' decision.
 * `@zerops/session` renews the session in every visible page of it 5 to 30 minutes (random per
 * page) before its `expiresAt`, and Zerops revokes the access token it replaces at once, so a
 * handed token lives at least 30 minutes after the press.
 */
const OPERATION_TOKEN_MIN_LIFE_MS = 60 * 60_000;

/**
 * A session expiring at `expiresAtMs` hands an operation pressed at `nowMs` its token as is: it
 * has at least {@link OPERATION_TOKEN_MIN_LIFE_MS} left. An expiry that does not read as an
 * instant says nothing, and the token is handed as is.
 */
function operationTokenFresh(expiresAtMs: number, nowMs: number): boolean {
  return !Number.isFinite(expiresAtMs) || expiresAtMs - nowMs >= OPERATION_TOKEN_MIN_LIFE_MS;
}

/** Whether `ask` renews `held` before its token is handed. */
function renewsBeforeHanding(held: ZeropsSession, ask: ZeropsAccessAsk | undefined): boolean {
  if (ask === undefined) return false;
  if ("refused" in ask) return held.accessToken === ask.refused;
  return !operationTokenFresh(Date.parse(held.expiresAt), ask.operationAtMs);
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
    // A rename preserves the project's tags from the fresh read.
    tagList: input.tagList,
    publicIpV4Shared: input.publicIpV4Shared ?? false,
    maxCreditLimit: input.maxCreditLimit ?? null,
  };
}

/**
 * zcp's own reading of `ZCP_MATE_ENABLED`, the service env key it keys every mate-shaped effect
 * off: `1` or `true`, case-insensitive, surrounding space tolerated. Deliberately forgiving,
 * because it is a value a person types into a service's env in the Zerops GUI, where a silently
 * ignored spelling is indistinguishable from a broken feature.
 */
export function readsAsEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
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

/**
 * Owns request serialization so N parallel 401s cause exactly one refresh, and
 * so the caller never has to think about the Authorization header.
 */
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
   * The held session's access token and its expiry, for a call that hands them to HQ, once no
   * renewal stands in front of it. `ask` may renew the session first ({@link ZeropsAccessAsk}),
   * as a request does after a 401: a refused renewal ends the session and an unreachable one
   * rejects, and either way nothing is handed.
   */
  async accessToken(ask?: ZeropsAccessAsk): Promise<ZeropsAccess> {
    const current = await this.#currentSession(null);
    const held =
      current !== null && renewsBeforeHanding(current, ask)
        ? await this.#refreshSession()
        : current;
    if (held === null) throw new ZeropsApiError("Sign in to Zerops again.", "expired-session", 401);
    return { token: held.accessToken, expiresAt: held.expiresAt };
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

  async signOutLocally(): Promise<void> {
    this.#nextGeneration();
    await this.#setSession(null);
  }

  /**
   * Ends `session` at the platform, after it was already forgotten here. One the
   * platform already refused (its access token expired) is first swapped, with
   * its own refresh token, for a pair this revoke alone uses. Never fails: the
   * person is signed out here whatever the platform answers. HQ's session
   * carries no refresh token, which never leaves HQ, and HQ ends it, so nothing
   * is sent for one.
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

  /** `GET /project/{id}` — also the membership check: 200 member, 403 not. */
  fetchProject(projectId: string, signal?: AbortSignal): Promise<ZeropsProject> {
    return this.#request<ZeropsProject>(`/project/${projectId}`, { signal: signal ?? null });
  }

  /** The organization's integration tokens as Zerops lists them to this account (`GET /client/{id}/integration-token/list`). */
  integrationTokens(
    clientId: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ZeropsIntegrationToken>> {
    return listIntegrationTokens(this.door, clientId, signal);
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
    if (held === this.#renewAheadFailed) return false;
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
