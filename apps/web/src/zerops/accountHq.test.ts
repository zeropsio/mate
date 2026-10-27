import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { classifyHqCall } from "@t3tools/client-runtime/data";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";

import {
  accountHqApi,
  configuredHq,
  nextHqStanding,
  useOfficialHq,
  type HqStanding,
} from "./accountHq";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { hqOutage } from "./hqNavigation";
import { keptHqSessions } from "./keptSessions";
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

describe("nextHqStanding", () => {
  const parts = { quarantined: [] };
  const healthy = { kind: "healthy", build: "b1", parts } as const;
  const down = { kind: "unreachable" } as const;
  const unchecked = { kind: "unchecked", build: "b1", parts } as const;
  it.each<[string, HqStanding, Parameters<typeof nextHqStanding>[1], HqStanding]>([
    [
      "a first answer as the official HQ",
      { kind: "unknown" },
      healthy,
      { kind: "healthy", build: "b1", parts },
    ],
    [
      "a first read that fails: unavailable from now",
      { kind: "unknown" },
      down,
      { kind: "unavailable", since: 5_000 },
    ],
    [
      "an outage keeps the time it began",
      { kind: "unavailable", since: 1_000 },
      { kind: "not-ready", state: "standby", official: "unknown" },
      { kind: "unavailable", since: 1_000 },
    ],
    [
      "HQ back",
      { kind: "unavailable", since: 1_000 },
      healthy,
      { kind: "healthy", build: "b1", parts },
    ],
    // An HQ that serves but cannot check Zerops right now is no outage: everything keeps using it.
    [
      "an HQ that cannot check Zerops",
      { kind: "healthy", build: "b1", parts },
      unchecked,
      { kind: "unchecked", build: "b1", parts },
    ],
    [
      "an HQ answering again, Zerops still unchecked",
      { kind: "unavailable", since: 1_000 },
      unchecked,
      { kind: "unchecked", build: "b1", parts },
    ],
    [
      "an unchecked HQ that stops answering: unavailable from now",
      { kind: "unchecked", build: "b1", parts },
      down,
      { kind: "unavailable", since: 5_000 },
    ],
    // The build it runs, as its health says it, so an offered update costs no read of its own.
    [
      "a new build answering",
      { kind: "healthy", build: "b1", parts },
      { kind: "healthy", build: "b2", parts },
      { kind: "healthy", build: "b2", parts },
    ],
    // How its parts stand, as its newest answer reports them: no read of their own.
    [
      "a backup that failed since the last answer",
      {
        kind: "healthy",
        build: "b1",
        parts: { quarantined: [], backup: { state: "ok", takenAt: 1 } },
      },
      {
        kind: "healthy",
        build: "b1",
        parts: { quarantined: [], backup: { state: "failed", reason: "store" } },
      },
      {
        kind: "healthy",
        build: "b1",
        parts: { quarantined: [], backup: { state: "failed", reason: "store" } },
      },
    ],
  ])("%s", (_name, previous, health, expected) => {
    expect(nextHqStanding(previous, health, 5_000)).toEqual(expected);
  });
});

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
  /** How many door calls from now on HQ answers it is not serving, before it admits. */
  let notServing: number;
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
    notServing = 0;
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
        if (notServing > 0) {
          notServing -= 1;
          return Response.json({ code: "not_active" }, { status: 503 });
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
        return "access";
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

  it("a door HQ is not serving is tried again with the access token, minting nothing", async () => {
    notServing = 1;
    const first = load();
    const api = accountHqApi(first.client, "org-1", HQ);
    await expect(api.structure()).rejects.toMatchObject({ kind: "unavailable" });
    await api.structure();

    expect(presented).toEqual(["access", "access"]);
  });

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
  let doors: Array<{
    readonly accessToken: unknown;
    readonly orgId: unknown;
    readonly orgKey?: unknown;
  }>;
  /** What HQ was asked, by path, in order. */
  let paths: Array<string>;
  /** Whether an Owner or Admin has started the organization at HQ. */
  let started: boolean;
  /** HQ refuses the organization's key the door hands it. */
  let keyRejected: boolean;
  let stored: Map<string, string>;
  /** The page's account epochs only grow, across tests too: the mint budget is fenced by them. */
  let epoch = 10_000;

  beforeEach(() => {
    doors = [];
    paths = [];
    started = true;
    keyRejected = false;
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
        const body = JSON.parse(String(init?.body)) as (typeof doors)[number];
        doors.push(body);
        if (!started && body.orgKey === undefined)
          return Response.json({ code: "org_not_started" }, { status: 409 });
        if (keyRejected && body.orgKey !== undefined)
          return Response.json({ code: "forbidden", reason: "org_key_rejected" }, { status: 403 });
        started = true;
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

  /** A signed-in person's client in `org-1` with `roleCode` there, counting what it mints. */
  const person = (roleCode: string) => {
    const keys: Array<unknown> = [];
    const taken: Array<string> = [];
    epoch += 1;
    const client = {
      accountEpoch: epoch,
      accessToken: async () => "access",
      verifiedUser: () => ({
        user: { clientUserList: [{ id: "m-1", clientId: "org-1", roleCode, status: "ACTIVE" }] },
        atMs: 0,
      }),
      mintIntegrationToken: async (input: unknown) => {
        keys.push(input);
        return { id: "org-key-id", token: "org-key-1" };
      },
      deleteIntegrationToken: async (input: { readonly tokenId: string }) => {
        taken.push(input.tokenId);
      },
    } as unknown as ZeropsApiClient;
    return { client, keys, taken };
  };

  const sharedApi = (client: ZeropsApiClient) => {
    const hq = configuredHq();
    if (hq === undefined) throw new Error("This build names no HQ.");
    return accountHqApi(client, "org-1", hq);
  };

  it("A web built with an HQ origin signs in to that HQ", async () => {
    const { client } = person("OWNER");
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

  it("Signing in to a shared HQ presents the person's Zerops access token and the organisation", async () => {
    const { client, keys } = person("BASIC_USER");
    await sharedApi(client).structure();

    expect(doors).toEqual([{ accessToken: "access", orgId: "org-1" }]);
    expect(keys).toEqual([]);
  });

  it("An Owner's first sign-in to an organisation the HQ has not started hands it a read-only key and then signs in", async () => {
    started = false;
    const { client, keys, taken } = person("OWNER");
    await sharedApi(client).structure();

    expect(keys).toEqual([
      { clientId: "org-1", name: "mate-hq-org-key", roleCode: "READ_ONLY", projects: [] },
    ]);
    // The second plain sign-in is the one inside the lock, which finds the organisation started
    // by another tab when there is one.
    expect(doors).toEqual([
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1", orgKey: "org-key-1" },
    ]);
    expect(paths.at(-1)).toBe(`${SHARED}/api/structure`);
    // HQ keeps the key it took: nothing here takes it back.
    expect(taken).toEqual([]);
  });

  it("A member's sign-in to an organisation no Owner has started says an Owner or Admin must sign in first", async () => {
    started = false;
    const { client, keys } = person("BASIC_USER");
    const refusal = await sharedApi(client)
      .structure()
      .then(
        () => null,
        (cause: unknown) => cause,
      );

    expect(refusal).toMatchObject({ kind: "refused", code: "org_not_started" });
    expect(keys).toEqual([]);
    expect(doors).toEqual([{ accessToken: "access", orgId: "org-1" }]);
    // The menu says it, with Try again as the way out once an Owner or Admin has signed in.
    const navigation = {
      live: false,
      refusal: classifyHqCall(refusal).message,
      capped: false,
      reconnecting: false,
      slow: false,
      structure: null,
    };
    expect(hqOutage(navigation, null, "24-hour", 0)).toEqual({
      kind: "refused",
      line: "An Owner or Admin of this organization must sign in to Mate first. Then try again.",
      again: true,
    });
  });

  it("An organisation's key HQ did not accept tells the person to sign in again as an Owner or Admin", async () => {
    started = false;
    keyRejected = true;
    const { client } = person("OWNER");
    const refusal = await sharedApi(client)
      .structure()
      .then(
        () => null,
        (cause: unknown) => cause,
      );

    expect(refusal).toMatchObject({ kind: "refused", code: "forbidden" });
    // The second plain sign-in is the one inside the lock, which finds the organisation started
    // by another tab when there is one.
    expect(doors).toEqual([
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1" },
      { accessToken: "access", orgId: "org-1", orgKey: "org-key-1" },
    ]);
    const navigation = {
      live: false,
      refusal: classifyHqCall(refusal).message,
      capped: false,
      reconnecting: false,
      slow: false,
      structure: null,
    };
    expect(hqOutage(navigation, null, "24-hour", 0)).toEqual({
      kind: "refused",
      line: "HQ did not accept the organization's key. Sign in again as an Owner or Admin.",
      again: true,
    });
  });
});
