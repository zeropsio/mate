/**
 * The Zerops REST API as the account harness serves it (DESIGN §11.1): one
 * platform — people, organizations, projects, tokens — behind a `fetch` the
 * real `ZeropsApiClient` calls.
 *
 * Every request that reaches it is logged with the bearer it carried, so a
 * test can say which credential did what.
 */
import type { FetchImplementation, ZeropsProject, ZeropsUser } from "../api.ts";
import type { ZeropsSession } from "../session.ts";
import type { HarnessTab } from "./browserTabs.ts";

const PUBLIC_API_PREFIX = "/api/rest/public";

export interface FakeZeropsRequest {
  /** `METHOD /path`, without the public API prefix or the query. */
  readonly route: string;
  readonly token: string | null;
  readonly body: unknown;
  /** The harness tab that sent it, when it came through `fetchFor`. */
  readonly tab: string | null;
}

export interface FakeZeropsRest {
  readonly fetch: FetchImplementation;
  /** `fetch` as one tab's page sends it: it fails at the network while the tab is offline. */
  readonly fetchFor: (tab: Pick<HarnessTab, "id" | "signals">) => FetchImplementation;
  /** A person who can sign in; with `totp`, only after that second factor. */
  readonly addUser: (input: {
    readonly user: ZeropsUser;
    readonly password: string;
    readonly totp?: string;
  }) => void;
  readonly addProject: (project: ZeropsProject) => void;
  /** A session the platform would have issued to this person, e.g. to seed storage. */
  readonly issueSession: (userId: string) => ZeropsSession;
  /** The access token answers 401 from now on; its refresh token still works. */
  readonly expireAccessToken: (accessToken: string) => void;
  /** Refreshes the platform granted. A refresh token is spent by its one use. */
  readonly refreshes: () => number;
  /** Reads of this project answer `status` until it is set back to `null`. */
  readonly failProject: (projectId: string, status: ProjectFailure | null) => void;
  /**
   * Holds every request to `route` until the test settles the round: a grant
   * round's reads, say, left in flight while something else happens.
   */
  readonly hold: (route: string) => FakeRound;
  /**
   * Requests to `route` never answer; each ends only when its caller aborts
   * it. Returns what ends the hang for later requests.
   */
  readonly hang: (route: string) => () => void;
  /**
   * Another device writes this project's tags once, when our next write
   * reaches the platform: after our read, before our write lands.
   */
  readonly writeTagsConcurrently: (
    projectId: string,
    write: (tags: ReadonlyArray<string>) => ReadonlyArray<string>,
  ) => void;
  readonly project: (projectId: string) => ZeropsProject | undefined;
  readonly projectsOf: (clientId: string) => ReadonlyArray<ZeropsProject>;
  /** Every integration token minted, in minting order, with the bearers that touched it. */
  readonly integrationTokens: () => ReadonlyArray<FakeIntegrationToken>;
  /** Minted and never deleted. */
  readonly orphanTokens: () => ReadonlyArray<FakeIntegrationToken>;
  /** Every request that reached the platform, in arrival order. */
  readonly requests: () => ReadonlyArray<FakeZeropsRequest>;
}

export interface FakeIntegrationToken {
  readonly id: string;
  readonly clientId: string;
  /** The session access token the mint carried. */
  readonly mintedWith: string;
  /** The access token the delete carried, while it is not deleted `null`. */
  readonly deletedWith: string | null;
}

/** One held round. Settling it answers what waits and ends the hold. */
export interface FakeRound {
  readonly waiting: () => number;
  /** The held requests go on to the platform. */
  readonly release: () => void;
  /** The held requests answer `status` without reaching the platform's state. */
  readonly fail: (status: number) => void;
}

export type ProjectFailure = 401 | 403 | 404 | 500 | 502 | 503;

const PROJECT_FAILURE_CODES: Record<ProjectFailure, string> = {
  401: "unauthorized",
  403: "forbidden",
  404: "projectNotFound",
  500: "internalServerError",
  502: "badGateway",
  503: "serviceUnavailable",
};

interface Account {
  readonly user: ZeropsUser;
  readonly password: string;
  readonly totp: string | null;
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const failure = (status: number, code: string) => json(status, { error: { code } });

export function makeFakeZeropsRest(): FakeZeropsRest {
  const accounts = new Map<string, Account>();
  const projects = new Map<string, ZeropsProject>();
  /** Access token → the person it authenticates and the refresh token issued with it. */
  const accessTokens = new Map<
    string,
    { readonly userId: string; readonly refreshToken: string }
  >();
  /** Half-session token → the person still owing the second factor. */
  const halfTokens = new Map<string, string>();
  /** Unspent refresh token → the person it renews. */
  const refreshTokens = new Map<string, string>();
  let refreshes = 0;
  const projectFailures = new Map<string, ProjectFailure>();
  type Answer = (request: FakeZeropsRequest) => Response;
  const holds = new Map<string, Array<(answer: Answer) => void>>();
  const hanging = new Set<string>();
  const integrationTokens: FakeIntegrationToken[] = [];
  const concurrentTagWrites = new Map<
    string,
    (tags: ReadonlyArray<string>) => ReadonlyArray<string>
  >();
  const log: FakeZeropsRequest[] = [];
  let issued = 0;

  const issueSession = (userId: string): ZeropsSession => {
    const n = ++issued;
    const session = { accessToken: `access-${n}`, refreshToken: `refresh-${n}` };
    accessTokens.set(session.accessToken, { userId, refreshToken: session.refreshToken });
    refreshTokens.set(session.refreshToken, userId);
    return session;
  };

  const projectsOf = (clientId: string) =>
    [...projects.values()].filter((project) => project.clientId === clientId);
  const memberOf = (userId: string, clientId: string | undefined) =>
    accounts.get(userId)?.user.clientUserList?.some((m) => m.clientId === clientId) === true;

  const handle = (request: FakeZeropsRequest): Response => {
    const bearer = request.token === null ? undefined : accessTokens.get(request.token)?.userId;
    const projectList = /^GET \/client\/([^/]+)\/project$/.exec(request.route);
    if (projectList !== null) {
      if (bearer === undefined) return failure(401, "unauthorized");
      if (!memberOf(bearer, projectList[1])) return failure(403, "forbidden");
      const list = projectsOf(projectList[1]!);
      return json(200, { list, total: list.length });
    }
    const projectRoute = /^(GET|PUT) \/project\/([^/]+)$/.exec(request.route);
    if (projectRoute !== null) {
      const [, method, projectId] = projectRoute;
      if (bearer === undefined) return failure(401, "unauthorized");
      const failed = projectFailures.get(projectId!);
      if (failed !== undefined) return failure(failed, PROJECT_FAILURE_CODES[failed]);
      const project = projects.get(projectId!);
      if (project === undefined) return failure(404, "projectNotFound");
      if (!memberOf(bearer, project.clientId)) return failure(403, "forbidden");
      if (method === "GET") return json(200, project);
      const concurrent = concurrentTagWrites.get(projectId!);
      concurrentTagWrites.delete(projectId!);
      const current =
        concurrent === undefined
          ? project
          : { ...project, tagList: concurrent(project.tagList ?? []) };
      const updated = { ...current, ...(request.body as Partial<ZeropsProject>) };
      projects.set(projectId!, updated);
      return json(200, updated);
    }
    const tokenRoute = /^(POST|DELETE) \/client\/([^/]+)\/integration-token(?:\/([^/]+))?$/.exec(
      request.route,
    );
    if (tokenRoute !== null) {
      const [, method, clientId, tokenId] = tokenRoute;
      if (bearer === undefined) return failure(401, "unauthorized");
      if (!memberOf(bearer, clientId)) return failure(403, "forbidden");
      if (method === "POST" && tokenId === undefined) {
        const id = `integration-${integrationTokens.length + 1}`;
        integrationTokens.push({
          id,
          clientId: clientId!,
          mintedWith: request.token!,
          deletedWith: null,
        });
        return json(200, { id, token: `${id}-value` });
      }
      const index = integrationTokens.findIndex(
        (token) => token.id === tokenId && token.deletedWith === null,
      );
      if (method !== "DELETE" || index < 0) return failure(404, "integrationTokenNotFound");
      integrationTokens[index] = { ...integrationTokens[index]!, deletedWith: request.token! };
      return json(204, null);
    }
    switch (request.route) {
      case "POST /auth/login": {
        const { email, password } = request.body as { email: string; password: string };
        const account = [...accounts.values()].find(({ user }) => user.email === email);
        // Measured for an account that does not exist; a wrong password is modelled alike.
        if (account === undefined || account.password !== password)
          return failure(400, "userNotFound");
        if (account.totp === null)
          return json(200, { auth: issueSession(account.user.id), user: account.user });
        const accessToken = `half-${++issued}`;
        halfTokens.set(accessToken, account.user.id);
        return json(200, {
          auth: { accessToken, twoFAMethods: ["TOTP"], twoFAVerified: false },
          user: null,
        });
      }
      case "POST /2fa/totp/login": {
        const userId = request.token === null ? undefined : halfTokens.get(request.token);
        if (userId === undefined) return failure(401, "unauthorized");
        if ((request.body as { token: string }).token !== accounts.get(userId)?.totp)
          return failure(400, "invalidTotpToken");
        halfTokens.delete(request.token!);
        return json(200, {
          auth: { ...issueSession(userId), twoFAMethods: ["TOTP"], twoFAVerified: true },
        });
      }
      case "POST /auth/refresh": {
        const { refreshTokenId } = request.body as { refreshTokenId: string };
        const userId = refreshTokens.get(refreshTokenId);
        if (userId === undefined) return failure(401, "unauthorized");
        refreshTokens.delete(refreshTokenId);
        refreshes += 1;
        // `/auth/refresh` answers with the session at the top level.
        return json(200, issueSession(userId));
      }
      case "POST /auth/logout": {
        const session = request.token === null ? undefined : accessTokens.get(request.token);
        if (session === undefined) return failure(401, "unauthorized");
        accessTokens.delete(request.token!);
        refreshTokens.delete(session.refreshToken);
        return json(200, {});
      }
      case "GET /user/info": {
        const account = bearer === undefined ? undefined : accounts.get(bearer);
        return account === undefined ? failure(401, "unauthorized") : json(200, account.user);
      }
    }
    return failure(404, "routeNotFound");
  };

  const send = async (
    tab: Pick<HarnessTab, "id" | "signals"> | null,
    input: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (tab !== null && !tab.signals.state().online) throw new TypeError("Failed to fetch");
    const url = new URL(input);
    const path = url.pathname.slice(PUBLIC_API_PREFIX.length);
    const authorization = new Headers(init.headers).get("Authorization");
    const request: FakeZeropsRequest = {
      route: `${init.method ?? "GET"} ${path}`,
      token: authorization?.replace(/^Bearer /, "") ?? null,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      tab: tab?.id ?? null,
    };
    log.push(request);
    if (hanging.has(request.route))
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("The request was aborted.", "AbortError"));
        if (init.signal?.aborted === true) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      });
    const held = holds.get(request.route);
    if (held === undefined) return handle(request);
    const answer = await new Promise<Answer>((resolve) => held.push(resolve));
    return answer(request);
  };

  return {
    fetch: (input, init) => send(null, input, init),
    fetchFor: (tab) => (input, init) => send(tab, input, init),
    addUser: ({ user, password, totp }) => {
      accounts.set(user.id, { user, password, totp: totp ?? null });
    },
    addProject: (project) => {
      projects.set(project.id, project);
    },
    issueSession,
    expireAccessToken: (accessToken) => {
      accessTokens.delete(accessToken);
    },
    refreshes: () => refreshes,
    hold: (route) => {
      const waiting: Array<(answer: Answer) => void> = [];
      holds.set(route, waiting);
      const settle = (answer: Answer) => {
        if (holds.get(route) === waiting) holds.delete(route);
        for (const resume of waiting.splice(0)) resume(answer);
      };
      return {
        waiting: () => waiting.length,
        release: () => settle(handle),
        fail: (status) => settle(() => failure(status, "heldRoundFailed")),
      };
    },
    hang: (route) => {
      hanging.add(route);
      return () => {
        hanging.delete(route);
      };
    },
    writeTagsConcurrently: (projectId, write) => {
      concurrentTagWrites.set(projectId, write);
    },
    project: (projectId) => projects.get(projectId),
    projectsOf,
    integrationTokens: () => [...integrationTokens],
    orphanTokens: () => integrationTokens.filter(({ deletedWith }) => deletedWith === null),
    failProject: (projectId, status) => {
      if (status === null) projectFailures.delete(projectId);
      else projectFailures.set(projectId, status);
    },
    requests: () => [...log],
  };
}
