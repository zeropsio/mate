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
  buildCreateProjectBody,
  buildDevelopmentContainerImportBody,
  buildZcpServiceImportYaml,
  generateVscodePassword,
  nextZcpServiceName,
} from "./newProject.ts";
import {
  ZEROPS_CAPTCHA_ERROR_CODE,
  buildZeropsRegistrationBody,
  type ZeropsRegistrationInput,
} from "./registration.ts";

export const DEFAULT_ZEROPS_API_BASE = "https://api.app-prg1.zerops.io";

const PUBLIC_API_PREFIX = "/api/rest/public";

export interface ZeropsSession {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly expiresIn?: number;
  readonly userId?: string;
  readonly tokenType?: string;
  /** Set when the account has 2FA enabled; the values are method names ("TOTP"). */
  readonly twoFAMethods?: ReadonlyArray<string>;
  /** True only once the second factor has been presented. */
  readonly twoFAVerified?: boolean;
  /** One-time secret returned when a recovery code was consumed; never persisted. */
  readonly newRecoveryToken?: string;
}

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

export interface ZeropsUser {
  readonly id: string;
  readonly email: string;
  readonly fullName?: string;
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

export interface ZeropsProject {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly clientId?: string;
  readonly created?: string;
  readonly publicZone?: string;
  readonly zeropsSubdomainHost?: string;
  readonly mode?: string;
}

export interface ZeropsServicePort {
  readonly port: number;
  readonly protocol?: string;
  readonly scheme?: string;
  readonly httpSupport?: boolean;
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
export const ZEROPS_MATE_ENV_KEY = "ZCP_MATE_ENABLED";

/**
 * zcp's own reading of that flag: `1` or `true`, case-insensitive, surrounding
 * space tolerated. Deliberately forgiving, because it is a value a person
 * types into a service's env in the Zerops GUI, where a silently ignored
 * spelling is indistinguishable from a broken feature.
 */
function readsAsEnabled(value: string): boolean {
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
  | "expired-session"
  | "forbidden"
  | "not-found"
  | "invalid-input"
  | "server"
  | "unexpected";

export class ZeropsApiError extends Error {
  readonly kind: ZeropsApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    kind: ZeropsApiErrorKind,
    status: number | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.name = "ZeropsApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function requiresZeropsTwoFactor(session: ZeropsSession | null | undefined): boolean {
  return !!(
    session &&
    session.twoFAMethods &&
    session.twoFAMethods.length > 0 &&
    session.twoFAVerified !== true
  );
}

export function isZeropsSession(value: unknown): value is ZeropsSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ZeropsSession>;
  return typeof session.accessToken === "string" && session.accessToken.trim().length > 0;
}

/** A session that is usable for API calls: present and past any second factor. */
export function isUsableZeropsSession(value: unknown): value is ZeropsSession {
  return isZeropsSession(value) && !requiresZeropsTwoFactor(value);
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

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

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
  return new ZeropsApiError(message, kind, response.status, code);
}

export interface ZeropsApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchImplementation;
  /** Fired whenever the held session changes — persist it, or clear on null. */
  readonly onSessionChange?: (session: ZeropsSession | null) => Promise<void> | void;
}

interface RequestOptions {
  readonly authenticated?: boolean;
  readonly retryAfterRefresh?: boolean;
}

export interface ListProjectsOptions {
  readonly statuses?: ReadonlyArray<string>;
  readonly limit?: number;
}

/**
 * Owns request serialization so N parallel 401s cause exactly one refresh, and
 * so the caller never has to think about the Authorization header.
 */
export class ZeropsApiClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchImplementation;
  readonly #onSessionChange: (session: ZeropsSession | null) => Promise<void> | void;
  #session: ZeropsSession | null = null;
  #refreshPromise: Promise<ZeropsSession> | null = null;

  constructor(options: ZeropsApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_ZEROPS_API_BASE).replace(/\/+$/, "");
    // Bound to globalThis on purpose: the browser's `fetch` is brand-checked
    // against Window, so storing the bare function and calling it as
    // `this.#fetch(...)` throws "Illegal invocation".
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onSessionChange = options.onSessionChange ?? (() => undefined);
  }

  get session(): ZeropsSession | null {
    return this.#session;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** Adopts a session read back from storage without re-notifying the owner. */
  restoreSession(session: ZeropsSession): void {
    this.#session = session;
  }

  /**
   * Adopts a personal access token handed over by `app.zerops.io` — the client
   * end of the sign-in hand-over (`zerops/handover.ts`).
   *
   * A personal token is already a bearer, so there is nothing to exchange. What
   * matters is that it is **proven before it is stored**: a dead or revoked
   * token that reached storage would render a signed-in-looking UI that fails
   * on its first real call. So it is held in memory, spent on one read, and
   * only persisted once that read comes back.
   *
   * It carries no refresh token, which is correct rather than a gap: on a 401
   * the request path clears the session instead of trying to refresh, which is
   * exactly what should happen to a token the user revoked.
   */
  async adoptPersonalToken(token: string): Promise<ZeropsSession> {
    const accessToken = token.trim();
    if (!accessToken) {
      throw new ZeropsApiError(
        "That Zerops sign-in carried no credential. Start again.",
        "invalid-input",
      );
    }
    const session: ZeropsSession = { accessToken };
    this.#session = session;
    try {
      await this.fetchUser();
    } catch (cause) {
      this.#session = null;
      throw cause;
    }
    await this.#setSession(session);
    return session;
  }

  async signOutLocally(): Promise<void> {
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
      { authenticated: false, retryAfterRefresh: false },
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
      { authenticated: false, retryAfterRefresh: false },
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
      { retryAfterRefresh: false },
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
    try {
      if (this.#session) {
        await this.#request(
          "/auth/logout",
          { method: "POST", body: JSON.stringify({}) },
          { retryAfterRefresh: false },
        );
      }
    } finally {
      await this.#setSession(null);
    }
  }

  fetchUser(): Promise<ZeropsUser> {
    return this.#request<ZeropsUser>("/user/info");
  }

  async fetchOrganizations(): Promise<ReadonlyArray<ZeropsOrganization>> {
    return zeropsClientsFromUser(await this.fetchUser());
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
    const query = new URLSearchParams({ limit: String(options.limit ?? 500) });
    if (options.statuses?.length) query.set("statuses", options.statuses.join(","));
    const response = await this.#request<{ readonly list?: ReadonlyArray<ZeropsProject> }>(
      `/client/${clientId}/project?${query.toString()}`,
    );
    return response.list ?? [];
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
    try {
      return await this.listClientProjects(clientId, options);
    } catch (cause) {
      if (!(cause instanceof ZeropsApiError) || cause.kind !== "forbidden") throw cause;
    }

    const limit = options.limit ?? 500;
    const response = await this.#request<{ readonly items?: ReadonlyArray<ZeropsProject> }>(
      "/project/search",
      {
        method: "POST",
        body: JSON.stringify({
          limit,
          search: [{ name: "clientId", operator: "eq", value: clientId }],
        }),
      },
    );
    const projects = response.items ?? [];
    if (!options.statuses?.length) return projects;
    const statuses = new Set(options.statuses);
    return projects.filter((project) => statuses.has(project.status));
  }

  /** Locations the selected organization may place a new project in. */
  async listClientLocations(clientId: string): Promise<ReadonlyArray<ZeropsLocation>> {
    const response = await this.#request<{
      readonly locationList?: ReadonlyArray<ZeropsLocation>;
    }>(`/client/${clientId}/settings`);
    return response.locationList ?? [];
  }

  /** `GET /project/{id}` — also the membership check: 200 member, 403 not. */
  fetchProject(projectId: string): Promise<ZeropsProject> {
    return this.#request<ZeropsProject>(`/project/${projectId}`);
  }

  async listProjectServices(projectId: string): Promise<ReadonlyArray<ZeropsService>> {
    const response = await this.#request<{ readonly list?: ReadonlyArray<ZeropsService> }>(
      `/project/${projectId}/service-stack`,
    );
    return response.list ?? [];
  }

  fetchService(serviceId: string): Promise<ZeropsService> {
    return this.#request<ZeropsService>(`/service-stack/${serviceId}`);
  }

  /**
   * Creates a project and imports the platform's development-container recipe
   * into it — the "New project" path, and the same one an exhausted pool
   * takes.
   *
   * The container's `VSCODE_PASSWORD` is generated here and leaves only inside
   * the import request: it is deliberately absent from the return value, so no
   * caller can put it on a screen, in a log or in storage.
   */
  async createProjectWithZeropsMate(input: {
    readonly clientId: string;
    readonly name: string;
    readonly existingServiceNames?: ReadonlyArray<string>;
    readonly location?: string;
    readonly zcpVersion?: string;
  }): Promise<{ readonly project: ZeropsProject; readonly serviceName: string }> {
    const project = await this.#request<ZeropsProject>(`/client/${input.clientId}/project`, {
      method: "POST",
      body: JSON.stringify(
        buildCreateProjectBody({
          clientId: input.clientId,
          name: input.name,
          ...(input.location ? { location: input.location } : {}),
        }),
      ),
    });

    const serviceName = nextZcpServiceName(input.existingServiceNames ?? []);
    await this.#request(`/project/${project.id}/first-class-recipe/development-container`, {
      method: "PUT",
      body: JSON.stringify(
        buildDevelopmentContainerImportBody({
          serviceImportYaml: buildZcpServiceImportYaml({
            serviceName,
            vscodePassword: generateVscodePassword(),
            ...(input.zcpVersion ? { zcpVersion: input.zcpVersion } : {}),
          }),
        }),
      ),
    });

    return { project, serviceName };
  }

  /**
   * `PUT /service-stack/{id}/restart` with the user's own token. On a zcp
   * container a restart re-runs the platform recipe's install step, which
   * picks up the current zcp release.
   */
  async restartService(serviceId: string): Promise<void> {
    await this.#request(`/service-stack/${serviceId}/restart`, { method: "PUT" });
  }

  /** `GET /service-stack/{id}/env` — the service's own env records. */
  async #serviceEnv(serviceId: string): Promise<ReadonlyArray<ZeropsServiceEnvVar>> {
    const body = await this.#request<{ readonly items?: ReadonlyArray<ZeropsServiceEnvVar> }>(
      `/service-stack/${serviceId}/env`,
    );
    return body.items ?? [];
  }

  /**
   * Turns Zerops Mate on for a container that is not serving it: write the
   * flag, then restart.
   *
   * Both halves are needed and neither is enough. `ZCP_MATE_ENABLED` is the one
   * input zcp keys every mate-shaped effect off — without it `zcp init` does not
   * register the mate step at all, so no bundle is installed, no `zerops@mate` unit
   * is created and nginx publishes no `/mate/` location. And a service env change
   * reaches a container's process environment only at boot, which is the same
   * boot `zcp init` reads it on. So a restart without the write comes back in
   * the identical state, and a write without the restart changes nothing yet.
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
   */
  async enableZeropsMate(serviceId: string): Promise<void> {
    const current = (await this.#serviceEnv(serviceId)).find(
      (entry) => entry.key === ZEROPS_MATE_ENV_KEY,
    );

    if (!current || !readsAsEnabled(current.content)) {
      if (current) {
        await this.#request(`/user-data/${current.id}`, { method: "DELETE" });
      }
      await this.#request(`/service-stack/${serviceId}/user-data`, {
        method: "POST",
        // `sensitive` is required on every service userData write — the
        // platform rejects a body without it as "field is required".
        body: JSON.stringify({ key: ZEROPS_MATE_ENV_KEY, content: "1", sensitive: true }),
      });
    }

    await this.restartService(serviceId);
  }

  async #setSession(session: ZeropsSession | null): Promise<void> {
    this.#session = session;
    await this.#onSessionChange(session);
  }

  async #refreshSession(): Promise<ZeropsSession> {
    if (this.#refreshPromise) return this.#refreshPromise;
    const current = this.#session;
    if (!current?.refreshToken) {
      await this.#setSession(null);
      throw new ZeropsApiError(
        "Your Zerops session has expired. Sign in again.",
        "expired-session",
        401,
      );
    }

    this.#refreshPromise = (async () => {
      const response = await this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${current.accessToken}`,
        },
        body: JSON.stringify({ refreshTokenId: current.refreshToken }),
      });
      if (!response.ok) {
        const error = await apiErrorFromResponse(response);
        if (error.kind === "expired-session") await this.#setSession(null);
        throw error;
      }
      // `/auth/refresh` answers with the session fields at the top level, not
      // wrapped in `auth` the way `/auth/login` does.
      const session = (await response.json()) as ZeropsSession;
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
    })().finally(() => {
      this.#refreshPromise = null;
    });

    return this.#refreshPromise;
  }

  async #request<T = unknown>(
    path: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const authenticated = options.authenticated ?? true;
    const retryAfterRefresh = options.retryAfterRefresh ?? true;

    const run = () => {
      const session = this.#session;
      return this.#fetch(`${this.#baseUrl}${PUBLIC_API_PREFIX}${path}`, {
        ...init,
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
      if (response.status === 401 && retryAfterRefresh) {
        const session = this.#session;
        if (session?.refreshToken) {
          await this.#refreshSession();
          response = await run();
        }
        if (response.status === 401) await this.#setSession(null);
      }
    } catch (cause) {
      if (cause instanceof ZeropsApiError) throw cause;
      throw new ZeropsApiError(
        cause instanceof Error
          ? `Network error contacting Zerops: ${cause.message}`
          : "Network error contacting Zerops.",
        "network",
      );
    }

    if (!response.ok) {
      throw await apiErrorFromResponse(response);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
