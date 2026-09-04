import { describe, expect, it, vi } from "@effect/vitest";

import {
  DEFAULT_ZEROPS_API_BASE,
  ZeropsApiClient,
  ZeropsApiError,
  buildZeropsContainerUrl,
  servicePortOrigin,
  zeropsClientsFromUser,
  zeropsRegionFromPublicZone,
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

describe("zeropsRegionFromPublicZone", () => {
  it("reads the region out of a project's publicZone, not just prg1", () => {
    expect(zeropsRegionFromPublicZone("fte2334ab.prg1-zerops.zone")).toBe("prg1");
    expect(zeropsRegionFromPublicZone("abc123.fra1-zerops.zone")).toBe("fra1");
    expect(zeropsRegionFromPublicZone("abc123.us-east-1-zerops.zone")).toBe("us-east-1");
  });

  it("returns null for a zone that does not match the shape", () => {
    expect(zeropsRegionFromPublicZone("example.com")).toBeNull();
    expect(zeropsRegionFromPublicZone("")).toBeNull();
  });
});

describe("buildZeropsContainerUrl", () => {
  it("composes the container origin from service, subdomain host, port and region", () => {
    expect(buildZeropsContainerUrl("zcp", "24cb", 8080, "prg1")).toBe(
      "https://zcp-24cb-8080.prg1.zerops.app",
    );
  });
});

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

  it("composes the origin for a subdomain-enabled http port", () => {
    expect(servicePortOrigin(project, service, { port: 80, scheme: "http" })).toBe(
      "https://weatherdash-26a7-80.prg1.zerops.app",
    );
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

  it("loads the locations available to the selected organization", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, {
        locationList: [
          { id: "prg1", name: "Prague", pingUrl: "https://ping.prg1.example" },
          { id: "ny1", name: "New York", pingUrl: "https://ping.ny1.example" },
        ],
      }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const locations = await client.listClientLocations("org-1");

    expect(locations.map((location) => location.id)).toEqual(["prg1", "ny1"]);
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/client/org-1/settings`,
    );
  });

  it("reads a project's services from the project-scoped direct read", async () => {
    const stub = recordingFetch(() =>
      jsonResponse(200, { list: [{ id: "s1", name: "zcp" }], totalCount: 1 }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const services = await client.listProjectServices("p1");

    expect(services.map((service) => service.id)).toEqual(["s1"]);
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/p1/service-stack`,
    );
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

  it("writes the Zerops Mate flag before restarting a container that lacks it", async () => {
    // The restart alone was the whole of "enable" and could not work: zcp
    // registers no mate step at all without this key, so the container came back
    // in the identical state it was restarted out of.
    const stub = recordingFetch((request) =>
      request.url.endsWith("/env")
        ? jsonResponse(200, { items: [{ id: "e1", key: "VSCODE_PASSWORD", content: "x" }] })
        : jsonResponse(200, { id: "process-1" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.enableZeropsMate("service-1");

    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
      `PUT ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/restart`,
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
    const stub = recordingFetch((request) =>
      request.url.endsWith("/env")
        ? jsonResponse(200, { items: [{ id: "e9", key: "ZCP_MATE_ENABLED", content: "0" }] })
        : jsonResponse(200, { id: "process-1" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.enableZeropsMate("service-1");

    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `DELETE ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/user-data/e9`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
      `PUT ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/restart`,
    ]);
  });

  it("writes nothing when the flag already reads as on, and still restarts", async () => {
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

      await client.enableZeropsMate("service-1");

      expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
        `PUT ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/restart`,
      ]);
    }
  });

  it("sends the Zerops token to the configured API base and nowhere else", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { list: [], totalCount: 0 }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      baseUrl: "https://api.app-fra1.zerops.io/",
    });
    client.restoreSession(SESSION);

    await client.listClientProjects("org-1");
    await client.listProjectServices("p1");

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

describe("ZeropsApiClient.fetchProjectProcesses", () => {
  it("reads the project's process list through the direct read", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { list: [{ id: "proc-1" }] }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const document = await client.fetchProjectProcesses("project-1");

    expect(document).toEqual({ list: [{ id: "proc-1" }] });
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/project-1/process`,
    );
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${SESSION.accessToken}`);
  });

  it("surfaces a forbidden project read as a typed ZeropsApiError", async () => {
    const stub = recordingFetch(() => jsonResponse(403, { error: { code: "forbidden" } }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    const error = await client.fetchProjectProcesses("project-1").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("forbidden");
  });

  /**
   * A background activity poll's own 401 is not evidence the account's
   * session is gone — it must reject (so the poller can mark that project
   * unavailable) without signing the whole UI out via `onSessionChange(null)`.
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

    const error = await client.fetchProjectProcesses("project-1").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect((error as ZeropsApiError).kind).toBe("expired-session");
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(client.session).toEqual(SESSION);
  });

  it("rejects on a 401 that survives a successful-looking retry, without clearing the session", async () => {
    const stub = recordingFetch((request) =>
      request.url.includes("/auth/refresh")
        ? jsonResponse(200, { accessToken: "access-2", refreshToken: "refresh-2" })
        : jsonResponse(401, { error: { code: "unauthorized" } }),
    );
    const onSessionChange = vi.fn();
    const client = new ZeropsApiClient({ fetch: stub.fetch, onSessionChange });
    client.restoreSession(SESSION);

    const error = await client.fetchProjectProcesses("project-1").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    // The refresh itself succeeded, so it is the one onSessionChange call this
    // path is allowed: adopting the new session is never gated by the flag,
    // only CLEARING a session on a failure is.
    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(onSessionChange).not.toHaveBeenCalledWith(null);
    expect(client.session).not.toBeNull();
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
    const pollerCall = client.fetchProjectProcesses("project-1").catch((cause: unknown) => cause);
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

    const first = client.fetchProjectProcesses("project-1").catch((cause: unknown) => cause);
    const second = client.fetchProjectProcesses("project-2").catch((cause: unknown) => cause);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBeInstanceOf(ZeropsApiError);
    expect(secondResult).toBeInstanceOf(ZeropsApiError);
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(client.session).toEqual(SESSION);
  });
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
   * gone elsewhere — mirrors `fetchProjectProcesses`.
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
});

describe("ZeropsApiClient.subscribeProjectSearch", () => {
  it("posts a list subscription for ServiceStack", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { items: [] }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.subscribeProjectSearch("service-stack", {
      orgId: "org-1",
      projectId: "proj-1",
      receiverId: "receiver-1",
      mode: "list",
    });

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/search`,
    );
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org-1" },
        { name: "projectId", operator: "eq", value: "proj-1" },
      ],
      sort: [],
      subscriptionName: "ServiceStack__list-subscription",
      receiverId: "receiver-1",
      wsOutputType: "listStream",
    });
  });

  it("posts an update subscription for Process with disableOutput", async () => {
    const stub = recordingFetch(() => jsonResponse(200, {}));
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.subscribeProjectSearch("process", {
      orgId: "org-1",
      projectId: "proj-1",
      receiverId: "receiver-1",
      mode: "update",
    });

    expect(stub.requests[0]?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/process/search`);
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org-1" },
        { name: "projectId", operator: "eq", value: "proj-1" },
      ],
      sort: [],
      subscriptionName: "Process__update-subscription",
      receiverId: "receiver-1",
      wsOutputType: "updateStream",
      disableOutput: true,
    });
  });
});

describe("ZeropsApiClient.adoptPersonalToken", () => {
  // The hand-over from app.zerops.io delivers a personal access token, which is
  // already a bearer — there is nothing to exchange. What there is to do is
  // prove it works before storing it, so a dead token never becomes a
  // signed-in-looking UI.
  it("proves the token before storing it, and stores exactly it", async () => {
    const stored: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() => jsonResponse(200, { id: "user-9", email: "a@b.c" }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });

    const session = await client.adoptPersonalToken("pt-abc");

    // One call, and it carried the token as the bearer.
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/user/info`);
    expect(stub.requests[0]?.authorization).toBe("Bearer pt-abc");
    expect(session.accessToken).toBe("pt-abc");
    // No refresh token: a personal token does not have one, and the 401 path
    // must clear the session rather than try to refresh it.
    expect(session.refreshToken).toBeUndefined();
    expect(stored).toEqual([session]);
  });

  it("stores nothing when the token is refused", async () => {
    const stored: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() => jsonResponse(401, { error: { code: "notAuthorized" } }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });

    await expect(client.adoptPersonalToken("dead")).rejects.toBeInstanceOf(ZeropsApiError);
    expect(client.session).toBeNull();
    expect(stored.filter((s) => s !== null)).toEqual([]);
  });

  it("will not spend a request on an empty hand-over", async () => {
    const stub = recordingFetch(() => jsonResponse(200, {}));
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    await expect(client.adoptPersonalToken("  ")).rejects.toBeInstanceOf(ZeropsApiError);
    expect(stub.requests).toHaveLength(0);
  });
});
