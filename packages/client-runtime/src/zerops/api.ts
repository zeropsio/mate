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

import { buildGiteaImportYaml } from "./giteaRecipe.ts";
import { withZeropsGroupTags, type ZeropsEnvironmentRole } from "./groups.ts";
import { formatToolTag, type ZeropsToolKind } from "./tools.ts";
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
  /** Round-tripped by `updateProjectGroupTags`, which must not blank it. */
  readonly description?: string;
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
  /** OR'd across every caller sharing the current `#refreshPromise` — see `#refreshSession`'s doc comment. */
  #refreshClearOnFailure = true;

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

  /**
   * Moves a project into a group, out of one, or changes what it is for.
   *
   * Read-modify-write because `PUT /project/{id}` replaces `tagList` wholesale
   * — a blind write would delete whatever the user tagged the project with
   * themselves. `withZeropsGroupTags` is what preserves them.
   *
   * This is also the path that makes an existing project adoptable and lets a
   * production environment be paired retroactively, which the create-time tag
   * alone cannot do.
   */
  async updateProjectGroupTags(
    projectId: string,
    next: { readonly groupId?: string; readonly role?: ZeropsEnvironmentRole },
  ): Promise<ZeropsProject> {
    const project = await this.fetchProject(projectId);
    return this.#request<ZeropsProject>(`/project/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: project.name,
        description: project.description ?? "",
        tagList: withZeropsGroupTags(project.tagList, next),
      }),
    });
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
  ): Promise<ZeropsServiceImportResult> {
    return this.#request<ZeropsServiceImportResult>(`/project/${projectId}/service-stack/import`, {
      method: "POST",
      body: JSON.stringify({ yaml: servicesYaml }),
    });
  }

  /**
   * Stands up an account-level tool — today only Gitea — as its own tagged
   * project.
   *
   * Two calls, in this order for a reason: the region is only knowable once
   * the project exists (`publicZone`), and the Gitea recipe needs it to write
   * a `GITEA_DOMAIN` that resolves. The published recipe hardcodes a host that
   * does not (`giteaRecipe.ts`), so a caller that skipped this would get an
   * instance whose every clone URL points nowhere.
   *
   * No `zcp` container: a tool is not an environment and has no agent.
   */
  async createToolProject(input: {
    readonly clientId: string;
    readonly kind: ZeropsToolKind;
    readonly name: string;
    readonly location?: string;
  }): Promise<{ readonly project: ZeropsProject }> {
    const project = await this.#request<ZeropsProject>(`/client/${input.clientId}/project`, {
      method: "POST",
      body: JSON.stringify(
        buildCreateProjectBody({
          clientId: input.clientId,
          name: input.name,
          ...(input.location ? { location: input.location } : {}),
          tagList: [formatToolTag(input.kind)],
        }),
      ),
    });

    const region = project.publicZone ? zeropsRegionFromPublicZone(project.publicZone) : null;
    if (region === null) {
      throw new ZeropsApiError(
        "Zerops did not say which region the project was created in.",
        "unexpected",
      );
    }

    await this.importServicesIntoProject(project.id, buildGiteaImportYaml(region));
    return { project };
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
   * `GET /project/{id}/process` — the direct, lag-free process read the
   * platform-activity overlay polls (zcp's `GetProjectProcessesDirect`). The
   * raw document is returned as-is; the caller decodes it with
   * `zerops/activity/dto` `readProjectProcesses`, which degrades field-by-field
   * rather than throwing on a shape this client does not expect.
   *
   * `clearSessionOnUnauthorized: false` — this is a background poll behind an
   * advisory overlay, not a user-initiated action: its own 401 says nothing
   * about whether the account's session is still good elsewhere, so it must
   * never sign the whole UI out from under someone reading something else. A
   * 401 that survives the refresh attempt still rejects; the caller (the
   * activity poller) maps that to "unavailable for this project".
   */
  async fetchProjectProcesses(projectId: string): Promise<unknown> {
    return this.#request<unknown>(`/project/${projectId}/process`, undefined, {
      clearSessionOnUnauthorized: false,
    });
  }

  /**
   * `GET /project/{id}/log` — a signed URL for the project's log backend
   * (auth rides inside the URL itself; the backend ignores an Authorization
   * header). The response's `url` arrives as `GET https://…` (a legacy
   * method-prefixed form); the prefix is stripped here so no caller has to
   * know about it. Never logged: it is a bearer credential in URL form.
   *
   * `clearSessionOnUnauthorized: false` — mirrors `fetchProjectProcesses`:
   * this backs a build-log read behind an advisory overlay, not a
   * user-initiated action, so its own 401 must never sign the whole UI out.
   */
  async fetchProjectLogAccess(projectId: string): Promise<{ readonly url: string }> {
    const response = await this.#request<{ readonly url: string }>(
      `/project/${projectId}/log`,
      undefined,
      { clearSessionOnUnauthorized: false },
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
   * `clearSessionOnUnauthorized: false` on every attempt, matching
   * `fetchProjectProcesses`: this backs a background reconnect
   * (`platformWatch.ts`), not a user-initiated action, so its own 401 must
   * never sign the whole UI out from under something else using the session.
   */
  async exchangeWebSocketToken(): Promise<{ readonly webSocketToken: string }> {
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
        { method: "POST", body: JSON.stringify({ token: session.accessToken }) },
        { retryAfterRefresh: false, clearSessionOnUnauthorized: false },
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
      await this.#refreshSession(false);
      return attempt();
    }
  }

  /**
   * `POST /{entity}/search` with the fields that turn a plain search into a
   * push subscription routed to an already-open platform-websocket receiver:
   * `receiverId` names that socket, `subscriptionName` and `wsOutputType`
   * choose membership pushes (`"list"`, current `items` returned) or
   * status-change pushes (`"update"`, `disableOutput: true`, no items
   * returned). Verified protocol: `docs/internals/zerops/verified.md`.
   *
   * A `process` subscription additionally excludes the L7 load-balancer's own
   * housekeeping processes — `frontend-legacy` `process-base.effect.ts`'s
   * `listSubscribe`/`updateSubscribe` calls, ported verbatim (their
   * `clientId`-only search become `clientId eq` **and** `projectId eq` here:
   * the official app scopes to the whole account, this client to one
   * project). Only the LIST subscription narrows further to `status in
   * [RUNNING, PENDING]` (also ported verbatim): the UPDATE subscription must
   * see every status transition, FINISHED/FAILED/CANCELED included, or a
   * process settling would never push a signal. A `service-stack`
   * subscription carries no such extra terms — `service-stack-base.effect.ts`
   * passes none either.
   *
   * `clearSessionOnUnauthorized: false`, matching `exchangeWebSocketToken`:
   * a background reconnect's own 401 must never sign the whole UI out.
   */
  async subscribeProjectSearch(
    entity: "service-stack" | "process",
    options: {
      readonly orgId: string;
      readonly projectId: string;
      readonly receiverId: string;
      readonly mode: "list" | "update";
    },
  ): Promise<unknown> {
    const subscriptionEntity = entity === "service-stack" ? "ServiceStack" : "Process";
    const search: Array<{
      readonly name: string;
      readonly operator: string;
      readonly value: unknown;
    }> = [
      { name: "clientId", operator: "eq", value: options.orgId },
      { name: "projectId", operator: "eq", value: options.projectId },
    ];
    if (entity === "process") {
      if (options.mode === "list") {
        search.push({ name: "status", operator: "in", value: ["RUNNING", "PENDING"] });
      }
      search.push({ name: "executorTag", operator: "ne", value: "L7_MASTER" });
    }
    return this.#request(
      `/${entity}/search`,
      {
        method: "POST",
        body: JSON.stringify({
          search,
          sort: [],
          subscriptionName: `${subscriptionEntity}__${options.mode}-subscription`,
          receiverId: options.receiverId,
          wsOutputType: options.mode === "list" ? "listStream" : "updateStream",
          ...(options.mode === "update" ? { disableOutput: true } : {}),
        }),
      },
      { clearSessionOnUnauthorized: false },
    );
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
    readonly agents?: ReadonlyArray<ZeropsAgentType>;
    /** The group this environment joins, and what it is for (`groups.ts`). */
    readonly group?: { readonly groupId: string; readonly role?: ZeropsEnvironmentRole };
  }): Promise<{ readonly project: ZeropsProject; readonly serviceName: string }> {
    const project = await this.#request<ZeropsProject>(`/client/${input.clientId}/project`, {
      method: "POST",
      body: JSON.stringify(
        buildCreateProjectBody({
          clientId: input.clientId,
          name: input.name,
          ...(input.location ? { location: input.location } : {}),
          ...(input.group
            ? {
                tagList: withZeropsGroupTags([], {
                  groupId: input.group.groupId,
                  ...(input.group.role ? { role: input.group.role } : {}),
                }),
              }
            : {}),
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
            ...(input.agents ? { agents: input.agents } : {}),
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

  /** `POST /service-stack/{id}/user-data` — writes the Zerops Mate flag as on. */
  async #createMateFlag(serviceId: string): Promise<void> {
    await this.#request(`/service-stack/${serviceId}/user-data`, {
      method: "POST",
      // `sensitive` is required on every service userData write — the
      // platform rejects a body without it as "field is required".
      body: JSON.stringify({ key: ZEROPS_MATE_ENV_KEY, content: "1", sensitive: true }),
    });
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
   *
   * The create can race the platform's own read path, so it is followed by
   * one read-back; a miss there gets exactly one more create attempt, never
   * an unbounded retry loop, before the container restarts either way.
   */
  async enableZeropsMate(serviceId: string): Promise<void> {
    const current = (await this.#serviceEnv(serviceId)).find(
      (entry) => entry.key === ZEROPS_MATE_ENV_KEY,
    );

    if (!current || !readsAsEnabled(current.content)) {
      if (current) {
        await this.#request(`/user-data/${current.id}`, { method: "DELETE" });
      }
      await this.#createMateFlag(serviceId);

      const after = (await this.#serviceEnv(serviceId)).find(
        (entry) => entry.key === ZEROPS_MATE_ENV_KEY,
      );
      if (!after || !readsAsEnabled(after.content)) {
        await this.#createMateFlag(serviceId);
      }
    }

    await this.restartService(serviceId);
  }

  async #setSession(session: ZeropsSession | null): Promise<void> {
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
        if (error.kind === "expired-session" && this.#refreshClearOnFailure) {
          await this.#setSession(null);
        }
        throw error;
      }
      // `/auth/refresh` answers with the session fields at the top level, not
      // wrapped in `auth` the way `/auth/login` does.
      const session = (await response.json()) as ZeropsSession;
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
    const authenticated = options.authenticated ?? true;
    const retryAfterRefresh = options.retryAfterRefresh ?? true;
    const clearSessionOnUnauthorized = options.clearSessionOnUnauthorized ?? true;

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
          await this.#refreshSession(clearSessionOnUnauthorized);
          response = await run();
        }
        if (response.status === 401 && clearSessionOnUnauthorized) await this.#setSession(null);
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
