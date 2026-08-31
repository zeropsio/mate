import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_ZEROPS_API_BASE,
  ZeropsApiClient,
  ZeropsApiError,
  buildZeropsContainerUrl,
  requiresZeropsTwoFactor,
  zeropsClientsFromUser,
  zeropsRegionFromPublicZone,
  type ZeropsSession,
} from "./api.ts";

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

  it("writes the Zerops Code flag before restarting a container that lacks it", async () => {
    // The restart alone was the whole of "enable" and could not work: zcp
    // registers no z3 step at all without this key, so the container came back
    // in the identical state it was restarted out of.
    const stub = recordingFetch((request) =>
      request.url.endsWith("/env")
        ? jsonResponse(200, { items: [{ id: "e1", key: "VSCODE_PASSWORD", content: "x" }] })
        : jsonResponse(200, { id: "process-1" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.enableZeropsCode("service-1");

    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/env`,
      `POST ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/user-data`,
      `PUT ${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/service-1/restart`,
    ]);
    // `sensitive` is required on every service userData write — the platform
    // rejects the POST outright with "field is required" when it is absent.
    expect(JSON.parse(stub.requests[1]?.body ?? "{}")).toEqual({
      key: "ZCP_Z3_ENABLED",
      content: "1",
      sensitive: true,
    });
  });

  it("replaces a Zerops Code flag that is present but switched off", async () => {
    // The platform exposes create and delete for a single key, no update, so an
    // upsert is delete-then-create. The bulk env-file PUT is not an option: it
    // replaces the whole file and drops every other var the user set.
    const stub = recordingFetch((request) =>
      request.url.endsWith("/env")
        ? jsonResponse(200, { items: [{ id: "e9", key: "ZCP_Z3_ENABLED", content: "0" }] })
        : jsonResponse(200, { id: "process-1" }),
    );
    const client = new ZeropsApiClient({ fetch: stub.fetch });
    client.restoreSession(SESSION);

    await client.enableZeropsCode("service-1");

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
          ? jsonResponse(200, { items: [{ id: "e9", key: "ZCP_Z3_ENABLED", content }] })
          : jsonResponse(200, { id: "process-1" }),
      );
      const client = new ZeropsApiClient({ fetch: stub.fetch });
      client.restoreSession(SESSION);

      await client.enableZeropsCode("service-1");

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

describe("ZeropsApiClient.adoptHandedOverSession", () => {
  // The hand-over from app.zerops.io delivers one string. Everything else the
  // session needs comes back from the exchange.
  it("exchanges a bare refresh token with no bearer, and stores what comes back", async () => {
    const stored: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() =>
      jsonResponse(200, {
        accessToken: "access-9",
        refreshToken: "refresh-9",
        userId: "user-9",
        expiresIn: 900,
      }),
    );
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });

    const session = await client.adoptHandedOverSession("handed-over-1");

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/auth/refresh`);
    expect(stub.requests[0]?.method).toBe("POST");
    // `/authorize` in the platform's own GUI performs this exchange straight
    // after logging out, so the call is proven not to need one.
    expect(stub.requests[0]?.authorization).toBeNull();
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      refreshTokenId: "handed-over-1",
    });
    // `/auth/refresh` answers with the session fields at the top level, unlike
    // `/auth/login`, which wraps them in `auth`.
    expect(session.accessToken).toBe("access-9");
    expect(client.session?.accessToken).toBe("access-9");
    expect(stored).toEqual([session]);
  });

  it("refuses a token the platform will not exchange, and stores nothing", async () => {
    const stored: Array<ZeropsSession | null> = [];
    const stub = recordingFetch(() => jsonResponse(401, { error: { code: "notAuthorized" } }));
    const client = new ZeropsApiClient({
      fetch: stub.fetch,
      onSessionChange: (session) => {
        stored.push(session);
      },
    });

    await expect(client.adoptHandedOverSession("stale")).rejects.toBeInstanceOf(ZeropsApiError);
    expect(client.session).toBeNull();
    expect(stored).toEqual([]);
  });

  it("refuses a response that is not a usable session rather than half-signing in", async () => {
    const stub = recordingFetch(() => jsonResponse(200, { accessToken: "" }));
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    await expect(client.adoptHandedOverSession("rt")).rejects.toBeInstanceOf(ZeropsApiError);
    expect(client.session).toBeNull();
  });

  it("will not spend a request on an empty hand-over", async () => {
    const stub = recordingFetch(() => jsonResponse(200, {}));
    const client = new ZeropsApiClient({ fetch: stub.fetch });

    await expect(client.adoptHandedOverSession("  ")).rejects.toBeInstanceOf(ZeropsApiError);
    expect(stub.requests).toHaveLength(0);
  });
});
