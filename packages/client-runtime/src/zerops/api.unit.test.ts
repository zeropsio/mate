import { ZeropsUserId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { ZeropsApiError } from "./errors.ts";
import {
  type FetchImplementation,
  ZeropsApiClient,
  readsAsEnabled,
  zeropsClientsFromUser,
  zeropsInvitationsFromUser,
} from "./api.ts";
import { createProject } from "./api/project.ts";
import { servicePortOrigin } from "./containerAddress.ts";

const project = {
  id: "p1",
  name: "z3-eval",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "26a7",
};
const service = { id: "s1", name: "weatherdash", status: "ACTIVE", subdomainAccess: true };

// witness: packages/client-runtime/src/zerops/containerAddress.ts | return port.port === 80 → return port.port !== 80
it("ZV9: A service port's public origin carries no port segment on port 80 and its own port on every other port, as Zerops serves them", () => {
  expect(servicePortOrigin(project, service, { port: 80, scheme: "http" })).toBe(
    "https://weatherdash-26a7.prg1.zerops.app",
  );
  expect(
    servicePortOrigin(project, { ...service, name: "zcp" }, { port: 8080, scheme: "http" }),
  ).toBe("https://zcp-26a7-8080.prg1.zerops.app");
});

// witness: packages/client-runtime/src/zerops/containerAddress.ts | if (service.subdomainAccess !== true) return undefined; → if (service.subdomainAccess === undefined) return undefined;
it("ZV10: A port has no public origin when its service's subdomain access is off, its scheme is not HTTP, or its project has no public subdomain", () => {
  const port = { port: 80, scheme: "http" };
  expect(servicePortOrigin(project, { ...service, subdomainAccess: false }, port)).toBeUndefined();
  expect(servicePortOrigin(project, service, { port: 3306, scheme: "mysql" })).toBeUndefined();
  expect(
    servicePortOrigin({ id: "p1", name: "z3-eval", status: "ACTIVE" }, service, port),
  ).toBeUndefined();
});

const user = {
  id: ZeropsUserId.make("user-1"),
  email: "a@b.c",
  clientUserList: [
    {
      id: "cu-1",
      clientId: "org-1",
      status: "ACTIVE",
      roleCode: "OWNER",
      client: { id: "org-1", accountName: "Example Org" },
    },
    {
      id: "cu-2",
      clientId: "org-2",
      status: "ACTIVE",
      roleCode: "NO_ACCESS",
      canCreateProjects: true,
      canViewFinances: false,
      client: { id: "org-2", accountName: "Second" },
    },
    { id: "cu-3", clientId: "org-3", status: "INACTIVE" },
    { id: "cu-4", clientId: "org-1", status: "ACTIVE" },
    {
      id: "cu-5",
      clientId: "org-4",
      status: "WAITING_AUTHORIZATION",
      client: { id: "org-4", accountName: "Fourth" },
    },
  ],
};

// witness: packages/client-runtime/src/zerops/api.ts | if (membership.status && membership.status !== "ACTIVE") continue; → if (membership.status === "INACTIVE") continue;
it("ZV11: An account's organizations are those it is an active member of, each once; an inactive membership or an invitation still waiting is not one of them", () => {
  expect(zeropsClientsFromUser(user).map((org) => org.id)).toEqual(["org-1", "org-2"]);
});

// witness: packages/client-runtime/src/zerops/api.ts | membershipId: membership.id, → membershipId: id,
it("ZV12: Each of the account's organizations carries the account's own membership in it: that membership's id, its role and the rights it states", () => {
  const organizations = zeropsClientsFromUser(user);
  expect(organizations[0]).toEqual({
    id: "org-1",
    membershipId: "cu-1",
    name: "Example Org",
    roleCode: "OWNER",
  });
  expect(organizations[1]).toMatchObject({
    id: "org-2",
    membershipId: "cu-2",
    roleCode: "NO_ACCESS",
    canCreateProjects: true,
    canViewFinances: false,
  });
});

// witness: packages/client-runtime/src/zerops/api.ts | if (!id || joined.has(id) || seen.has(id)) continue; → if (!id || seen.has(id)) continue;
it("ZV13: An organization is offered as an invitation only while the account's membership in it waits for authorization and the account is not already an active member of it, each organization once", () => {
  const invitations = zeropsInvitationsFromUser({
    id: ZeropsUserId.make("user-1"),
    email: "a@b.c",
    clientUserList: [
      { id: "cu-1", clientId: "org-1", status: "ACTIVE" },
      {
        id: "cu-5",
        clientId: "org-4",
        status: "WAITING_AUTHORIZATION",
        client: { id: "org-4", accountName: "Fourth" },
      },
      { id: "cu-6", clientId: "org-1", status: "WAITING_AUTHORIZATION" },
      { id: "cu-7", clientId: "org-4", status: "WAITING_AUTHORIZATION" },
    ],
  });
  expect(invitations).toEqual([{ id: "org-4", name: "Fourth" }]);
});

// witness: packages/client-runtime/src/zerops/api.ts | const normalized = value.trim().toLowerCase(); → const normalized = value.trim();
it("ZV14: A Mate flag typed into a service's variables reads as on for 1 or true in any letter case and with surrounding space, and as off for every other spelling", () => {
  for (const value of ["1", "true", "TRUE", " True "]) {
    expect(readsAsEnabled(value), value).toBe(true);
  }
  for (const value of ["0", "false", "yes", "on", ""]) {
    expect(readsAsEnabled(value), value).toBe(false);
  }
});

// witness: packages/client-runtime/src/zerops/api.ts | if (/^\d+$/u.test(value)) return Math.min(RETRY_AFTER_CAP_MS, Number(value) * 1000); → if (/^\d+$/u.test(value)) return Number(value) * 1000;
it("ZV15: A throttled Zerops answer tells its caller to wait as long as its Retry-After asks in seconds, never longer than ten minutes, and not at all when it asks nothing readable", async () => {
  async function expectRetryAfter(headers: Record<string, string>, retryAfterMs: number | null) {
    const client = new ZeropsApiClient({
      fetch: async () => new Response("{}", { status: 429, headers }),
    });
    client.restoreSession({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 432_000,
      userId: "user-1",
    });
    const result = await client.listClientProjects("org-1").catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ZeropsApiError);
    expect(result).toMatchObject({ retryAfterMs });
  }

  await expectRetryAfter({ "Retry-After": "12" }, 12_000);
  await expectRetryAfter({ "Retry-After": "86400" }, 600_000);
  await expectRetryAfter({ "Retry-After": "soon" }, null);
  await expectRetryAfter({}, null);
});

/** A request as the platform received it. */
interface Received {
  readonly method: string;
  readonly origin: string;
  /** The path under the public API prefix. */
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

/** A Zerops platform answering each request with `answer`, keeping every request it received. */
function zeropsPlatform(answer: (request: Received) => Response | Promise<Response>) {
  const received: Received[] = [];
  const respond: FetchImplementation = async (url, init) => {
    const address = new URL(url);
    const request: Received = {
      method: init?.method ?? "GET",
      origin: address.origin,
      path: address.pathname.replace(/^\/api\/rest\/public/u, ""),
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
    };
    received.push(request);
    return answer(request);
  };
  return { received, respond };
}

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const session = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 432_000,
  userId: "user-1",
};

function signedIn(respond: FetchImplementation): ZeropsApiClient {
  const client = new ZeropsApiClient({ fetch: respond });
  client.restoreSession(session);
  return client;
}

const writesOf = (received: ReadonlyArray<Received>) =>
  received.filter((request) => request.method === "PUT" || request.method === "DELETE");

/** What a call failed with; its answer where it did not fail, for the assertion to refuse. */
const failureOf = (call: Promise<unknown>): Promise<unknown> =>
  call.catch((error: unknown) => error);

// witness: packages/client-runtime/src/zerops/api.ts | service.activeAppVersion !== null → service.activeAppVersion === undefined
it("ZV104: Deploying a Mate with no deployment never replaces a deployment or invents settings, and a missing receipt stays uncertain", async () => {
  const savedSetup =
    "build:\n  base: ubuntu@22.04\nrun:\n  base: zcp@1\n  ports:\n    - port: 8080\n";
  const settings = [
    { key: "ZEROPS_YAML", content: savedSetup },
    { key: "VSCODE_PASSWORD", content: "kept-password" },
  ];
  function mate(input: {
    readonly activeAppVersion: { readonly id: string } | null;
    readonly env: ReadonlyArray<{ readonly key: string; readonly content: string }>;
    readonly receipt: unknown;
  }) {
    const platform = zeropsPlatform(({ method, path }) => {
      if (path === "/service-stack/s1/env") return reply(200, { items: input.env });
      if (method === "PUT") return reply(200, input.receipt);
      return reply(200, {
        id: "s1",
        name: "zcp",
        status: "READY_TO_DEPLOY",
        base: "zcp@1",
        activeAppVersion: input.activeAppVersion,
      });
    });
    return { client: signedIn(platform.respond), received: platform.received };
  }

  const deployed = mate({
    activeAppVersion: { id: "version-1" },
    env: settings,
    receipt: { process: { id: "process-1" } },
  });
  expect(await failureOf(deployed.client.deployMate("s1"))).toBeInstanceOf(ZeropsApiError);
  expect(writesOf(deployed.received)).toEqual([]);

  const unsaved = mate({
    activeAppVersion: null,
    env: [{ key: "VSCODE_PASSWORD", content: "kept-password" }],
    receipt: { process: { id: "process-1" } },
  });
  expect(await failureOf(unsaved.client.deployMate("s1"))).toBeInstanceOf(ZeropsApiError);
  expect(writesOf(unsaved.received)).toEqual([]);

  const unreceipted = mate({ activeAppVersion: null, env: settings, receipt: {} });
  expect(await failureOf(unreceipted.client.deployMate("s1"))).toMatchObject({ kind: "uncertain" });
  expect(writesOf(unreceipted.received).map((request) => request.path)).toEqual([
    "/service-stack/s1/trigger-pipeline",
  ]);
});

// witness: packages/client-runtime/src/zerops/api.ts | this.#baseUrl = (options.baseUrl ?? DEFAULT_ZEROPS_API_BASE).replace(/\/+$/, ""); → this.#baseUrl = DEFAULT_ZEROPS_API_BASE;
it("ZV105: The Zerops token is sent only to the configured API base", async () => {
  const platform = zeropsPlatform(() =>
    reply(200, { id: "user-1", email: "a@b.c", clientUserList: [], list: [], total: 0 }),
  );
  const client = new ZeropsApiClient({
    fetch: platform.respond,
    baseUrl: "https://api.app-fra1.zerops.io/",
  });
  client.restoreSession(session);

  await client.fetchUser();
  await client.listClientProjects("org-1");

  expect(platform.received.map((request) => [request.origin, request.authorization])).toEqual([
    ["https://api.app-fra1.zerops.io", "Bearer access-1"],
    ["https://api.app-fra1.zerops.io", "Bearer access-1"],
  ]);
});

// witness: packages/client-runtime/src/zerops/api.ts | const foundBy = keyTokenId === undefined ? "name" : "id"; → const foundBy = "id";
it("ZV106: Hardening lowers only the key its Mate named for its own project and leaves a key that reads another project", async () => {
  function organization(tokens: {
    readonly listed: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly projects: unknown;
    }>;
    readonly read: Readonly<Record<string, unknown>>;
  }) {
    const platform = zeropsPlatform(({ method, path }) => {
      if (path === "/project/p1/service-stack") return reply(200, { list: [] });
      if (path === "/client/org-1/integration-token/list")
        return reply(200, { list: tokens.listed });
      if (path.endsWith("/delegation")) return reply(200, { list: [] });
      const tokenId = /^\/client\/org-1\/integration-token\/([^/]+)$/u.exec(path)?.[1];
      if (method === "GET" && tokenId !== undefined) return reply(200, tokens.read[tokenId]);
      return reply(200, {});
    });
    const client = new ZeropsApiClient({
      fetch: platform.respond,
      holdToken: (_tokenId, run) => run(),
    });
    client.restoreSession(session);
    return { client, received: platform.received };
  }

  // The Mate named its key: that key alone is lowered to its own project, another key left.
  const mateKey = {
    id: "key-mate",
    name: "zerops-zcp-zcp",
    projects: [{ projectId: "p1", roleCode: "ADMIN" }],
  };
  const otherKey = {
    id: "key-other",
    name: "zcp-p1",
    projects: [{ projectId: "p1", roleCode: "ADMIN" }],
  };
  const named = organization({
    listed: [mateKey, otherKey],
    read: { "key-mate": mateKey, "key-other": otherKey },
  });
  await named.client.hardenMate("org-1", "p1", undefined, undefined, "key-mate");
  expect(
    writesOf(named.received).map((request) => [
      request.path,
      (request.body as { readonly projects?: unknown }).projects,
    ]),
  ).toEqual([
    ["/client/org-1/integration-token/key-mate", [{ projectId: "p1", roleCode: "BASIC_USER" }]],
  ]);

  // Found by its name, a key that reads another project when it is read is left as it is.
  const listedKey = {
    id: "key-1",
    name: "zcp-p1",
    projects: [{ projectId: "p1", roleCode: "ADMIN" }],
  };
  const unnamed = organization({
    listed: [listedKey],
    read: {
      "key-1": {
        ...listedKey,
        projects: [
          { projectId: "p1", roleCode: "ADMIN" },
          { projectId: "p2", roleCode: "READ_ONLY" },
        ],
      },
    },
  });
  const result = await unnamed.client.hardenMate("org-1", "p1");
  expect(result.tokenLowered).toBe(false);
  expect(writesOf(unnamed.received)).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/api.ts | if (generation !== this.#generation) { → if (generation > this.#generation) {
it("ZV107: A login answer or read arriving after a local sign-out never signs in or signs out the next account", async () => {
  const answers: Array<(response: Response) => void> = [];
  const client = new ZeropsApiClient({
    fetch: () => new Promise<Response>((resolve) => answers.push(resolve)),
  });

  const login = client.login("a@b.c", "password");
  await client.signOutLocally();
  answers[0]!(reply(200, { auth: { accessToken: "access-late", refreshToken: "refresh-late" } }));
  expect(await failureOf(login)).toMatchObject({ kind: "expired-session" });
  expect(client.session).toBeNull();

  client.restoreSession(session);
  const read = client.fetchUser();
  await client.signOutLocally();
  client.restoreSession({ accessToken: "access-next" });
  answers[1]!(reply(401, { error: { code: "notAuthorized" } }));
  expect(await failureOf(read)).toMatchObject({ kind: "expired-session" });
  expect(client.session?.accessToken).toBe("access-next");
});

// witness: packages/client-runtime/src/zerops/api.ts | const mayHaveWritten = options.mayHaveWritten ?? mutatesProject; → const mayHaveWritten = options.mayHaveWritten ?? false;
it("ZV108: A lost project-creation answer is uncertain and never resent, and a write given up during a token renewal is never sent", async () => {
  const lost = zeropsPlatform(() => Promise.reject(new TypeError("connection lost")));
  expect(
    await failureOf(
      createProject(signedIn(lost.respond).door, { clientId: "org-1", name: "Shop", tagList: [] }),
    ),
  ).toMatchObject({ kind: "uncertain" });
  expect(lost.received.map((request) => [request.method, request.path])).toEqual([
    ["POST", "/client/org-1/project"],
  ]);

  const renewal = Promise.withResolvers<Response>();
  const renewalAsked = Promise.withResolvers<void>();
  const renewing = zeropsPlatform(({ path }) => {
    if (path !== "/auth/refresh") return reply(200, {});
    renewalAsked.resolve();
    return renewal.promise;
  });
  const nowMs = Date.parse("2026-11-20T12:00:00Z");
  const client = new ZeropsApiClient({
    fetch: renewing.respond,
    renewAhead: { withinMs: 10 * 60_000, nowMs: () => nowMs },
  });
  client.restoreSession({ ...session, expiresAt: "2026-11-20T12:01:00Z" });
  const giveUp = new AbortController();
  const write = client.requestData({
    path: "/service-stack/s1/restart",
    method: "PUT",
    operationKind: "project-write",
    signal: giveUp.signal,
    background: false,
  });
  await renewalAsked.promise;
  giveUp.abort();
  expect(await failureOf(write)).toMatchObject({ name: "AbortError" });
  renewal.resolve(reply(200, { ...session, accessToken: "access-2", refreshToken: "refresh-2" }));
  await client.renewHeldSession();
  expect(writesOf(renewing.received)).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/api.ts | if (seen.has(project.id)) throw incomplete(); → if (seen.has(project.id)) continue;
it("ZV109: An inventory is published only after every page; a short or repeated page is a failure", async () => {
  const project = (id: string) => ({ id, name: id, status: "ACTIVE", clientId: "org-1" });
  function inventory(
    pages: ReadonlyArray<{ readonly ids: ReadonlyArray<string>; readonly total: number }>,
  ) {
    let page = 0;
    const platform = zeropsPlatform(() => {
      const next = pages[page] ?? { ids: [], total: pages[0]?.total ?? 0 };
      page += 1;
      return reply(200, { list: next.ids.map(project), total: next.total });
    });
    return signedIn(platform.respond).listClientProjects("org-1", { limit: 1 });
  }

  const whole = await inventory([
    { ids: ["p1"], total: 2 },
    { ids: ["p2"], total: 2 },
  ]);
  expect(whole.map((entry) => entry.id)).toEqual(["p1", "p2"]);

  expect(
    await failureOf(
      inventory([
        { ids: ["p1"], total: 3 },
        { ids: ["p2"], total: 3 },
        { ids: [], total: 3 },
      ]),
    ),
  ).toBeInstanceOf(ZeropsApiError);
  expect(
    await failureOf(
      inventory([
        { ids: ["p1"], total: 2 },
        { ids: ["p1"], total: 2 },
        { ids: ["p2"], total: 2 },
      ]),
    ),
  ).toBeInstanceOf(ZeropsApiError);
});

// witness: packages/client-runtime/src/zerops/api.ts | if (this.#refreshPromise) return this.#refreshPromise; →
it("ZV110: Parallel requests refused for an expired token share one refresh", async () => {
  // A refresh token renews once: the platform refuses it spent.
  const spent = new Set<string>();
  const platform = zeropsPlatform(({ path, authorization, body }) => {
    if (path === "/auth/refresh") {
      const { refreshTokenId } = body as { readonly refreshTokenId: string };
      if (spent.has(refreshTokenId)) return reply(400, { error: { code: "refreshTokenInvalid" } });
      spent.add(refreshTokenId);
      return reply(200, { ...session, accessToken: "access-2", refreshToken: "refresh-2" });
    }
    return authorization === "Bearer access-2"
      ? reply(200, { id: "user-1", email: "a@b.c", clientUserList: [] })
      : reply(401, { error: { code: "notAuthorized" } });
  });
  const client = signedIn(platform.respond);

  const reads = await Promise.allSettled([
    client.fetchUser(),
    client.fetchUser(),
    client.fetchUser(),
  ]);

  expect(reads.map((read) => read.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
  expect(platform.received.filter((request) => request.path === "/auth/refresh")).toHaveLength(1);
  expect(client.session?.accessToken).toBe("access-2");
});

// witness: packages/client-runtime/src/zerops/api.ts | publicIpV4Shared: input.publicIpV4Shared ?? false, → publicIpV4Shared: false,
it("ZV111: Writing a project sends its name and the fields a write would reset, never people's roles", async () => {
  const project = {
    id: "p1",
    name: "Fen",
    status: "ACTIVE",
    clientId: "org-1",
    description: "The billing team's Mate",
    tagList: ["team:billing"],
    publicIpV4Shared: true,
    maxCreditLimit: 25,
    userRoles: [{ clientUserId: "cu-1", roleCode: "OWNER" }],
  };
  const platform = zeropsPlatform(() => reply(200, project));

  await signedIn(platform.respond).writeProject(project, {
    name: "Nova",
    tagList: ["team:billing", "mate"],
  });

  expect(platform.received.map((request) => [request.method, request.path, request.body])).toEqual([
    [
      "PUT",
      "/project/p1",
      {
        name: "Nova",
        description: "The billing team's Mate",
        tagList: ["team:billing", "mate"],
        publicIpV4Shared: true,
        maxCreditLimit: 25,
      },
    ],
  ]);
});
