import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import type { ZeropsUser } from "../api.ts";
import type { ZeropsSession } from "../session.ts";
import {
  ZEROPS_RENEWAL_MARGIN_MS,
  makeZeropsSessionCalls,
  probeZeropsPrincipal,
  type ZeropsPrincipalVerdict,
} from "./zeropsSession.ts";

const BASE_URL = "https://api.example.test";
const person: ZeropsUser = { id: "user-1", email: "person@example.test", clientUserList: [] };
const stored: ZeropsSession = { accessToken: "access-1", refreshToken: "refresh-1" };
const next: ZeropsSession = { accessToken: "access-2", refreshToken: "refresh-2" };
const user = (u: ZeropsUser): ZeropsPrincipalVerdict => ({ kind: "user", user: u });
const unauthorized: ZeropsPrincipalVerdict = { kind: "unauthorized" };
const unavailable: ZeropsPrincipalVerdict = { kind: "unavailable" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The platform as the session calls meet it: one answer per path, every request recorded. */
function platform(answers: Readonly<Record<string, () => Response | Promise<Response>>>) {
  const sent: Array<string> = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/rest/public", "");
    sent.push(`${init?.method ?? "GET"} ${path}`);
    const answer = answers[path];
    if (answer === undefined) throw new Error(`No answer for ${path}`);
    return answer();
  };
  return { fetch, sent };
}

describe("makeZeropsSessionCalls", () => {
  it.each([
    [
      "the person the sign-in answered with",
      { auth: stored, user: person },
      ["POST /auth/login"],
      person,
    ],
    [
      "the person read after a sign-in that named none",
      { auth: stored, user: null },
      ["POST /auth/login", "GET /user/info"],
      person,
    ],
    [
      "nobody while the second factor is outstanding",
      { auth: { ...stored, twoFAMethods: ["totp"], twoFAVerified: false }, user: null },
      ["POST /auth/login"],
      null,
    ],
  ] as const)("signs in to %s", async (_name, login, requests, signedIn) => {
    const { fetch, sent } = platform({
      "/auth/login": () => json(200, login),
      "/user/info": () => json(200, person),
    });
    const calls = makeZeropsSessionCalls({ fetch, baseUrl: BASE_URL });

    expect(await calls.signIn("person@example.test", "secret")).toEqual(signedIn);
    expect(sent).toEqual(requests);
  });

  it("adopts a handed-over token only once a read proved it, and names its person", async () => {
    const kept: Array<ZeropsSession | null> = [];
    const { fetch, sent } = platform({ "/user/info": () => json(200, person) });
    const calls = makeZeropsSessionCalls({
      fetch,
      baseUrl: BASE_URL,
      onSessionChange: (session) => {
        kept.push(session);
      },
    });

    const adopted = await calls.adoptToken({ accessToken: "pat" });

    expect(adopted).toEqual({ session: { accessToken: "pat" }, user: person });
    expect(kept).toEqual([{ accessToken: "pat" }]);
    expect(sent).toEqual(["GET /user/info", "GET /user/info"]);
  });

  it("signs out locally even when the platform cannot end the session", async () => {
    const kept: Array<ZeropsSession | null> = [];
    const { fetch } = platform({ "/auth/logout": () => json(503, {}) });
    const calls = makeZeropsSessionCalls({
      fetch,
      baseUrl: BASE_URL,
      onSessionChange: (session) => {
        kept.push(session);
      },
    });
    calls.client.restoreSession(stored);

    await calls.signOutAtPlatform();

    expect(calls.client.session).toBeNull();
    expect(kept.at(-1)).toBeNull();
  });
});

describe("probeZeropsPrincipal", () => {
  it.each([
    [429, { "retry-after": "20" }, { kind: "unavailable", retryAfterMs: 20_000 }],
    [503, {}, { kind: "unavailable" }],
    [401, {}, { kind: "unauthorized" }],
  ] as const)("reads a %i as %j", async (status, headers, verdict) => {
    const answer = await probeZeropsPrincipal(
      { fetch: async () => new Response("{}", { status, headers }), baseUrl: BASE_URL },
      stored,
    );
    expect(answer).toEqual(verdict);
  });

  it.each([
    [200, user(person)],
    [401, unauthorized],
    [503, unavailable],
  ] as const)("reads one user/info with the access token alone (%s)", async (status, verdict) => {
    const sent: Array<{ readonly path: string; readonly authorization: string | null }> = [];
    const fetch = async (input: string, init?: RequestInit) => {
      sent.push({
        path: new URL(input).pathname,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return json(status, status === 200 ? person : { error: { code: "x" } });
    };

    const answer = await probeZeropsPrincipal({ fetch, baseUrl: BASE_URL }, next);

    expect(answer).toEqual(verdict);
    expect(sent).toEqual([
      { path: "/api/rest/public/user/info", authorization: "Bearer access-2" },
    ]);
  });

  it("answers unavailable when the network fails", async () => {
    const answer = await probeZeropsPrincipal(
      {
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
        baseUrl: BASE_URL,
      },
      next,
    );

    expect(answer).toEqual(unavailable);
  });
});

describe("makeZeropsSessionCalls renews ahead", () => {
  const at = Date.parse("2026-10-14T12:00:00Z");
  const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
  const renewedSession = { ...next, expiresAt: iso(at + 6 * 60 * 60_000) };

  it("a session's first read within the renewal margin carries the renewed token, never the one it revokes", async () => {
    const bearers: Array<string | null> = [];
    const { fetch, sent } = platform({
      "/auth/refresh": () => json(200, renewedSession),
      "/user/info": () => json(200, person),
    });
    const calls = makeZeropsSessionCalls(
      {
        fetch: (input, init) => {
          bearers.push(new Headers(init?.headers).get("authorization"));
          return fetch(input, init);
        },
        baseUrl: BASE_URL,
      },
      () => at,
    );
    calls.client.restoreSession({ ...stored, expiresAt: iso(at + ZEROPS_RENEWAL_MARGIN_MS - 1) });

    await expect(calls.readUser()).resolves.toEqual(person);
    expect(sent).toEqual(["POST /auth/refresh", "GET /user/info"]);
    expect(bearers).toEqual([null, "Bearer access-2"]);
  });

  it("a session another tab renewed is adopted for the read, and this tab renews nothing itself", async () => {
    const { fetch, sent } = platform({ "/user/info": () => json(200, person) });
    const calls = makeZeropsSessionCalls(
      { fetch, baseUrl: BASE_URL, renewSession: async () => renewedSession },
      () => at,
    );
    calls.client.restoreSession({ ...stored, expiresAt: iso(at + 60_000) });

    await expect(calls.readUser()).resolves.toEqual(person);
    expect(sent).toEqual(["GET /user/info"]);
    expect(calls.client.session).toBe(renewedSession);
  });
});

describe("makeZeropsSessionCalls.freshBearer", () => {
  const at = Date.parse("2026-10-14T12:00:00Z");
  const margin = 15 * 60_000;

  it.each([
    ["renews first inside the fifteen-minute margin", "2026-10-14T12:10:00Z", "access-2"],
    ["keeps a session with time left", "2026-10-14T13:00:00Z", "access-1"],
  ])("%s", async (_case, expiresAt, bearer) => {
    const { fetch, sent } = platform({ "/auth/refresh": () => json(200, next) });
    const calls = makeZeropsSessionCalls({ fetch, baseUrl: BASE_URL });
    calls.client.restoreSession({ ...stored, expiresAt });

    await expect(calls.freshBearer(margin, at)).resolves.toBe(bearer);
    expect(sent).toEqual(bearer === "access-2" ? ["POST /auth/refresh"] : []);
  });

  // A device login lives six hours, measured against the platform.
  const HOUR = 60 * 60_000;
  const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

  it.each([
    ["six hours, a device login's whole life", 6 * HOUR],
    ["just over the margin", ZEROPS_RENEWAL_MARGIN_MS + 1],
  ])(
    "a session with more than the renewal margin left is not renewed when the app loads (%s)",
    async (_left, remainingMs) => {
      const { fetch, sent } = platform({ "/auth/refresh": () => json(200, next) });
      const calls = makeZeropsSessionCalls({ fetch, baseUrl: BASE_URL });
      calls.client.restoreSession({
        ...stored,
        expiresAt: iso(at + remainingMs),
      });

      await expect(calls.freshBearer(ZEROPS_RENEWAL_MARGIN_MS, at)).resolves.toBe("access-1");
      expect(sent).toEqual([]);
    },
  );

  it.each([
    ["at the margin", ZEROPS_RENEWAL_MARGIN_MS - 1],
    ["with a minute left", 60_000],
  ])("a session within the renewal margin renews once, before it ends (%s)", async (_left, ms) => {
    const { fetch, sent } = platform({
      "/auth/refresh": () => json(200, { ...next, expiresAt: iso(at + 6 * HOUR) }),
    });
    const calls = makeZeropsSessionCalls({ fetch, baseUrl: BASE_URL });
    calls.client.restoreSession({ ...stored, expiresAt: iso(at + ms) });

    await expect(calls.freshBearer(ZEROPS_RENEWAL_MARGIN_MS, at)).resolves.toBe("access-2");
    await expect(calls.freshBearer(ZEROPS_RENEWAL_MARGIN_MS, at + 1)).resolves.toBe("access-2");
    expect(sent).toEqual(["POST /auth/refresh"]);
  });

  it("never renews a personal token, which has no refresh token", async () => {
    const { fetch, sent } = platform({});
    const calls = makeZeropsSessionCalls({ fetch, baseUrl: BASE_URL });
    calls.client.restoreSession({ accessToken: "pat-1", expiresAt: "2026-10-14T12:01:00Z" });

    await expect(calls.freshBearer(margin, at)).resolves.toBe("pat-1");
    expect(sent).toEqual([]);
  });

  it("answers no bearer when nothing is held", async () => {
    const calls = makeZeropsSessionCalls({ fetch: platform({}).fetch, baseUrl: BASE_URL });
    await expect(calls.freshBearer(margin, at)).resolves.toBeNull();
  });
});
