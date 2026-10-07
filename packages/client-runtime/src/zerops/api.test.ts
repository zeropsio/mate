import { describe, expect, it, vi } from "@effect/vitest";

import {
  DEFAULT_ZEROPS_API_BASE,
  ZeropsApiClient,
  ZeropsApiError,
  parseRetryAfterMs,
  servicePortOrigin,
  zeropsClientsFromUser,
  type ZeropsProject,
  type ZeropsService,
} from "./api.ts";
import { requiresZeropsTwoFactor, type ZeropsSession } from "./session.ts";

const SESSION: ZeropsSession = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 432_000,
  userId: "user-1",
};

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly body: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(handler: (request: RecordedRequest) => Response | Promise<Response>): {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly requests: ReadonlyArray<RecordedRequest>;
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      const recorded: RecordedRequest = {
        url: input,
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
        body: typeof init?.body === "string" ? init.body : null,
      };
      requests.push(recorded);
      return handler(recorded);
    },
  };
}

describe("servicePortOrigin", () => {
  const project: ZeropsProject = {
    id: "p1",
    name: "z3-eval",
    status: "ACTIVE",
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "26a7",
  };
  const service: ZeropsService = {
    id: "s1",
    name: "weatherdash",
    status: "ACTIVE",
    subdomainAccess: true,
  };

  /**
   * Measured (z3-eval, 2026-09-04): port 80 carries NO port segment in the
   * origin — `https://weatherdash-26a7.prg1.zerops.app/` is 200,
   * `https://weatherdash-26a7-80.prg1.zerops.app/` is 502.
   */
  it("composes the origin for a subdomain-enabled http port on 80 with no port segment", () => {
    expect(servicePortOrigin(project, service, { port: 80, scheme: "http" })).toBe(
      "https://weatherdash-26a7.prg1.zerops.app",
    );
  });

  /**
   * Measured the same day: a non-default port keeps its segment —
   * `https://zcp-26a7-8080.prg1.zerops.app/` is 200,
   * `https://zcp-26a7.prg1.zerops.app/` is 502.
   */
  it("composes the origin for a subdomain-enabled http port on a non-default port with the port segment", () => {
    expect(
      servicePortOrigin(project, { ...service, name: "zcp" }, { port: 8080, scheme: "http" }),
    ).toBe("https://zcp-26a7-8080.prg1.zerops.app");
  });

  it("has no origin when the service's subdomain access is off", () => {
    expect(
      servicePortOrigin(
        project,
        { ...service, subdomainAccess: false },
        { port: 80, scheme: "http" },
      ),
    ).toBeUndefined();
  });

  it("has no origin for a non-http port even when subdomain access is on", () => {
    expect(servicePortOrigin(project, service, { port: 3306, scheme: "mysql" })).toBeUndefined();
  });

  it("has no origin when the project carries no public subdomain", () => {
    expect(
      servicePortOrigin({ id: "p1", name: "z3-eval", status: "ACTIVE" }, service, {
        port: 80,
        scheme: "http",
      }),
    ).toBeUndefined();
  });
});

describe("zeropsClientsFromUser", () => {
  it("reads every active org in clientUserList, not only the first", () => {
    const clients = zeropsClientsFromUser({
      id: "user-1",
      email: "a@b.c",
      clientUserList: [
        {
          id: "cu-1",
          clientId: "org-1",
          status: "ACTIVE",
          roleCode: "OWNER",
          client: { id: "org-1", accountName: "KRLS" },
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
        {
          id: "cu-3",
          clientId: "org-3",
          status: "INACTIVE",
          client: { id: "org-3", accountName: "Gone" },
        },
        {
          id: "cu-4",
          clientId: "org-1",
          status: "ACTIVE",
          client: { id: "org-1", accountName: "KRLS dup" },
        },
      ],
    });
    expect(clients.map((client) => client.id)).toEqual(["org-1", "org-2"]);
    expect(clients[0]?.name).toBe("KRLS");
    expect(clients[0]?.roleCode).toBe("OWNER");
    expect(clients[1]).toMatchObject({
      membershipId: "cu-2",
      roleCode: "NO_ACCESS",
      canCreateProjects: true,
      canViewFinances: false,
    });
  });
});

describe("ZeropsApiClient authentication", () => {
  it("coalesces three parallel 401s into exactly one refresh", async () => {
    let refreshCalls = 0;
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse(200, {
          accessToken: "access-2",
          refreshToken: "refresh-2",
          expiresIn: 432_000,
          userId: "user-1",
        });
      }
      if (request.authorization === "Bearer access-1") {
        return jsonResponse(401, { code: "notAuthorized" });
      }
      return jsonResponse(200, { id: "user-1", email: "a@b.c", clientUserList: [] });
    });

    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const users = await Promise.all([client.fetchUser(), client.fetchUser(), client.fetchUser()]);

    expect(users.map((user) => user.id)).toEqual(["user-1", "user-1", "user-1"]);
    expect(refreshCalls).toBe(1);
    expect(client.session?.accessToken).toBe("access-2");
  });

  // A Mate's deletion takes its project first, and the key that held only that project is gone with
  // it: the platform answers its delete `400 clientUserConnectionNotFound` (measured live 4/4,
  // 2026-10-05), as it answers a read of any token already deleted. That answer is the delete done;
  // every other refusal stays the caller's failure.
  it.each([
    {
      case: "a token the platform no longer has is deleted already",
      status: 400,
      body: {
        error: {
          code: "clientUserConnectionNotFound",
          message: "Client user connection not found.",
        },
      },
      deleted: true,
    },
    {
      case: "another not-found is not taken for the token's",
      status: 400,
      body: { error: { code: "projectNotFound", message: "Project not found." } },
      deleted: false,
    },
    {
      case: "a malformed request stays a failure",
      status: 400,
      body: { error: { code: "invalidUserInput", message: "Invalid user input." } },
      deleted: false,
    },
    {
      case: "a refusal stays a failure",
      status: 403,
      body: {
        error: {
          code: "clientUserConnectionNotFound",
          message: "Client user connection not found.",
        },
      },
      deleted: false,
    },
  ])("deleting a token: $case", async ({ status, body, deleted }) => {
    const stub = recordingFetch(() => jsonResponse(status, body));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const outcome = client.deleteIntegrationToken({ clientId: "org-1", tokenId: "token-1" });

    if (deleted) await expect(outcome).resolves.toBeUndefined();
    else await expect(outcome).rejects.toBeInstanceOf(ZeropsApiError);
  });

  it("remembers the user it last read for this session, and forgets it with the session", async () => {
    vi.useFakeTimers({ now: 5_000 });
    try {
      const stub = recordingFetch(() =>
        jsonResponse(200, { id: "user-1", email: "a@b.c", clientUserList: [] }),
      );
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);
      expect(client.verifiedUser()).toBe(null);

      await client.fetchUser();
      expect(client.verifiedUser()).toMatchObject({ user: { id: "user-1" }, atMs: 5_000 });

      client.forgetSession();
      expect(client.verifiedUser()).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews through the renewal hook and holds a session it hands back without storing it again", async () => {
    const renewedElsewhere: ZeropsSession = { accessToken: "access-9", refreshToken: "refresh-9" };
    const stub = recordingFetch((request) =>
      request.authorization === "Bearer access-9"
        ? jsonResponse(200, { id: "user-1", email: "a@b.c", clientUserList: [] })
        : jsonResponse(401, { code: "notAuthorized" }),
    );
    const stale: ZeropsSession[] = [];
    const stored: Array<ZeropsSession | null> = [];
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
      renewSession: async (held) => {
        stale.push(held);
        return renewedElsewhere;
      },
    });
    client.restoreSession(SESSION);

    const user = await client.fetchUser();

    expect(user.id).toBe("user-1");
    expect(stale).toEqual([SESSION]);
    expect(stub.requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/api/rest/public/user/info",
      "/api/rest/public/user/info",
    ]);
    expect(client.session).toBe(renewedElsewhere);
    expect(stored).toEqual([]);
  });

  it("refreshes over the network only when the renewal hook runs the refresh it is given", async () => {
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/auth/refresh"))
        return jsonResponse(200, { accessToken: "access-2", refreshToken: "refresh-2" });
      return request.authorization === "Bearer access-2"
        ? jsonResponse(200, { id: "user-1", email: "a@b.c", clientUserList: [] })
        : jsonResponse(401, { code: "notAuthorized" });
    });
    const inside: string[] = [];
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      renewSession: async (_held, refresh) => {
        inside.push("enter");
        const renewed = await refresh();
        inside.push(`leave ${renewed.accessToken}`);
        return renewed;
      },
    });
    client.restoreSession(SESSION);

    await client.fetchUser();

    expect(inside).toEqual(["enter", "leave access-2"]);
    expect(client.session?.accessToken).toBe("access-2");
  });

  it("keeps the held session and stores nothing when the renewal hook refuses", async () => {
    const stub = recordingFetch(() => jsonResponse(401, { code: "notAuthorized" }));
    const stored: Array<ZeropsSession | null> = [];
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
      renewSession: async () => {
        throw new ZeropsApiError("Another tab changed this session.", "expired-session", 401);
      },
    });
    client.restoreSession(SESSION);

    const error = await client.fetchUser().catch((cause: unknown) => cause);

    expect((error as ZeropsApiError).kind).toBe("expired-session");
    expect(client.session).toBe(SESSION);
    expect(stored).toEqual([]);
  });

  it("adopts another tab's renewed session without ending a request in flight", async () => {
    let answer!: (response: Response) => void;
    const stub = recordingFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const stored: Array<ZeropsSession | null> = [];
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });
    client.restoreSession(SESSION);
    const inFlight = client.fetchUser();
    await Promise.resolve();

    client.adoptRenewedSession({ accessToken: "access-2", refreshToken: "refresh-2" });
    answer(jsonResponse(200, { id: "user-1", email: "a@b.c", clientUserList: [] }));

    expect((await inFlight).id).toBe("user-1");
    expect(client.session?.accessToken).toBe("access-2");
    expect(stored).toEqual([]);
  });

  it("forgets a session another tab removed without clearing storage, and drops the answer in flight", async () => {
    let answer!: (response: Response) => void;
    const stub = recordingFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const stored: Array<ZeropsSession | null> = [];
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });
    client.restoreSession(SESSION);
    const inFlight = client.fetchUser().catch((cause: unknown) => cause);
    await Promise.resolve();

    client.forgetSession();
    answer(jsonResponse(200, { id: "user-1", email: "a@b.c", clientUserList: [] }));

    expect(await inFlight).toBeInstanceOf(ZeropsApiError);
    expect(client.session).toBeNull();
    expect(stored).toEqual([]);
  });

  it("calls globalThis.fetch bound to globalThis so a brand-checked implementation works", async () => {
    const originalFetch = globalThis.fetch;
    let calledWithGlobalThis = false;
    const brandChecked = function (this: unknown): Promise<Response> {
      calledWithGlobalThis = this === globalThis;
      if (!calledWithGlobalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(jsonResponse(200, { id: "user-1", email: "a@b.c" }));
    };
    globalThis.fetch = brandChecked as unknown as typeof globalThis.fetch;
    try {
      const client = new ZeropsApiClient();
      client.restoreSession(SESSION);
      await expect(client.fetchUser()).resolves.toMatchObject({ id: "user-1" });
      expect(calledWithGlobalThis).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps 403 to a forbidden error carrying the platform code, keeping the session", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(403, { error: { code: "insufficientPermissions", message: "nope" } }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const error = await client.fetchProject("project-1").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("forbidden");
    expect((error as ZeropsApiError).status).toBe(403);
    expect((error as ZeropsApiError).code).toBe("insufficientPermissions");
    // A 403 is about the resource, not the credential — staying signed in is the point.
    expect(client.session?.accessToken).toBe("access-1");
  });

  it("maps an unrefreshable 401 to an expired-session error and signs out", async () => {
    const stub = recordingFetch(() => jsonResponse(401, { error: { code: "notAuthorized" } }));
    const cleared: Array<ZeropsSession | null> = [];
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        cleared.push(session);
      },
    });
    client.restoreSession({ accessToken: "access-1" });

    const error = await client.fetchUser().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("expired-session");
    expect((error as ZeropsApiError).status).toBe(401);
    expect(client.session).toBeNull();
    expect(cleared).toEqual([null]);
  });

  it.each([
    [403, "forbidden"],
    [503, "server"],
  ] as const)(
    "keeps the current session when refresh fails with %s",
    async (refreshStatus, expectedKind) => {
      const changes: Array<ZeropsSession | null> = [];
      const stub = recordingFetch((request) =>
        request.url.endsWith("/auth/refresh")
          ? jsonResponse(refreshStatus, { error: { code: "refreshUnavailable" } })
          : jsonResponse(401, { error: { code: "notAuthorized" } }),
      );
      const client = new ZeropsApiClient({
        fetch: stub.fetch,
        onSessionChange: (session) => {
          changes.push(session);
        },
      });
      client.restoreSession(SESSION);

      const error = await client.fetchUser().catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ZeropsApiError);
      expect((error as ZeropsApiError).kind).toBe(expectedKind);
      expect(client.session).toEqual(SESSION);
      expect(changes).toEqual([]);
    },
  );

  it("keeps the current session when the refresh request cannot reach Zerops", async () => {
    const changes: Array<ZeropsSession | null> = [];
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/auth/refresh")) throw new TypeError("offline");
      return jsonResponse(401, { error: { code: "notAuthorized" } });
    });
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        changes.push(session);
      },
    });
    client.restoreSession(SESSION);

    const error = await client.fetchUser().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("network");
    expect(client.session).toEqual(SESSION);
    expect(changes).toEqual([]);
  });

  it.each([
    ["an explicit refresh 401", jsonResponse(401, { error: { code: "notAuthorized" } })],
    ["an invalid refresh response", jsonResponse(200, { refreshToken: "missing-access" })],
  ])("clears the current session after %s", async (_case, refreshResponse) => {
    const changes: Array<ZeropsSession | null> = [];
    const stub = recordingFetch((request) =>
      request.url.endsWith("/auth/refresh")
        ? refreshResponse.clone()
        : jsonResponse(401, { error: { code: "notAuthorized" } }),
    );
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        changes.push(session);
      },
    });
    client.restoreSession(SESSION);

    await expect(client.fetchUser()).rejects.toBeInstanceOf(ZeropsApiError);

    expect(client.session).toBeNull();
    expect(changes).toEqual([null]);
  });

  it("surfaces the platform's own message for a rejected sign-in", async () => {
    // Live shape, 2026-08-28: a bad sign-in is 400 `userNotFound`, never a 401,
    // so the client must not dress it up as an expired session.
    const stub = recordingFetch(() =>
      jsonResponse(400, {
        error: {
          code: "userNotFound",
          message: "User not found.",
          meta: [{ error: "User not found.", code: "userNotFound", metadata: null }],
        },
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    const error = await client
      .login("nobody@example.invalid", "wrong")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).message).toBe("User not found.");
    expect((error as ZeropsApiError).code).toBe("userNotFound");
    expect((error as ZeropsApiError).status).toBe(400);
    expect(client.session).toBeNull();
  });

  it("signals TOTP from twoFAMethods and posts the code to /2fa/totp/login", async () => {
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/auth/login")) {
        return jsonResponse(200, {
          auth: { accessToken: "half-1", twoFAMethods: ["TOTP"] },
          user: null,
        });
      }
      return jsonResponse(200, {
        auth: {
          accessToken: "access-9",
          refreshToken: "refresh-9",
          twoFAVerified: true,
          twoFAMethods: ["TOTP"],
        },
        user: { id: "user-1", email: "a@b.c" },
      });
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    const login = await client.login("a@b.c", "secret");
    expect(requiresZeropsTwoFactor(login.auth)).toBe(true);
    expect(client.session?.accessToken).toBe("half-1");

    const verified = await client.verifyTotp("123456");
    expect(verified.accessToken).toBe("access-9");
    expect(requiresZeropsTwoFactor(verified)).toBe(false);

    const totpRequest = stub.requests.at(-1);
    expect(totpRequest?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/2fa/totp/login`);
    expect(totpRequest?.method).toBe("POST");
    expect(totpRequest?.body).toBe(JSON.stringify({ token: "123456" }));
    expect(totpRequest?.authorization).toBe("Bearer half-1");
  });
});

describe("ZeropsApiClient.renewHeldSession — the data layer's one repair", () => {
  const renewing = (respond: () => Response | Promise<Response>, session: ZeropsSession) => {
    const stored: Array<ZeropsSession | null> = [];
    const client = new ZeropsApiClient({
      fetch: recordingFetch(respond).fetch,
      onSessionChange: (next) => {
        stored.push(next);
      },
    });
    client.restoreSession(session);
    return { client, stored };
  };

  it("ends the held session when the platform refuses its renewal", async () => {
    const { client, stored } = renewing(
      () => jsonResponse(401, { code: "notAuthorized" }),
      SESSION,
    );

    await expect(client.renewHeldSession()).rejects.toMatchObject({ kind: "expired-session" });

    expect(client.session).toBeNull();
    expect(stored).toEqual([null]);
  });

  it("ends a handed-over session, which no renewal can repair", async () => {
    const { client, stored } = renewing(() => jsonResponse(500, {}), { accessToken: "pat" });

    await expect(client.renewHeldSession()).rejects.toMatchObject({ kind: "expired-session" });

    expect(client.session).toBeNull();
    expect(stored).toEqual([null]);
  });

  it("keeps the held session when its renewal does not reach the platform", async () => {
    const { client, stored } = renewing(() => Promise.reject(new TypeError("offline")), SESSION);

    await expect(client.renewHeldSession()).rejects.toThrow("offline");

    expect(client.session).toEqual(SESSION);
    expect(stored).toEqual([]);
  });
});

describe("a throttled answer's Retry-After", () => {
  const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
  it.each<[string | null, number | null]>([
    ["7", 7_000],
    ["0", 0],
    ["Wed, 30 Sep 2026 12:00:30 GMT", 30_000],
    ["Wed, 30 Sep 2026 11:59:00 GMT", 0],
    ["600", 600_000],
    ["86400", 600_000],
    ["Thu, 01 Oct 2026 12:00:00 GMT", 600_000],
    ["soon", null],
    ["", null],
    [null, null],
  ])("%s → %s ms", (header, expected) => {
    expect(parseRetryAfterMs(header, NOW)).toBe(expected);
  });

  it("rides on the error of a 429", async () => {
    const client = new ZeropsApiClient({
      fetch: async () => new Response("{}", { status: 429, headers: { "Retry-After": "12" } }),
    });
    client.restoreSession(SESSION);
    const error = await client.listClientProjects("org-1").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).retryAfterMs).toBe(12_000);
  });
});

describe("ZeropsApiClient project reads", () => {
  it("lists a client's projects through the direct read, never the search index", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, {
        list: [{ id: "p1", name: "one", status: "ACTIVE", clientId: "org-1" }],
        totalCount: 1,
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const projects = await client.listClientProjects("org-1", { statuses: ["ACTIVE"] });

    expect(projects.map((project) => project.id)).toEqual(["p1"]);
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/client/org-1/project?limit=500&statuses=ACTIVE`,
    );
    expect(stub.requests.every((request) => !request.url.includes("/search"))).toBe(true);
  });

  it("sends the caller's signal with the user read and every project listing read, the search fallback's too", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const client = new ZeropsApiClient({
      fetch: async (input, init) => {
        signals.push(init?.signal);
        if (input.endsWith("/user/info")) return jsonResponse(200, { id: "user-1" });
        return input.includes("/client/org-dev/project")
          ? jsonResponse(403, {
              error: { code: "insufficientPermissions", message: "Insufficient permissions" },
            })
          : jsonResponse(200, { items: [], totalHits: 0 });
      },
    });
    client.restoreSession(SESSION);
    const { signal } = new AbortController();

    await client.fetchUser(signal);
    await client.listAccessibleClientProjects("org-dev", { signal });

    expect(signals).toEqual([signal, signal, signal]);
  });

  it("falls back to the permission-filtered project search for a restricted membership", async () => {
    const stub = recordingFetch((request) =>
      request.url.includes("/client/org-dev/project")
        ? jsonResponse(403, {
            error: { code: "insufficientPermissions", message: "Insufficient permissions" },
          })
        : jsonResponse(200, {
            items: [{ id: "assigned", name: "Assigned", status: "ACTIVE", clientId: "org-dev" }],
            totalHits: 1,
          }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const projects = await client.listAccessibleClientProjects("org-dev");

    expect(projects.map((project) => project.id)).toEqual(["assigned"]);
    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/client/org-dev/project?limit=500`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/search`,
    ]);
    expect(JSON.parse(stub.requests[1]?.body ?? "{}")).toEqual({
      limit: 500,
      search: [{ name: "clientId", operator: "eq", value: "org-dev" }],
    });
  });

  // A 403 there is the platform's final answer for the person (E2E 2026-10-03: asked again, it
  // answered 403 about 8 times a minute); a new account epoch may be somebody else.
  it("asks a restricted membership's direct list once, then only the search, until another account", async () => {
    const stub = recordingFetch((request) =>
      request.url.includes("/client/org-dev/project")
        ? jsonResponse(403, {
            error: { code: "insufficientPermissions", message: "Insufficient permissions" },
          })
        : jsonResponse(200, { items: [], totalHits: 0 }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.listAccessibleClientProjects("org-dev");
    await client.listAccessibleClientProjects("org-dev");
    client.restoreSession(SESSION);
    await client.listAccessibleClientProjects("org-dev");

    const direct = `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/client/org-dev/project?limit=500`;
    const search = `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/search`;
    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      direct,
      search,
      search,
      direct,
      search,
    ]);
  });

  it("scopes the project-variable read to the organization, which the platform requires", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, { items: [{ envList: [{ id: "e1", key: "K", content: "v" }] }] }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const entries = await client.readProjectEnv("org-1", "project-1");

    expect(entries.map((entry) => entry.id)).toEqual(["e1"]);
    // Without the `clientId` term the platform answers
    // `400 invalidUserInput` — "clientId not defined" — and the whole
    // isolation step of a Mate's creation fails (measured 2026-09-18).
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      limit: 1,
      search: [
        { name: "id", operator: "eq", value: "project-1" },
        { name: "clientId", operator: "eq", value: "org-1" },
      ],
    });
  });

  it("reports whether its plan restarted anything, for a wait that must not trust a stale boot", async () => {
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [
            {
              envList: [
                { id: "iso", key: "envIsolation", content: "none" },
                { id: "key", key: "ZCP_API_KEY", content: "secret", sensitive: false },
              ],
            },
          ],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.isolateProjectEnvironment("org-1", "project-1");

    expect(result.restarted).toBe(true);
    expect(result.steps).toBeGreaterThan(0);
  });

  it("restarts what runs the project's code, never the container or a managed service", async () => {
    // A storage's restart fails outright, and a database runs none of the
    // project's code (the add measured 2026-09-30).
    const typed = (id: string, name: string, version: string, category: string) => ({
      id,
      name,
      serviceStackTypeInfo: {
        serviceStackTypeVersionName: version,
        serviceStackTypeCategory: category,
      },
    });
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "none" }] }],
        });
      if (request.url.includes("/service-stack?")) {
        return jsonResponse(200, {
          list: [
            typed("svc-zcp", "zcp", "zcp@1", "USER"),
            typed("svc-app", "appdev", "nodejs@22", "USER"),
            typed("svc-db", "db", "postgresql@17", "STANDARD"),
            typed("svc-files", "files", "shared-storage", "SHARED_STORAGE"),
            typed("svc-s3", "storage", "object-storage", "OBJECT_STORAGE"),
          ],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.isolateProjectEnvironment("org-1", "project-1");

    expect(
      stub.requests
        .filter((request) => request.url.endsWith("/restart"))
        .map((request) => request.url.split("/").at(-2)),
    ).toEqual(["svc-app"]);
  });

  it("reports no restart for a project already through isolation", async () => {
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.isolateProjectEnvironment("org-1", "project-1");

    expect(result).toEqual({ restarted: false, steps: 0 });
  });

  it("hardening lowers the Mate's token from its own read, by its id, under its lock", async () => {
    const log: string[] = [];
    const token = {
      id: "token-1",
      name: "zcp-project-1",
      roleCode: "ADMIN",
      projects: [{ projectId: "project-1", roleCode: "ADMIN" }],
    };
    const stub = recordingFetch((request) => {
      if (request.url.includes("integration-token"))
        log.push(`${request.method} ${new URL(request.url).pathname.split("/").slice(-1)[0]}`);
      if (request.url.endsWith("/integration-token/list"))
        return jsonResponse(200, { list: [token] });
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, token);
      if (request.method === "PUT" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, {});
      if (request.url.endsWith("/integration-token/token-1/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [{ id: "del-1", tokenId: "token-1" }] });
      if (request.url.endsWith("/integration-token/token-1/delegation/del-1"))
        return jsonResponse(200, {});
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [
            {
              envList: [
                { id: "iso", key: "envIsolation", content: "none" },
                { id: "key", key: "ZCP_API_KEY", content: "secret", sensitive: false },
              ],
            },
          ],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      holdToken: async (tokenId, run) => {
        log.push(`hold ${tokenId}`);
        try {
          return await run();
        } finally {
          log.push(`let go ${tokenId}`);
        }
      },
    });
    client.restoreSession(SESSION);

    await client.hardenMate("org-1", "project-1");

    const held = log.slice(log.indexOf("hold token-1"), log.indexOf("let go token-1") + 1);
    expect(held).toEqual(["hold token-1", "GET token-1", "PUT token-1", "let go token-1"]);
    // The organization's list once, to find the Mate's keys; never again per key.
    expect(log.filter((entry) => entry === "GET list")).toHaveLength(1);
    const write = stub.requests.find(
      (request) => request.method === "PUT" && request.url.endsWith("/integration-token/token-1"),
    );
    // Lowered to no org role, whatever the token held when it was read.
    expect(write?.body).toContain('"roleCode":"NO_ACCESS"');
  });

  // A raced press, an older platform key: every key of the Mate still ADMIN on its project is
  // lowered, whichever the container holds (pass 28 review).
  it("hardening lowers every key of the Mate still ADMIN on its project", async () => {
    const adminKey = (id: string, created: string) => ({
      id,
      name: "zcp-project-1",
      created,
      projects: [{ projectId: "project-1", roleCode: "ADMIN" }],
    });
    const keys = [
      adminKey("token-1", "2026-10-01T09:00:00Z"),
      adminKey("token-2", "2026-10-01T10:00:00Z"),
      {
        id: "token-3",
        name: "zcp-project-1",
        projects: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
      },
    ];
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list")) return jsonResponse(200, { list: keys });
      const byId = /\/integration-token\/(token-\d)$/u.exec(request.url)?.[1];
      if (request.method === "GET" && byId !== undefined)
        return jsonResponse(
          200,
          keys.find((key) => key.id === byId),
        );
      if (request.url.includes("/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [] });
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack")) return jsonResponse(200, { list: [] });
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.hardenMate("org-1", "project-1");

    const lowered = stub.requests
      .filter(
        (request) =>
          request.method === "PUT" && /\/integration-token\/token-\d$/u.test(request.url),
      )
      .map((request) => request.url.split("/").at(-1));
    expect(lowered.toSorted()).toEqual(["token-1", "token-2"]);
    expect(
      stub.requests.filter((request) => request.url.endsWith("/integration-token/list")),
    ).toHaveLength(1);
  });

  it("hardening lowers the Mate's token and drops its delegations before health is asked", async () => {
    const token = {
      id: "token-1",
      name: "zcp-project-1",
      roleCode: "ADMIN",
      projects: [{ projectId: "project-1", roleCode: "ADMIN" }],
    };
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list"))
        return jsonResponse(200, { list: [token] });
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, token);
      if (request.method === "PUT" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, {});
      if (request.url.endsWith("/integration-token/token-1/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [{ id: "del-1", tokenId: "token-1" }] });
      if (request.url.endsWith("/integration-token/token-1/delegation/del-1"))
        return jsonResponse(200, {});
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [
            {
              envList: [
                { id: "iso", key: "envIsolation", content: "none" },
                { id: "key", key: "ZCP_API_KEY", content: "secret", sensitive: false },
              ],
            },
          ],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1");

    expect(result).toEqual({
      tokenLowered: true,
      keyNotLowered: null,
      delegationsDropped: 1,
      isolationSteps: expect.any(Number),
      restarted: true,
    });
    expect(result.isolationSteps).toBeGreaterThan(0);
    // The token write, the delegation's delete, and the isolation plan's own
    // writes all happened.
    expect(
      stub.requests.some(
        (request) => request.method === "PUT" && request.url.endsWith("/integration-token/token-1"),
      ),
    ).toBe(true);
    expect(
      stub.requests.some(
        (request) =>
          request.method === "DELETE" &&
          request.url.endsWith("/integration-token/token-1/delegation/del-1"),
      ),
    ).toBe(true);
    // The write the platform actually receives never carries a wider role
    // than the plan: NO_ACCESS at the org, BASIC_USER on the Mate's own
    // project, and nothing else.
    const tokenWrite = stub.requests.find(
      (request) => request.method === "PUT" && request.url.endsWith("/integration-token/token-1"),
    );
    expect(JSON.parse(tokenWrite?.body ?? "{}")).toMatchObject({
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
    });
  });

  it.each([
    {
      case: "a key the platform minted: ADMIN lowered",
      grants: [{ projectId: "project-1", roleCode: "ADMIN" }],
      written: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
    },
    {
      case: "a key the press minted, already the Mate's reach",
      grants: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
      written: null,
    },
    // Found by its name alone, a key an earlier client widened to its group is not taken for the
    // Mate's (`planMateKey`): only the id HQ holds narrows it.
    {
      case: "a key widened to the group, found by its name: left as it is",
      grants: [
        { projectId: "project-1", roleCode: "ADMIN" },
        { projectId: "project-stage", roleCode: "READ_ONLY" },
      ],
      written: null,
    },
    {
      case: "a key that writes another project too, left as it is",
      grants: [
        { projectId: "project-1", roleCode: "ADMIN" },
        { projectId: "project-stage", roleCode: "ADMIN" },
      ],
      written: null,
    },
  ])("hardening leaves the Mate's key on its own project: $case", async ({ grants, written }) => {
    const token = { id: "token-1", name: "zcp-project-1", roleCode: "NO_ACCESS", projects: grants };
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list"))
        return jsonResponse(200, { list: [token] });
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, token);
      if (request.url.endsWith("/integration-token/token-1/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [] });
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack"))
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1");

    const write = stub.requests.find(
      (request) => request.method === "PUT" && request.url.endsWith("/integration-token/token-1"),
    );
    expect(result.tokenLowered).toBe(written !== null);
    expect(write === undefined ? null : JSON.parse(write.body ?? "{}").projects).toEqual(written);
  });

  it("a hardened Mate is left alone", async () => {
    const token = {
      id: "token-1",
      name: "zcp-project-1",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
    };
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list"))
        return jsonResponse(200, { list: [token] });
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, token);
      if (request.url.endsWith("/integration-token/token-1/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [] });
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1");

    expect(result).toEqual({
      tokenLowered: false,
      keyNotLowered: null,
      delegationsDropped: 0,
      isolationSteps: 0,
      restarted: false,
    });
    // No write of any kind — only the reads every idempotent re-run makes
    // (`/project/search` is a read even though it is a POST).
    expect(
      stub.requests.every((request) => request.method === "GET" || request.method === "POST"),
    ).toBe(true);
    expect(
      stub.requests.some((request) => request.method === "PUT" || request.method === "DELETE"),
    ).toBe(false);
  });

  // Key by id (audit K3): a Mate whose key HQ knows by the id the Mate named is hardened by that
  // id alone — the organization's token list is not read, nor matched by name.
  it("hardens the key its Mate named by id, reading no token list", async () => {
    const token = {
      id: "token-7",
      name: "zerops-zcp-zcp",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "project-1", roleCode: "ADMIN" }],
    };
    const stub = recordingFetch((request) => {
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-7"))
        return jsonResponse(200, token);
      if (request.url.includes("/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [] });
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack"))
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1", undefined, undefined, "token-7");

    expect(result.tokenLowered).toBe(true);
    expect(
      stub.requests.filter((request) => request.method === "PUT").map((request) => request.url),
    ).toEqual([expect.stringMatching(/\/integration-token\/token-7$/u)]);
    expect(stub.requests.some((request) => request.url.endsWith("/integration-token/list"))).toBe(
      false,
    );
  });

  // ADR 0003: the key HQ holds for the Mate is the Mate's, whatever else it reaches; it is written
  // down to its own project alone, foreign grants removed, even where its own grant is lowered.
  it.each([
    {
      case: "ADMIN on its own project and a sibling's reader",
      grants: [
        { projectId: "project-1", roleCode: "ADMIN" },
        { projectId: "project-stage", roleCode: "READ_ONLY" },
      ],
      written: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
    },
    {
      case: "already lowered, still reading a sibling",
      grants: [
        { projectId: "project-stage", roleCode: "READ_ONLY" },
        { projectId: "project-1", roleCode: "BASIC_USER" },
      ],
      written: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
    },
    {
      case: "exactly its own project",
      grants: [{ projectId: "project-1", roleCode: "BASIC_USER" }],
      written: null,
    },
  ])(
    "hardens the key its Mate named by id to its own project: $case",
    async ({ grants, written }) => {
      const token = {
        id: "token-7",
        name: "zerops-zcp-zcp",
        roleCode: "NO_ACCESS",
        projects: grants,
      };
      const stub = recordingFetch((request) => {
        if (request.method === "GET" && request.url.endsWith("/integration-token/token-7"))
          return jsonResponse(200, token);
        if (request.url.includes("/delegation") && request.method === "GET")
          return jsonResponse(200, { list: [] });
        if (request.url.endsWith("/project/search"))
          return jsonResponse(200, {
            items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
          });
        if (request.url.includes("/service-stack"))
          return jsonResponse(200, {
            list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
          });
        return jsonResponse(200, {});
      });
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);

      const result = await client.hardenMate("org-1", "project-1", undefined, undefined, "token-7");

      const write = stub.requests.find(
        (request) => request.method === "PUT" && request.url.endsWith("/integration-token/token-7"),
      );
      expect(result.tokenLowered).toBe(written !== null);
      expect(write === undefined ? null : JSON.parse(write.body ?? "{}").projects).toEqual(written);
    },
  );

  // A key found by its name is the Mate's only while it holds its own project alone: one widened
  // between the organization's list and the read under its lock is left as it is, never narrowed.
  it("leaves a key found by its name that reads another project by the time it is read", async () => {
    const listed = {
      id: "token-1",
      name: "zcp-project-1",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "project-1", roleCode: "ADMIN" }],
    };
    const read = {
      ...listed,
      projects: [...listed.projects, { projectId: "project-stage", roleCode: "READ_ONLY" }],
    };
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list"))
        return jsonResponse(200, { list: [listed] });
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, read);
      if (request.url.includes("/delegation") && request.method === "GET")
        return jsonResponse(200, { list: [{ id: "del-1", tokenId: "token-1" }] });
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack"))
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1");

    expect(result).toMatchObject({ tokenLowered: false, delegationsDropped: 0 });
    expect(
      stub.requests.some(
        (request) => request.url.includes("/integration-token/token-1") && request.method !== "GET",
      ),
    ).toBe(false);
  });

  // Step A, A11: an admin adopting a Mate whose key an owner made may not write that key. The
  // adoption is not failed for it: the harden says so, and closes the project off all the same.
  it("says a key write it was refused, and still isolates the project", async () => {
    const token = {
      id: "token-1",
      name: "zcp-project-1",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "project-1", roleCode: "ADMIN" }],
    };
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list"))
        return jsonResponse(200, { list: [token] });
      if (request.method === "GET" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(200, token);
      if (request.method === "PUT" && request.url.endsWith("/integration-token/token-1"))
        return jsonResponse(403, { error: { code: "forbidden", message: "Not allowed." } });
      if (request.url.includes("/delegation")) return jsonResponse(403, {});
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1");

    expect({ ...result, keyNotLowered: typeof result.keyNotLowered }).toEqual({
      tokenLowered: false,
      keyNotLowered: "string",
      delegationsDropped: 0,
      isolationSteps: 0,
      restarted: false,
    });
    expect(stub.requests.some((request) => request.url.endsWith("/project/search"))).toBe(true);
  });

  it("skips the token half when no token matches this project, and still isolates it", async () => {
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/integration-token/list")) return jsonResponse(200, { list: [] });
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, {
          items: [{ envList: [{ id: "iso", key: "envIsolation", content: "service" }] }],
        });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.hardenMate("org-1", "project-1");

    expect(result.tokenLowered).toBe(false);
    expect(result.delegationsDropped).toBe(0);
    // No delegation read at all — there was no token to ask about.
    expect(stub.requests.some((request) => request.url.includes("/delegation"))).toBe(false);
  });

  it("writes nothing when the index has not caught up with the project", async () => {
    // The index trails the write path: a project created a moment ago answers
    // without the variables the platform gave it at birth. Planning from that
    // asked for a second `envIsolation`, the platform refused it with
    // "is not unique", and the refusal failed the creation that called it —
    // the wizard sat on its form with the platform's words on screen
    // (measured live 2026-09-20).
    const stub = recordingFetch((request) => {
      if (request.url.endsWith("/project/search"))
        return jsonResponse(200, { items: [{ envList: [] }] });
      if (request.url.includes("/service-stack")) {
        return jsonResponse(200, {
          list: [{ id: "svc-1", name: "zcp", serviceStackTypeId: "zcp" }],
        });
      }
      return jsonResponse(200, {});
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const error = await client
      .isolateProjectEnvironment("org-1", "project-1")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect(
      stub.requests.filter(
        (request) => request.method !== "GET" && !request.url.endsWith("/project/search"),
      ),
    ).toEqual([]);
  });

  it("does not hide a non-permission failure behind the project search fallback", async () => {
    const stub = recordingFetch(() => jsonResponse(503, { error: { code: "unavailable" } }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const error = await client
      .listAccessibleClientProjects("org-1")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("server");
    expect(stub.requests).toHaveLength(1);
  });

  it("restarts a service with PUT and the caller's own token", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { id: "process-1" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.restartService("service-1");

    expect(stub.requests[0]?.method).toBe("PUT");
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/restart`,
    );
    expect(stub.requests[0]?.authorization).toBe("Bearer access-1");
  });

  it("writes the Zerops Mate flag on a container that lacks it", async () => {
    // A restart alone could not enable it: zcp registers no mate step at all
    // without this key, so the container came back in the identical state.
    let envCalls = 0;
    const stub = recordingFetch((request) => {
      if (!request.url.endsWith("/env")) {
        return jsonResponse(200, { id: "process-1" });
      }
      envCalls += 1;
      // The read-back (the 2nd /env read) sees the flag the POST just wrote.
      return envCalls === 1
        ? jsonResponse(200, { items: [{ id: "e1", key: "VSCODE_PASSWORD", content: "x" }] })
        : jsonResponse(200, { items: [{ id: "e2", key: "ZCP_MATE_ENABLED", content: "1" }] });
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.writeMateFlag("service-1");

    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
    ]);
    // `sensitive` is required on every service userData write — the platform
    // rejects the POST outright with "field is required" when it is absent.
    expect(JSON.parse(stub.requests[1]?.body ?? "{}")).toEqual({
      key: "ZCP_MATE_ENABLED",
      content: "1",
      sensitive: true,
    });
  });

  it("replaces a Zerops Mate flag that is present but switched off", async () => {
    // The platform exposes create and delete for a single key, no update, so an
    // upsert is delete-then-create. The bulk env-file PUT is not an option: it
    // replaces the whole file and drops every other var the user set.
    let envCalls = 0;
    const stub = recordingFetch((request) => {
      if (!request.url.endsWith("/env")) {
        return jsonResponse(200, { id: "process-1" });
      }
      envCalls += 1;
      return envCalls === 1
        ? jsonResponse(200, { items: [{ id: "e9", key: "ZCP_MATE_ENABLED", content: "0" }] })
        : jsonResponse(200, { items: [{ id: "e10", key: "ZCP_MATE_ENABLED", content: "1" }] });
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.writeMateFlag("service-1");

    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `DELETE ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/user-data/e9`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
    ]);
  });

  it("retries the create when the read-back misses the flag", async () => {
    // The create can race the platform's own read path. A read-back that
    // still misses the flag gets exactly one more create attempt, not an
    // unbounded retry loop.
    const stub = recordingFetch((request) =>
      request.url.endsWith("/env")
        ? jsonResponse(200, { items: [{ id: "e1", key: "VSCODE_PASSWORD", content: "x" }] })
        : jsonResponse(200, { id: "process-1" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.writeMateFlag("service-1");

    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
    ]);
  });

  it("writes nothing when the flag already reads as on", async () => {
    // zcp's own reading of the flag: 1 or true, case-insensitive, surrounding
    // space tolerated. A container that is merely away must not have its env
    // rewritten — and a yaml-baked key cannot be deleted at all, so a needless
    // delete-then-create would turn a working container into an error.
    for (const content of ["1", "true", " TRUE "]) {
      const stub = recordingFetch((request) =>
        request.url.endsWith("/env")
          ? jsonResponse(200, { items: [{ id: "e9", key: "ZCP_MATE_ENABLED", content }] })
          : jsonResponse(200, { id: "process-1" }),
      );
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);

      await client.writeMateFlag("service-1");

      expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      ]);
    }
  });

  it("sends the Zerops token to the configured API base and nowhere else", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, {
        id: "user-1",
        email: "a@b.c",
        clientUserList: [],
        list: [],
        totalCount: 0,
      }),
    );
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      baseUrl: "https://api.app-fra1.zerops.io/",
    });
    client.restoreSession(SESSION);

    await client.listClientProjects("org-1");
    await client.fetchUser();

    expect(stub.requests).toHaveLength(2);
    for (const request of stub.requests) {
      expect(request.url.startsWith("https://api.app-fra1.zerops.io/api/rest/public/")).toBe(true);
      expect(request.authorization).toBe("Bearer access-1");
    }
  });

  it("wraps a transport failure instead of leaking the raw cause", async () => {
    const client = new ZeropsApiClient({
      fetch: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
    });
    client.restoreSession(SESSION);

    const error = await client.fetchUser().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("network");
    expect((error as ZeropsApiError).status).toBeNull();
  });
});

/**
 * Which key a list comes back under is the platform's to say, and it is not one
 * key. Measured against the live API on 2026-09-18, as the org's owner: a
 * project's services and an org's members each answered under a name this
 * client did not read, so both came back empty and said nothing about it. The
 * server half already knew (`ZeropsThrowawayIdentity.ts`).
 */
describe("the key a list answers under", () => {
  const SERVICE = { id: "svc-api", name: "api", status: "ACTIVE" };
  const MEMBER = { id: "cu-1", userId: "u-1", roleCode: "OWNER", user: { fullName: "Ada" } };

  it.each([
    { name: "`list`, which is what it answers", body: { list: [SERVICE] } },
    { name: "`items`, in case it ever does", body: { items: [SERVICE] } },
    { name: "neither, which is an empty project", body: { count: 0 }, empty: true },
  ])("reads a project's services under $name", async ({ body, empty }) => {
    const stub = recordingFetch(() => jsonResponse(200, body));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const services = await client.listProjectServices("prj-1");

    expect(services.map((service) => service.name)).toEqual(empty === true ? [] : ["api"]);
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/prj-1/service-stack?limit=500`,
    );
  });

  it.each([
    { name: "`clientUserList`, which is what it answers", body: { clientUserList: [MEMBER] } },
    { name: "`items`", body: { items: [MEMBER] } },
    { name: "`list`", body: { list: [MEMBER] } },
  ])("reads an organization's members under $name", async ({ body }) => {
    const stub = recordingFetch(() => jsonResponse(200, body));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    expect((await client.listOrganizationMembers("org-1")).map((row) => row.id)).toEqual(["cu-1"]);
  });

  it.each(["total", "totalCount"])(
    "takes the project count from %s, so a short page is a failure and not an end",
    async (key) => {
      const page = (offset: number) =>
        jsonResponse(200, {
          list: [{ id: `p${offset}`, name: "one", status: "ACTIVE", clientId: "org-1" }],
          [key]: 3,
        });
      let offset = 0;
      const stub = recordingFetch(() => page((offset += 1)));
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);

      // Three pages of one, against a total of three: the count is read, so the
      // reader keeps going rather than stopping at the first short page.
      expect(await client.listClientProjects("org-1")).toHaveLength(3);
      expect(stub.requests).toHaveLength(3);
    },
  );
});

describe("ZeropsApiClient.fetchProjectLogAccess", () => {
  it("reads the project's signed log-backend URL, stripping a leading GET", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, { url: "GET https://proxy.example.com/api/rest/log?signature=abc" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const access = await client.fetchProjectLogAccess("project-1");

    expect(access).toEqual({ url: "https://proxy.example.com/api/rest/log?signature=abc" });
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/project-1/log`,
    );
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${SESSION.accessToken}`);
  });

  it("leaves a URL with no GET prefix untouched", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, { url: "https://proxy.example.com/api/rest/log?signature=abc" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const access = await client.fetchProjectLogAccess("project-1");

    expect(access).toEqual({ url: "https://proxy.example.com/api/rest/log?signature=abc" });
  });

  /**
   * A background/log read's own 401 is not evidence the account's session is
   * gone elsewhere.
   */
  it("rejects on a 401 with a failed refresh, but never clears the held session", async () => {
    const stub = recordingFetch((request) =>
      request.url.includes("/auth/refresh")
        ? jsonResponse(401, { error: { code: "invalidRefreshToken" } })
        : jsonResponse(401, { error: { code: "unauthorized" } }),
    );
    const onSessionChange = vi.fn();
    const client = new ZeropsApiClient({ fetch: stub.fetch, onSessionChange });
    client.restoreSession(SESSION);

    const error = await client.fetchProjectLogAccess("project-1").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("expired-session");
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(client.session).toEqual(SESSION);
  });

  /**
   * The poller's own 401 must never sign the user out on its own — but if a
   * user-initiated request happens to piggyback on the SAME in-flight
   * refresh the poller started, that refresh failing is real evidence the
   * session is dead, and the piggybacking caller's stricter preference must
   * win: leaving the UI signed in over a session the platform has already
   * rejected would be worse than the poller's own 401 ever was.
   */
  it("clears the session when a user-initiated call piggybacks on the poller's in-flight refresh and it fails", async () => {
    const stub = recordingFetch((request) =>
      request.url.includes("/auth/refresh")
        ? jsonResponse(401, { error: { code: "invalidRefreshToken" } })
        : jsonResponse(401, { error: { code: "unauthorized" } }),
    );
    const onSessionChange = vi.fn();
    const client = new ZeropsApiClient({ fetch: stub.fetch, onSessionChange });
    client.restoreSession(SESSION);

    // Not awaited individually: both `#request` calls start before either
    // resolves, so the second joins the first's in-flight `#refreshSession`
    // instead of starting its own.
    const pollerCall = client.fetchProjectLogAccess("project-1").catch((cause: unknown) => cause);
    const userCall = client.fetchProject("project-1").catch((cause: unknown) => cause);
    const [pollerResult, userResult] = await Promise.all([pollerCall, userCall]);

    expect(pollerResult).toBeInstanceOf(ZeropsApiError);
    expect(userResult).toBeInstanceOf(ZeropsApiError);
    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(onSessionChange).toHaveBeenCalledWith(null);
    expect(client.session).toBeNull();
  });

  it("leaves the session intact when every caller sharing the refresh opted out of clearing it", async () => {
    const stub = recordingFetch((request) =>
      request.url.includes("/auth/refresh")
        ? jsonResponse(401, { error: { code: "invalidRefreshToken" } })
        : jsonResponse(401, { error: { code: "unauthorized" } }),
    );
    const onSessionChange = vi.fn();
    const client = new ZeropsApiClient({ fetch: stub.fetch, onSessionChange });
    client.restoreSession(SESSION);

    const first = client.fetchProjectLogAccess("project-1").catch((cause: unknown) => cause);
    const second = client.fetchProjectLogAccess("project-2").catch((cause: unknown) => cause);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBeInstanceOf(ZeropsApiError);
    expect(secondResult).toBeInstanceOf(ZeropsApiError);
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(client.session).toEqual(SESSION);
  });
});

describe("ZeropsApiClient.exchangeWebSocketToken", () => {
  it("trades the access token for a webSocketToken", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { webSocketToken: "ws-token-1" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const result = await client.exchangeWebSocketToken();

    expect(result).toEqual({ webSocketToken: "ws-token-1" });
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/web-socket/login`,
    );
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${SESSION.accessToken}`);
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({ token: SESSION.accessToken });
  });

  it("refuses without a session rather than calling the platform", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { webSocketToken: "ws-token-1" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    const error = await client.exchangeWebSocketToken().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("expired-session");
    expect(stub.requests).toHaveLength(0);
  });

  it("the login exchange retry after a refresh carries the refreshed token in the body and never clears the session", async () => {
    const refreshedSession: ZeropsSession = {
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresIn: 432_000,
      userId: "user-1",
    };
    const stub = recordingFetch((request) => {
      if (request.url.includes("/web-socket/login")) {
        return request.authorization === `Bearer ${SESSION.accessToken}`
          ? jsonResponse(401, { error: { code: "unauthorized" } })
          : jsonResponse(200, { webSocketToken: "ws-token-1" });
      }
      if (request.url.includes("/auth/refresh")) {
        return jsonResponse(200, refreshedSession);
      }
      return jsonResponse(500, { error: { code: "unexpected" } });
    });
    const onSessionChange = vi.fn();
    const client = new ZeropsApiClient({ fetch: stub.fetch, onSessionChange });
    client.restoreSession(SESSION);

    const result = await client.exchangeWebSocketToken();

    expect(result).toEqual({ webSocketToken: "ws-token-1" });
    const loginRequests = stub.requests.filter((request) =>
      request.url.includes("/web-socket/login"),
    );
    expect(loginRequests).toHaveLength(2);
    expect(JSON.parse(loginRequests[0]?.body ?? "{}")).toEqual({ token: SESSION.accessToken });
    expect(JSON.parse(loginRequests[1]?.body ?? "{}")).toEqual({
      token: refreshedSession.accessToken,
    });
    expect(loginRequests[1]?.authorization).toBe(`Bearer ${refreshedSession.accessToken}`);
    expect(client.session?.accessToken).toBe(refreshedSession.accessToken);
    // The session changed (refreshed), it was never cleared.
    expect(onSessionChange).not.toHaveBeenCalledWith(null);
  });

  it("rejects on a 401 with no refresh token, but never clears the held session", async () => {
    const stub = recordingFetch(() => jsonResponse(401, { error: { code: "unauthorized" } }));
    const onSessionChange = vi.fn();
    const client = new ZeropsApiClient({ fetch: stub.fetch, onSessionChange });
    client.restoreSession({ accessToken: "access-1", userId: "user-1" });

    const error = await client.exchangeWebSocketToken().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("expired-session");
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(client.session?.accessToken).toBe("access-1");
  });

  it("lets a websocket deadline stop waiting on a shared refresh", async () => {
    const refreshStarted = Promise.withResolvers<void>();
    const refreshResponse = Promise.withResolvers<Response>();
    const stub = recordingFetch((request) => {
      if (request.url.includes("/web-socket/login"))
        return jsonResponse(401, { error: { code: "unauthorized" } });
      refreshStarted.resolve();
      return refreshResponse.promise;
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    const controller = new AbortController();

    const exchange = client.exchangeWebSocketToken(controller.signal);
    await refreshStarted.promise;
    controller.abort();
    const error = await exchange.catch((cause: unknown) => cause);
    refreshResponse.resolve(jsonResponse(401, { error: { code: "invalidRefreshToken" } }));

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(client.session).toEqual(SESSION);
  });
});

describe("ZeropsApiClient.listIntegrationTokens", () => {
  // The platform answers the whole list whatever is asked: `limit` and `offset` ignored, 193 tokens
  // to `?limit=100` and to `?limit=100&offset=100` alike (measured 2026-10-03).
  it("asks for the whole list, with no limit the platform would not keep", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { list: [] }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.listIntegrationTokens("org-1");

    expect(stub.requests.map((request) => new URL(request.url).search)).toEqual([""]);
  });
});

describe("ZeropsApiClient.stopService", () => {
  it("stops a service and answers the stop's process", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { id: "process-stop", status: "PENDING" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    expect(await client.stopService("svc-1")).toEqual({ processId: "process-stop" });
    expect(
      stub.requests.map((request) => `${request.method} ${request.url.split("/public")[1]}`),
    ).toEqual(["PUT /service-stack/svc-1/stop"]);
  });
});

describe("ZeropsApiClient app versions — a deploy through the API", () => {
  it("creates a version, uploads its archive as bytes and builds it with its zerops.yml", async () => {
    const uploads: Array<{ readonly contentType: string | null; readonly bytes: number }> = [];
    const stub = recordingFetch(async (request) => {
      if (request.url.endsWith("/app-version")) return jsonResponse(200, { id: "av-1" });
      // The upload answers with no body at all.
      if (request.url.endsWith("/upload")) return new Response(null, { status: 200 });
      return jsonResponse(200, { id: "process-1", status: "PENDING" });
    });
    const client = new ZeropsApiClient({
      fetch: async (input, init) => {
        if (input.endsWith("/upload")) {
          uploads.push({
            contentType: new Headers(init?.headers).get("content-type"),
            bytes: (init?.body as Uint8Array | undefined)?.byteLength ?? 0,
          });
        }
        return stub.fetch(input, init);
      },
    });
    client.restoreSession(SESSION);

    const { id } = await client.createAppVersion("svc-hq", "hq-core");
    await client.uploadAppVersionArchive(id, new Uint8Array([1, 2, 3]));
    const deploy = await client.buildAndDeployAppVersion(id, {
      zeropsYaml: "zerops: []",
      setup: "hq",
    });

    expect(deploy).toEqual({ processId: "process-1" });
    expect(uploads).toEqual([{ contentType: "application/octet-stream", bytes: 3 }]);
    expect(
      stub.requests.map((request) => [
        `${request.method} ${request.url.split("/public")[1]}`,
        request.body,
      ]),
    ).toEqual([
      ["POST /service-stack/svc-hq/app-version", JSON.stringify({ name: "hq-core" })],
      ["PUT /app-version/av-1/upload", null],
      [
        "PUT /app-version/av-1/build-and-deploy",
        JSON.stringify({ zeropsYaml: "zerops: []", zeropsYamlSetup: "hq" }),
      ],
    ]);
  });
});

describe("ZeropsApiClient.listProjectProcesses", () => {
  it("reads a project's newest processes, its app versions and fail reasons with them", async () => {
    const stub = recordingFetch(async () =>
      jsonResponse(200, {
        list: [
          {
            id: "p2",
            projectId: "hq-project",
            serviceStackId: "svc-hq",
            status: "FAILED",
            actionName: "stack.build",
            created: "2026-10-04T10:00:00Z",
            appVersion: { id: "av-2", name: "hq-core.20261004T090000Z.0123456789ab" },
            publicMeta: { failReason: "readiness check failed" },
          },
          { id: "broken" },
        ],
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const processes = await client.listProjectProcesses("hq-project");

    expect(
      stub.requests.map((request) => `${request.method} ${request.url.split("/public")[1]}`),
    ).toEqual(["GET /project/hq-project/process?limit=20"]);
    expect(processes).toEqual([
      {
        id: "p2",
        projectId: "hq-project",
        serviceStackIds: ["svc-hq"],
        status: "FAILED",
        actionName: "stack.build",
        created: "2026-10-04T10:00:00Z",
        appVersion: { id: "av-2", name: "hq-core.20261004T090000Z.0123456789ab" },
        failReason: "readiness check failed",
      },
    ]);
  });
});

describe("ZeropsApiClient.deleteThrowaway", () => {
  it.each(["zcp-acme", "mate-broker", "mate-doorstop", "mate-door"])(
    "refuses %s, which is not a throwaway, and sends nothing",
    async (name) => {
      const stub = recordingFetch(() => jsonResponse(204, {}));
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);

      await expect(
        client.deleteThrowaway({ clientId: "org-1", tokenId: "t1", name }, { token: "access-0" }),
      ).rejects.toMatchObject({ kind: "invalid-input" });
      expect(stub.requests).toHaveLength(0);
    },
  );

  it("carries the minting token with project writes refused, and its 401 never touches the session", async () => {
    const stored: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() => jsonResponse(401, { error: { code: "unauthorized" } }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });
    client.restoreSession(SESSION);

    await expect(
      client.deleteThrowaway(
        { clientId: "org-1", tokenId: "t1", name: "mate-door:p1:n1" },
        { token: "access-0" },
      ),
    ).rejects.toMatchObject({ kind: "expired-session", status: 401 });

    expect(
      stub.requests.map(({ method, url, authorization }) => [method, url, authorization]),
    ).toEqual([
      [
        "DELETE",
        `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/client/org-1/integration-token/t1`,
        "Bearer access-0",
      ],
    ]);
    expect(client.session).toEqual(SESSION);
    expect(stored).toEqual([]);
  });
});

describe("a project write's admission", () => {
  it("that resolves after a sign-out and another sign-in sends nothing as the new session", async () => {
    const stub = recordingFetch(() => jsonResponse(200, {}));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    let admit!: () => void;
    const admission = new Promise<void>((resolve) => {
      admit = resolve;
    });

    const writing = client.requestData({
      path: "/service-stack/s1/restart",
      method: "PUT",
      operationKind: "project-write",
      signal: new AbortController().signal,
      background: false,
      beforeWrite: () => admission,
    });
    await client.signOutLocally();
    client.restoreSession({ ...SESSION, accessToken: "access-2" });
    admit();

    await expect(writing).rejects.toMatchObject({ kind: "expired-session" });
    expect(stub.requests).toEqual([]);
  });
});

describe("ZeropsApiClient.adoptSession", () => {
  // A hand-over delivers a personal access token, a bearer with no refresh
  // token. Nothing is exchanged; it is proven before it is stored, so a dead
  // token never becomes a signed-in-looking UI.
  it("proves the token before storing it, and stores exactly it", async () => {
    const stored: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() => jsonResponse(200, { id: "user-9", email: "a@b.c" }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });

    const session = await client.adoptSession({ accessToken: "at-abc" });

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/user/info`);
    expect(stub.requests[0]?.authorization).toBe("Bearer at-abc");
    expect(session).toEqual({ accessToken: "at-abc" });
    expect(stored).toEqual([session]);
  });

  it("keeps a full session's refresh token, so a dev-injected login renews itself", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { id: "user-9", email: "a@b.c" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    const session = await client.adoptSession({ accessToken: "at-1", refreshToken: "rt-1" });

    expect(session).toEqual({ accessToken: "at-1", refreshToken: "rt-1" });
    expect(client.session).toEqual(session);
  });

  // A refused hand-over is not the end of a held session: nothing was held.
  // Announcing one would read as "the platform refused this login" and send
  // the tab straight back for another hand-over — a loop.
  it("stores nothing and announces no session end when the token is refused", async () => {
    const changes: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() => jsonResponse(401, { error: { code: "notAuthorized" } }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        changes.push(session);
      },
    });

    await expect(client.adoptSession({ accessToken: "dead" })).rejects.toBeInstanceOf(
      ZeropsApiError,
    );
    expect(client.session).toBeNull();
    expect(changes).toEqual([]);
  });

  it("will not spend a request on an empty hand-over", async () => {
    const stub = recordingFetch(() => jsonResponse(200, {}));
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    await expect(client.adoptSession({ accessToken: "  " })).rejects.toBeInstanceOf(ZeropsApiError);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("AL-06 account lifetime", () => {
  it("locks locally before a remote logout returns and cannot clear a later login", async () => {
    let finish!: (response: Response) => void;
    const started = Promise.withResolvers<void>();
    const client = new ZeropsApiClient({
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve;
          started.resolve();
        }),
    });
    client.restoreSession(SESSION);
    const logout = client.logout();
    expect(client.session).toBeNull();
    await started.promise;
    client.restoreSession({ accessToken: "next-account" });
    finish(new Response(null, { status: 204 }));
    await logout;
    expect(client.session?.accessToken).toBe("next-account");
  });

  it("rejects a login response that arrives after local logout", async () => {
    let finish!: (response: Response) => void;
    const client = new ZeropsApiClient({
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const login = client.login("user@example.com", "password");
    await client.signOutLocally();
    finish(jsonResponse(200, { auth: SESSION }));
    await expect(login).rejects.toMatchObject({ kind: "expired-session" });
    expect(client.session).toBeNull();
  });

  it("does not let an old read sign a new account out", async () => {
    let finish!: (response: Response) => void;
    const client = new ZeropsApiClient({
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    client.restoreSession(SESSION);
    const read = client.fetchUser();
    client.restoreSession({ accessToken: "next-account" });
    finish(jsonResponse(401, {}));
    await expect(read).rejects.toMatchObject({ kind: "expired-session" });
    expect(client.session?.accessToken).toBe("next-account");
  });

  it("does not fabricate an empty list for an incomplete inventory", async () => {
    const client = new ZeropsApiClient({ fetch: async () => jsonResponse(200, {}) });
    client.restoreSession(SESSION);
    await expect(client.listAccessibleClientProjects("org")).rejects.toMatchObject({
      kind: "unexpected",
    });
  });

  it("names an incomplete inventory by its cause alone, leaving the retry to the surface", async () => {
    const client = new ZeropsApiClient({ fetch: async () => jsonResponse(200, {}) });
    client.restoreSession(SESSION);
    await expect(client.listAccessibleClientProjects("org")).rejects.toMatchObject({
      message: "Zerops returned an incomplete project inventory.",
    });
  });
});

describe("AL-08 / AL-12 inventory completeness and uncertain operations", () => {
  it("reads every direct project page before publishing the inventory", async () => {
    const stub = recordingFetch((request) =>
      jsonResponse(200, {
        list: [
          {
            id: request.url.includes("offset=1") ? "p2" : "p1",
            name: "Project",
            status: "ACTIVE",
            clientId: "org",
          },
        ],
        totalCount: 2,
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    expect((await client.listClientProjects("org", { limit: 1 })).map((p) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(stub.requests).toHaveLength(2);
  });
  it("rejects a repeated page instead of treating a partial inventory as complete", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, {
        list: [{ id: "p1", name: "Project", status: "ACTIVE", clientId: "org" }],
        totalCount: 2,
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    await expect(client.listClientProjects("org", { limit: 1 })).rejects.toMatchObject({
      kind: "unexpected",
    });
  });
  it("reports a lost creation response as uncertain and never resubmits it", async () => {
    const stub = recordingFetch(() => {
      throw new TypeError("connection lost");
    });
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    await expect(
      client.createProject({ clientId: "org", name: "Project", tagList: [] }),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect(stub.requests).toHaveLength(1);
  });
});

// E2E F7: `PUT /project/{id}` with `userRoles` replaces the project's whole list, can't name a token
// (`400 userNotFound`), and a people-only list drops the Mate key's own grant (measured 2026-10-03,
// f7-handover-probe.json). One person's own role list is the write that moves nobody else.
describe("ZeropsApiClient.setProjectMemberRole — handing a Mate over", () => {
  const project = {
    id: "p1",
    name: "Fen",
    status: "ACTIVE",
    clientId: "org-1",
    userRoles: [{ clientUserId: "cu-key", roleCode: "BASIC_USER" }],
  };
  const answering = (held: ReadonlyArray<{ projectId: string; roleCode: string }>) =>
    recordingFetch((request) =>
      request.url.includes("/client-user/")
        ? jsonResponse(200, { projectRoleList: held.map((role) => ({ id: "r", ...role })) })
        : jsonResponse(200, project),
    );
  const sent = (stub: ReturnType<typeof answering>) =>
    stub.requests.map((request) => `${request.method} ${request.url.split("/public")[1]}`);

  it("writes the person's own role list with this project's role in it, and never the project", async () => {
    const stub = answering([{ projectId: "p-other", roleCode: "READ_ONLY" }]);
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const after = await client.setProjectMemberRole({
      projectId: "p1",
      clientUserId: "cu-eva",
      roleCode: "OWNER",
    });

    // Read, then write: the person's list is replaced by whatever it is sent.
    expect(sent(stub)).toEqual([
      "GET /client-user/cu-eva/roles",
      "PUT /client-user/cu-eva/roles",
      "GET /project/p1",
    ]);
    expect(JSON.parse(stub.requests[1]?.body ?? "{}")).toEqual({
      projectRoleList: [
        { projectId: "p-other", roleCode: "READ_ONLY" },
        { projectId: "p1", roleCode: "OWNER" },
      ],
    });
    // The project as the platform holds it after the write: the key's own grant untouched.
    expect(after.userRoles).toEqual(project.userRoles);
  });

  // Overrides are measured in both directions: the same call, lowered, takes a Mate away.
  it("takes a Mate away when it lowers its owner", async () => {
    const stub = answering([{ projectId: "p1", roleCode: "OWNER" }]);
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.setProjectMemberRole({
      projectId: "p1",
      clientUserId: "cu-jan",
      roleCode: "READ_ONLY",
    });

    expect(JSON.parse(stub.requests[1]?.body ?? "{}").projectRoleList).toEqual([
      { projectId: "p1", roleCode: "READ_ONLY" },
    ]);
  });

  // F23: a hand over takes OWNER from whoever held it — this project off their list, their other
  // projects kept, as measured in F7 (f7-handover-probe.json: restored by the same call, exact).
  it("takes this project off a person's list, keeping their others", async () => {
    const stub = answering([
      { projectId: "p1", roleCode: "OWNER" },
      { projectId: "p-elsewhere", roleCode: "OWNER" },
    ]);
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.setProjectMemberRole({ projectId: "p1", clientUserId: "cu-krls", roleCode: null });

    expect(sent(stub)).toEqual([
      "GET /client-user/cu-krls/roles",
      "PUT /client-user/cu-krls/roles",
      "GET /project/p1",
    ]);
    expect(JSON.parse(stub.requests[1]?.body ?? "{}")).toEqual({
      projectRoleList: [{ projectId: "p-elsewhere", roleCode: "OWNER" }],
    });
  });
});

describe("ZeropsApiClient.writeProject — the TagWriter's one PUT", () => {
  const project = {
    id: "p1",
    name: "Fen",
    status: "ACTIVE",
    clientId: "org-1",
    description: "A Mate",
    tagList: ["billing:team-a"],
    publicIpV4Shared: true,
    maxCreditLimit: 40,
    userRoles: [{ clientUserId: "cu-jan", roleCode: "OWNER" }],
  };

  it("sends the name and the list with the fields the platform would otherwise reset, and never userRoles", async () => {
    const stub = recordingFetch(() => jsonResponse(200, project));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.writeProject(project, { name: "Nova", tagList: ["billing:team-a", "mate"] });

    expect(stub.requests.map((request) => request.method)).toEqual(["PUT"]);
    // A record write must never carry `userRoles`: the platform replaces what it
    // is sent, and a stale list would silently rewrite who may open the Mate.
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      name: "Nova",
      description: "A Mate",
      // The project's own tags go back with the marker: they are its person's.
      tagList: ["billing:team-a", "mate"],
      publicIpV4Shared: true,
      maxCreditLimit: 40,
    });
  });
});

describe("ZeropsApiClient — a project's public HTTP routing", () => {
  it("lists each routing with its domains' certificate state", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, {
        list: [
          {
            id: "r1",
            sslEnabled: true,
            isSynced: false,
            domains: [
              {
                domainName: "abc.zerops.app",
                dnsCheckStatus: "PENDING",
                sslStatus: "WAITING_FOR_DNS",
                sslCertificateInstallationError: "dns not ready",
              },
            ],
            locations: [{ path: "/", port: 8080, serviceStackId: "svc-hq" }],
          },
        ],
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    await expect(client.listPublicHttpRoutings("hq1")).resolves.toEqual([
      {
        id: "r1",
        isSynced: false,
        domains: [
          { domainName: "abc.zerops.app", sslStatus: "WAITING_FOR_DNS", sslError: "dns not ready" },
        ],
      },
    ]);
    expect(stub.requests[0]).toMatchObject({
      method: "GET",
      url: expect.stringMatching(/\/project\/hq1\/public-http-routing$/),
    });
  });

  it("makes one routing, with SSL, and syncs the project's routings as one process", async () => {
    const stub = recordingFetch((request) =>
      request.method === "PUT"
        ? jsonResponse(200, { id: "proc-sync" })
        : jsonResponse(200, { id: "r1" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    await client.createPublicHttpRouting("hq1", {
      domains: ["abc.zerops.app"],
      locations: [{ path: "/", port: 8080, serviceStackId: "svc-hq" }],
    });
    await expect(client.syncPublicHttpRouting("hq1")).resolves.toEqual({ processId: "proc-sync" });
    expect(
      stub.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`),
    ).toEqual([
      "POST /api/rest/public/project/hq1/public-http-routing",
      "PUT /api/rest/public/project/hq1/sync-public-http-routing",
    ]);
    expect(JSON.parse(stub.requests[0]!.body!)).toEqual({
      sslEnabled: true,
      domains: ["abc.zerops.app"],
      locations: [{ path: "/", port: 8080, serviceStackId: "svc-hq" }],
    });
  });
});

describe("ZeropsApiClient.deleteProject", () => {
  it("deletes the project as a project write", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, { id: "proc-delete", actionName: "project.delete", status: "PENDING" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    const checks: Array<string> = [];

    await expect(
      client.deleteProject("proj-1", undefined, async () => {
        checks.push("before-write");
      }),
    ).resolves.toEqual({ processId: "proc-delete" });
    expect(checks).toEqual(["before-write"]);
    expect(stub.requests).toEqual([
      {
        method: "DELETE",
        url: expect.stringMatching(/\/project\/proj-1$/),
        authorization: "Bearer access-1",
        body: null,
      },
    ]);
  });

  it("fails visibly if Zerops accepts deletion without a process handle", async () => {
    const stub = recordingFetch(() => jsonResponse(200, {}));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    await expect(client.deleteProject("proj-1")).rejects.toThrow("did not return its process");
    expect(stub.requests).toHaveLength(1);
  });

  it("surfaces the platform's refusal", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(400, { code: "projectHasRunningProcess", message: "A process is running." }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);
    await expect(client.deleteProject("proj-1")).rejects.toMatchObject({
      message: "A process is running.",
      code: "projectHasRunningProcess",
    });
  });
});

describe("ZeropsApiClient.writeServiceSecret", () => {
  const refused = () => jsonResponse(500, { error: { code: "internalServerError" } });
  it.each([
    {
      name: "the key there, its sensitive value unreadable: written",
      items: [{ id: "u1", key: "HQ_ORG_TOKEN", content: "REDACTED" }],
      written: true,
    },
    { name: "the key absent: the refusal stands", items: [], written: false },
  ])(
    "reads a refused write back by key, never every variable: $name",
    async ({ items, written }) => {
      const http = recordingFetch((request) =>
        request.method === "POST" && request.url.endsWith("/user-data/search")
          ? jsonResponse(200, { items })
          : refused(),
      );
      const client = new ZeropsApiClient({ fetch: http.fetch });
      client.restoreSession(SESSION);
      const write = client.writeServiceSecret({
        clientId: "client-1",
        serviceId: "svc-1",
        key: "HQ_ORG_TOKEN",
        content: "secret",
      });
      if (written) await expect(write).resolves.toBeUndefined();
      else await expect(write).rejects.toBeDefined();
      expect(http.requests.some((request) => request.url.endsWith("/env"))).toBe(false);
      const search = http.requests.find((request) => request.url.endsWith("/user-data/search"));
      expect(JSON.parse(search?.body ?? "{}").search).toEqual([
        { name: "clientId", operator: "eq", value: "client-1" },
        { name: "serviceStackId", operator: "eq", value: "svc-1" },
        { name: "key", operator: "eq", value: "HQ_ORG_TOKEN" },
      ]);
    },
  );
});

describe("HQ birth project env", () => {
  it("reads plain journal values directly without the trailing search index", async () => {
    const http = recordingFetch(() =>
      jsonResponse(200, {
        envFile: 'OTHER="REDACTED"\nMATE_HQ_BIRTH_RECORD_0="{\\"version\\":1}"\n',
      }),
    );
    const client = new ZeropsApiClient({ fetch: http.fetch });
    client.restoreSession(SESSION);
    expect(await client.readProjectBirthEnv("hq1")).toEqual(
      new Map([["MATE_HQ_BIRTH_RECORD_0", '{"version":1}']]),
    );
    expect(http.requests[0]?.url).toContain("/project/hq1/env-file");
  });

  it("creates a non-sensitive create-once env slot and keeps its process handle", async () => {
    const http = recordingFetch(() => jsonResponse(200, { id: "process-env" }));
    const client = new ZeropsApiClient({ fetch: http.fetch });
    client.restoreSession(SESSION);
    expect(await client.createProjectEnv("hq1", "MATE_HQ_BIRTH_CLAIM_0", "claim")).toEqual({
      processId: "process-env",
    });
    expect(http.requests[0]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ key: "MATE_HQ_BIRTH_CLAIM_0", content: "claim", sensitive: false }),
    });
  });
});

describe("ZeropsApiClient.hasServiceVariable", () => {
  it("asks for the one key on the one service, never the service's every variable", async () => {
    for (const [items, has] of [
      [[{ key: "HQ_ORG_TOKEN", content: "REDACTED" }], true],
      [[], false],
    ] as const) {
      const stub = recordingFetch(() => jsonResponse(200, { items }));
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);
      await expect(
        client.hasServiceVariable({ clientId: "org-1", serviceId: "svc-hq", key: "HQ_ORG_TOKEN" }),
      ).resolves.toBe(has);
      expect(stub.requests).toHaveLength(1);
      expect(stub.requests[0]).toMatchObject({
        method: "POST",
        url: expect.stringMatching(/\/user-data\/search$/),
      });
      expect(JSON.parse(stub.requests[0]!.body!)).toEqual({
        search: [
          { name: "clientId", operator: "eq", value: "org-1" },
          { name: "serviceStackId", operator: "eq", value: "svc-hq" },
          { name: "key", operator: "eq", value: "HQ_ORG_TOKEN" },
        ],
        sort: [],
        limit: 1,
      });
    }
  });
});

describe("vault variable writes", () => {
  const BASE = `${DEFAULT_ZEROPS_API_BASE}/api/rest/public`;
  const write = { key: "STRIPE_KEY", content: "sk_test", sensitive: true };

  it.each<{
    readonly name: string;
    readonly call: (client: ZeropsApiClient) => Promise<{ readonly processId: string | undefined }>;
    readonly method: string;
    readonly url: string;
    readonly body: unknown;
  }>([
    {
      name: "adds a Shared value",
      call: (client) => client.addProjectVariable("p1", write),
      method: "POST",
      url: `${BASE}/project/p1/env`,
      body: write,
    },
    {
      name: "updates a Shared value, its sensitivity always said",
      call: (client) =>
        client.updateProjectVariable("e1", { key: "LOG_LEVEL", content: "warn", sensitive: false }),
      method: "PUT",
      url: `${BASE}/project-env/e1`,
      body: { key: "LOG_LEVEL", content: "warn", sensitive: false },
    },
    {
      name: "removes a Shared value",
      call: (client) => client.removeProjectVariable("e1"),
      method: "DELETE",
      url: `${BASE}/project-env/e1`,
      body: null,
    },
    {
      name: "adds a service's value",
      call: (client) => client.addServiceVariable("s1", write),
      method: "POST",
      url: `${BASE}/service-stack/s1/user-data`,
      body: write,
    },
    {
      name: "updates a service's value, its sensitivity always said",
      call: (client) => client.updateServiceVariable("u1", write),
      method: "PUT",
      url: `${BASE}/user-data/u1`,
      body: write,
    },
    {
      name: "removes a service's value",
      call: (client) => client.removeServiceVariable("u1"),
      method: "DELETE",
      url: `${BASE}/user-data/u1`,
      body: null,
    },
  ])("$name, answering its process", async ({ call, method, url, body }) => {
    const stub = recordingFetch(() => jsonResponse(200, { id: "process-1" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await expect(call(client)).resolves.toEqual({ processId: "process-1" });

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe(method);
    expect(stub.requests[0]?.url).toBe(url);
    const sent = stub.requests[0]?.body ?? null;
    expect(sent === null ? null : JSON.parse(sent)).toEqual(body);
  });

  it.each([
    {
      name: "reveals a Shared secret",
      call: (client: ZeropsApiClient) => client.revealProjectVariable("e1"),
      url: `${BASE}/project-env/e1/reveal`,
    },
    {
      name: "reveals a service's secret",
      call: (client: ZeropsApiClient) => client.revealServiceVariable("u1"),
      url: `${BASE}/user-data/u1/reveal`,
    },
  ])("$name: one GET, answering the decrypted content", async ({ call, url }) => {
    const stub = recordingFetch(() => jsonResponse(200, { content: "made-up-value" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await expect(call(client)).resolves.toBe("made-up-value");
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method ?? "GET").toBe("GET");
    expect(stub.requests[0]?.url).toBe(url);
  });

  it("keeps the platform's code on a refusal, never the value", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(400, { error: { code: "projectEnvDuplicateKey", message: "Duplicate key." } }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const error = await client.addProjectVariable("p1", write).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).code).toBe("projectEnvDuplicateKey");
    expect((error as ZeropsApiError).message).not.toContain("sk_test");
  });
});
