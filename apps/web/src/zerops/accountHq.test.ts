import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsApiClient } from "@t3tools/client-runtime/zerops";

import { accountHqApi, configuredHq, useOfficialHq } from "./accountHq";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { ZeropsSessionContext } from "./sessionContext";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";

/** React has published the layer's answer, not merely admitted its request. */
const reconciled = (assertion: () => void) =>
  vi.waitFor(
    async () => {
      await act(async () => {});
      assertion();
    },
    { timeout: 5_000 },
  );

// Audit K7: HQ's session lived in a tab's memory only, so every load paid a throwaway's mint and
// delete through HQ's door, and a sign-out left the session HQ issued valid for its 12 hours.
describe("accountHqApi — HQ's session, kept as the Mates' sessions are", () => {
  const HQ = { projectId: "P_HQ", address: "https://hq.example.test" };
  const HOUR_MS = 3_600_000;
  /** What HQ was asked, in order. */
  let calls: Array<{
    readonly method: string;
    readonly path: string;
    readonly authorization: string | null;
  }>;
  /** How long a session HQ issues from now on lasts. */
  let lifetimeMs: number;
  /** How many door calls from now on HQ answers 503, before it admits. */
  let unanswered: number;
  /** The throwaways each door call presented, in order. */
  let presented: Array<unknown>;
  let stored: Map<string, string>;
  /** This test's run: the page remembers every token it ended, so no two tests share one. */
  let run = 0;
  /** The `n`th session HQ issued in this test. */
  const issuedSession = (n: number) => `session-${String(run)}-${String(n)}`;

  beforeEach(() => {
    run += 1;
    calls = [];
    lifetimeMs = 12 * HOUR_MS;
    unanswered = 0;
    presented = [];
    stored = new Map();
    let issued = 0;
    // The account's scoped storage reads this browser's `window.localStorage`.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.pathname === "/api/door") {
        presented.push(
          (JSON.parse(String(init?.body)) as { readonly accessToken: unknown }).accessToken,
        );
        if (unanswered > 0) {
          unanswered -= 1;
          return Response.json({ code: "zerops_unanswered" }, { status: 503 });
        }
        return Response.json({
          session: issuedSession(++issued),
          expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
          orgId: "org-1",
          userId: "u1",
        });
      }
      if (url.pathname === "/api/structure") return Response.json({ apps: [] });
      return new Response(null, { status: 204 });
    });
    openAccountLifetime("person-1");
  });
  afterEach(() => {
    // The close ends what the account kept: HQ is still there to hear it.
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  /** The page's account epochs only grow, across tests too: the mint budget is fenced by them. */
  let epoch = 0;
  /** A load's client: each load builds its own, and reads the access token for every door. */
  const load = () => {
    let mints = 0;
    epoch += 1;
    const client = {
      accountEpoch: epoch,
      accessToken: async () => {
        mints += 1;
        return { token: "access" };
      },
    } as unknown as ZeropsApiClient;
    return { client, doors: () => mints };
  };

  it("a reload with a kept session that is still valid comes through no door", async () => {
    const first = load();
    await accountHqApi(first.client, "org-1", HQ).structure();
    expect(first.doors()).toBe(1);

    const reload = load();
    await accountHqApi(reload.client, "org-1", HQ).structure();

    expect(reload.doors()).toBe(0);
    expect(calls.at(-1)).toEqual({
      method: "GET",
      path: "/api/structure",
      authorization: `Bearer ${issuedSession(1)}`,
    });
  });

  it("a reload whose kept session is ending comes through one door, and keeps the new one", async () => {
    // HQ issued a session that ends in ten minutes: within the lead, it is not presented again.
    lifetimeMs = 10 * 60_000;
    await accountHqApi(load().client, "org-1", HQ).structure();
    lifetimeMs = 12 * HOUR_MS;

    const reload = load();
    await accountHqApi(reload.client, "org-1", HQ).structure();
    expect(reload.doors()).toBe(1);
    expect(calls.at(-1)?.authorization).toBe(`Bearer ${issuedSession(2)}`);

    const again = load();
    await accountHqApi(again.client, "org-1", HQ).structure();
    expect(again.doors()).toBe(0);
    expect(calls.at(-1)?.authorization).toBe(`Bearer ${issuedSession(2)}`);
  });

  it("a door that answers 503 is tried again with the access token, minting nothing", async () => {
    unanswered = 1;
    const first = load();
    const api = accountHqApi(first.client, "org-1", HQ);
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable" });
    await api.structure();

    expect(presented).toEqual(["access", "access"]);
  });

  it.each(["door", "renewal"] as const)(
    "the verified native account cannot change ZCP authorizer during HQ %s",
    async (phase) => {
      const client = new ZeropsApiClient();
      client.restoreSession({ accessToken: "original-person-access" });
      const api = accountHqApi(client, "org-1", HQ);
      if (phase === "renewal") {
        lifetimeMs = 10 * 60_000;
        await api.structure();
      }
      const before = globalThis.fetch;
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(String(input)).pathname === "/api/door") {
          started.resolve();
          await release.promise;
        }
        return before(input, init);
      });
      const establishing = api.establishZcpAuthorization?.("source-project", {
        keyHash: "a".repeat(64),
      });
      await started.promise;
      // Native session adoption precedes the renderer learning which person now owns the client.
      client.restoreSession({ accessToken: "next-person-access" });
      release.resolve();
      await expect(establishing).rejects.toMatchObject({ code: "account_changed" });
      expect(calls.filter((call) => call.path.endsWith("/zcp-authorization"))).toEqual([]);
    },
  );

  it("a sign-out revokes HQ's session and forgets it", async () => {
    await accountHqApi(load().client, "org-1", HQ).structure();

    closeAccountLifetime();
    // The close ends the account's sessions once no other tab holds it open.
    await reconciled(() => expect(calls.at(-1)?.method).toBe("DELETE"));

    expect(calls.at(-1)).toEqual({
      method: "DELETE",
      path: "/api/session",
      authorization: `Bearer ${issuedSession(1)}`,
    });
    expect([...stored.keys()].filter((key) => key.endsWith(":hq-sessions.v1"))).toEqual([]);
    // Signed in again, nothing is kept: the next load comes through the door.
    openAccountLifetime("person-1");
    const next = load();
    await accountHqApi(next.client, "org-1", HQ).structure();
    expect(next.doors()).toBe(1);
  });
});

describe("a web built with an HQ origin — one shared HQ every organization signs in to", () => {
  const SHARED = "https://hq.shared.test";
  /** What the shared HQ's door was handed, in order. */
  let doors: Array<unknown>;
  /** What HQ was asked, by path, in order. */
  let paths: Array<string>;
  let stored: Map<string, string>;
  /** The page's account epochs only grow, across tests too: the mint budget is fenced by them. */
  let epoch = 10_000;

  beforeEach(() => {
    doors = [];
    paths = [];
    stored = new Map();
    let issued = 0;
    vi.stubEnv("VITE_HQ_ORIGIN", SHARED);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(`${url.origin}${url.pathname}`);
      if (url.pathname === "/api/door") {
        doors.push(JSON.parse(String(init?.body)));
        return Response.json({
          session: `shared-session-${String(++issued)}`,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          orgId: "org-1",
          userId: "u1",
        });
      }
      if (url.pathname === "/api/structure") return Response.json({ apps: [] });
      return new Response(null, { status: 204 });
    });
    openAccountLifetime("person-shared");
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** A signed-in person's client in `org-1`. */
  const person = () => {
    epoch += 1;
    const client = {
      accountEpoch: epoch,
      accessToken: async () => ({ token: "access" }),
    } as unknown as ZeropsApiClient;
    return { client };
  };

  const sharedApi = (client: ZeropsApiClient) => {
    return accountHqApi(client, "org-1", configuredHq());
  };

  it("A web built with an HQ origin signs in to that HQ", async () => {
    const { client } = person();
    const session = {
      client,
      activeOrganization: { id: "org-1" },
    } as unknown as ZeropsSessionValue;
    const seen: Array<ReturnType<typeof useOfficialHq>> = [];
    function Probe() {
      seen.push(useOfficialHq());
      return null;
    }
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        createElement(ZeropsSessionContext.Provider, { value: session }, createElement(Probe)),
      );
    });
    const official = seen.at(-1);
    expect(official?.address).toBe(SHARED);
    await official?.api.structure();
    expect(paths).toEqual([`${SHARED}/api/door`, `${SHARED}/api/structure`]);
    await act(async () => {
      tree?.unmount();
    });
  });

  it("keeps the official HQ effect identity when the anchor still names the same address and API", async () => {
    const { client } = person();
    const session = {
      client,
      activeOrganization: { id: "org-1" },
    } as unknown as ZeropsSessionValue;
    const seen: Array<ReturnType<typeof useOfficialHq>> = [];
    function Probe() {
      seen.push(useOfficialHq());
      return null;
    }
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        createElement(ZeropsSessionContext.Provider, { value: session }, createElement(Probe)),
      );
    });
    const first = seen.find((hq) => hq !== null);
    expect(first).toBeDefined();
    await act(async () => {
      tree?.update(
        createElement(ZeropsSessionContext.Provider, { value: session }, createElement(Probe)),
      );
    });
    expect(configuredHq()).toBe(configuredHq());
    expect(seen.filter((hq) => hq !== null).every((hq) => hq === first)).toBe(true);
    await act(async () => {
      tree?.unmount();
    });
  });

  it("Signing in to a shared HQ presents the person's Zerops access token and the organisation", async () => {
    const { client } = person();
    await sharedApi(client).structure();

    expect(doors).toEqual([{ accessToken: "access", orgId: "org-1" }]);
  });
});
