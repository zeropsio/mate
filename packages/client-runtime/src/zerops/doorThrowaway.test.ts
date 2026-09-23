// @effect-diagnostics globalDate:off -- fake timers own `Date.now()`; the clients under test read it.
import * as DateTime from "effect/DateTime";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
import { ACCOUNT_WINDOW_WAIT_MS, ZeropsApiClient, ZeropsApiError, type ZeropsUser } from "./api.ts";
import { mateDiagnostics } from "./diagnostics.ts";
import {
  connectThroughThrowaway,
  planThrowawaySweep,
  THROWAWAY_SWEEP_AGE_MS,
  zeropsThrowawayPlatform,
} from "./doorThrowaway.ts";
import { makeFakeZeropsRest } from "./testing/fakeZeropsRest.ts";

const NOW = Date.parse("2026-09-16T10:00:00.000Z");
const at = (msAgo: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - msAgo));

describe("planThrowawaySweep", () => {
  // Only ours, only stale. Everything else on the account's token list is
  // somebody's working credential.
  for (const [name, token, swept] of [
    [
      "a door throwaway older than five minutes",
      { id: "a", name: "mate-door:p1:n", created: at(THROWAWAY_SWEEP_AGE_MS + 1_000) },
      true,
    ],
    [
      "a Gitea sign-in throwaway older than five minutes",
      { id: "b", name: "gitea-signin:git.example.com:n", created: at(600_000) },
      true,
    ],
    [
      "a throwaway another tab may still be mid-flight with",
      { id: "c", name: "mate-door:p1:n", created: at(30_000) },
      false,
    ],
    [
      "a Mate's own key, whatever its age",
      { id: "d", name: "zcp-acme", created: at(90 * 24 * 60 * 60 * 1000) },
      false,
    ],
    [
      "something merely named like one",
      { id: "e", name: "mate-doorstop", created: at(600_000) },
      false,
    ],
    ["a token with no name at all", { id: "f", created: at(600_000) }, false],
    // A token nobody can date is a token nobody can call stale.
    [
      "a throwaway whose created stamp does not parse",
      { id: "g", name: "mate-door:p1:n", created: "recently" },
      false,
    ],
    ["a throwaway with no created stamp", { id: "h", name: "mate-door:p1:n" }, false],
  ] as const) {
    it(`${swept ? "sweeps" : "leaves"} ${name}`, () => {
      expect(planThrowawaySweep({ tokens: [token], nowEpochMs: NOW })).toEqual(
        swept ? [token.id] : [],
      );
    });
  }

  it("sweeps every stale throwaway in one pass", () => {
    const stale = planThrowawaySweep({
      tokens: [
        { id: "a", name: "mate-door:p1:n", created: at(600_000) },
        { id: "b", name: "zcp-acme", created: at(600_000) },
        { id: "c", name: "gitea-signin:git.example.com:n", created: at(600_000) },
      ],
      nowEpochMs: NOW,
    });
    expect(stale).toEqual(["a", "c"]);
  });
});

describe("connectThroughThrowaway", () => {
  const platform = (calls: Array<string>): ZeropsThrowawayPlatform => ({
    mint: async (input) => {
      calls.push(`mint ${input.name}`);
      return { id: "token-1", token: "a-value" };
    },
    remove: async (input) => {
      calls.push(`remove ${input.tokenId}`);
    },
  });

  it("mints, connects and deletes, in that order", async () => {
    const calls: Array<string> = [];
    const answer = await connectThroughThrowaway({
      platform: platform(calls),
      clientId: "org",
      projectId: "p1",
      nonce: "n1",
      connect: async (token) => {
        calls.push("connect");
        return token;
      },
    });

    expect(answer).toBe("a-value");
    expect(calls).toEqual(["mint mate-door:p1:n1", "connect", "remove token-1"]);
  });

  it("deletes even when the connect threw, and re-throws what threw", async () => {
    const calls: Array<string> = [];
    await expect(
      connectThroughThrowaway({
        platform: platform(calls),
        clientId: "org",
        projectId: "p1",
        nonce: "n1",
        connect: async () => {
          throw new Error("the network went away");
        },
      }),
    ).rejects.toThrow("the network went away");

    expect(calls).toEqual(["mint mate-door:p1:n1", "remove token-1"]);
  });
});

describe("zeropsThrowawayPlatform's diagnostics", () => {
  it("tells door and Gitea mints apart and pairs each delete with its mint", async () => {
    const client = {
      mintThrowaway: async (input: { readonly name: string }) =>
        input.name.startsWith("gitea-signin:")
          ? { id: "gitea-token", token: "a-value" }
          : { id: "door-token", token: "a-value" },
      deleteIntegrationToken: async (input: { readonly tokenId: string }) => {
        if (input.tokenId === "gitea-token") throw new ZeropsApiError("gone", "not-found", 404);
      },
    } as unknown as ZeropsApiClient;
    const throwaways = zeropsThrowawayPlatform(client);
    mateDiagnostics.enable();
    mateDiagnostics.clear();

    const door = await throwaways.mint({ clientId: "org", name: "mate-door:p1:n1" });
    await throwaways.remove({ clientId: "org", tokenId: door.id });
    const gitea = await throwaways.mint({ clientId: "org", name: "gitea-signin:git.example:n2" });
    await expect(throwaways.remove({ clientId: "org", tokenId: gitea.id })).rejects.toThrow("gone");

    expect(mateDiagnostics.snapshot().map(({ t: _t, ...event }) => event)).toEqual([
      {
        kind: "throwaway",
        action: "mint",
        purpose: "door",
        clientId: "org",
        outcome: "ok",
        tokenId: "door-token",
      },
      {
        kind: "throwaway",
        action: "delete",
        clientId: "org",
        tokenId: "door-token",
        outcome: "ok",
      },
      {
        kind: "throwaway",
        action: "mint",
        purpose: "gitea",
        clientId: "org",
        outcome: "ok",
        tokenId: "gitea-token",
      },
      {
        kind: "throwaway",
        action: "delete",
        clientId: "org",
        tokenId: "gitea-token",
        outcome: "failed",
        code: "ZeropsApiError:not-found",
        status: 404,
      },
    ]);
    expect(JSON.stringify(mateDiagnostics.snapshot())).not.toContain("a-value");
  });
});

const ACCESS_WINDOW_MS = 15 * 60 * 1000;

function member(id: string, roleCode: string): ZeropsUser {
  return {
    id,
    email: `${id}@example.test`,
    clientUserList: [{ id: `cu-${id}`, clientId: "org-1", roleCode }],
  };
}

/**
 * One tab signed in to the account harness's Zerops, its access window open
 * as the inventory provider opens it after a grant.
 */
function signedInTab(roleCode = "OWNER") {
  const rest = makeFakeZeropsRest();
  rest.addUser({ user: member("user-1", roleCode), password: "one" });
  const client = new ZeropsApiClient({ fetch: rest.fetch, now: () => Date.now() });
  client.restoreSession(rest.issueSession("user-1"));
  client.setWritesAllowed(true, Date.now() + ACCESS_WINDOW_MS);
  const mints = () => rest.requests().filter(({ route }) => route.startsWith("POST /client/"));
  const throwaways = () => zeropsThrowawayPlatform(client);
  return { rest, client, mints, throwaways };
}

/** Lets every promise that can settle without a timer settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("throwaway hygiene", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mint during a round proceeds", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    // A renewal round is in flight: its reads have left and not come back.
    const round = tab.rest.hold("GET /user/info");
    const renewal = tab.client.fetchUser();
    await settle();
    expect(round.waiting()).toBe(1);

    const minted = await tab.throwaways().mint({
      clientId: "org-1",
      name: "mate-door:p1:n1",
    });

    expect(minted.id).toBe("integration-1");
    expect(tab.mints()).toHaveLength(1);
    round.release();
    await renewal;
  });

  it("mint during a lapse waits, then runs on the new grant", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    tab.client.setWritesAllowed(false);

    const minting = tab.throwaways().mint({
      clientId: "org-1",
      name: "mate-door:p1:n1",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tab.mints()).toHaveLength(0);

    tab.client.setWritesAllowed(true, Date.now() + ACCESS_WINDOW_MS);

    await expect(minting).resolves.toMatchObject({ id: "integration-1" });
    expect(tab.mints()).toHaveLength(1);
  });

  it("bound elapses → retryable", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    tab.client.setWritesAllowed(false);

    const minting = tab
      .throwaways()
      .mint({ clientId: "org-1", name: "mate-door:p1:n1" })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    await vi.advanceTimersByTimeAsync(ACCOUNT_WINDOW_WAIT_MS - 1);
    expect(tab.mints()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    const failure = await minting;
    expect(failure).toBeInstanceOf(ZeropsApiError);
    expect((failure as ZeropsApiError).kind).toBe("access-unverified");
    expect(tab.mints()).toHaveLength(0);
    // A grant after the attempt gave up mints nothing on its behalf.
    tab.client.setWritesAllowed(true, Date.now() + ACCESS_WINDOW_MS);
    await settle();
    expect(tab.mints()).toHaveLength(0);
  });

  // CM-3: the organization's write flag would lock these members out, and
  // the door and the broker are what decide their roles.
  for (const row of [
    { member: "a BASIC_USER", roleCode: "BASIC_USER", override: null },
    { member: "a READ_ONLY-with-override", roleCode: "READ_ONLY", override: "ADMIN" },
  ] as const) {
    it(`${row.member} member can mint`, async () => {
      vi.useFakeTimers();
      const tab = signedInTab(row.roleCode);
      tab.rest.addProject({
        id: "p1",
        clientId: "org-1",
        name: "One",
        status: "ACTIVE",
        ...(row.override === null
          ? {}
          : { userRoles: [{ clientUserId: "cu-user-1", roleCode: row.override }] }),
      });
      const platform = tab.throwaways();

      const door = await platform.mint({ clientId: "org-1", name: "mate-door:p1:n1" });
      const gitea = await platform.mint({ clientId: "org-1", name: "gitea-signin:git.example:n2" });
      await platform.remove({ clientId: "org-1", tokenId: door.id });
      await platform.remove({ clientId: "org-1", tokenId: gitea.id });

      expect(tab.mints().map(({ body }) => body)).toEqual([
        expect.objectContaining({ name: "mate-door:p1:n1", roleCode: "NO_ACCESS", projects: [] }),
        expect.objectContaining({ name: "gitea-signin:git.example:n2", roleCode: "NO_ACCESS" }),
      ]);
      expect(tab.rest.orphanTokens()).toEqual([]);
    });
  }
});
