// @effect-diagnostics globalDate:off -- fake timers own `Date.now()`; the clients under test read it.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
import {
  ZeropsApiClient,
  ZeropsApiError,
  type FetchImplementation,
  type ZeropsUser,
} from "./api.ts";
import { mateDiagnostics } from "./diagnostics.ts";
import {
  connectThroughThrowaway,
  DOOR_MINT_BURST,
  DOOR_MINT_PACE,
  DOOR_MINT_THROTTLE_MS,
  makeMintPace,
  makeThrowawayDebt,
  makeThrowawayMintBudgets,
  planExpiredThrowaways,
  planThrowawaySweep,
  THROWAWAY_REUSE_MS,
  THROWAWAY_SWEEP_AGE_MS,
  zeropsThrowawayPlatform,
} from "./doorThrowaway.ts";
import type { ZeropsSession } from "./session.ts";
import { makeFakeZeropsRest } from "./testing/fakeZeropsRest.ts";

const NOW = Date.parse("2026-09-16T10:00:00.000Z");

describe("planThrowawaySweep", () => {
  // Exactly what this browser owes, by its handle: everything else on the account's token list is
  // somebody's — another tab's, another device's, a working credential — however old.
  it.each([
    {
      case: "an owed throwaway, by the id its mint answered, listed or not",
      tokens: [],
      owed: [{ attempt: "mate-door:p1:n1", tokenId: "a" }],
      swept: ["a"],
    },
    {
      case: "an owed throwaway whose mint answer was lost, by its name",
      tokens: [{ id: "b", name: "mate-door:p1:n2" }],
      owed: [{ attempt: "mate-door:p1:n2" }],
      swept: ["b"],
    },
    {
      case: "never another tab's or device's throwaway",
      tokens: [{ id: "c", name: "mate-door:p1:n3" }],
      owed: [{ attempt: "mate-door:p1:n1", tokenId: "a" }],
      swept: ["a"],
    },
    {
      case: "never a throwaway named like an owed one, but not it",
      tokens: [{ id: "d", name: "mate-door:p1:n4" }],
      owed: [{ attempt: "mate-door:p1:n44" }],
      swept: [],
    },
    {
      case: "never a token named as an owed id's mint was, under another id",
      tokens: [{ id: "e2", name: "mate-door:p1:n5" }],
      owed: [{ attempt: "mate-door:p1:n5", tokenId: "e" }],
      swept: ["e"],
    },
    {
      case: "never a Mate's own key, whatever is owed",
      tokens: [{ id: "f", name: "zcp-acme" }],
      owed: [{ attempt: "zcp-acme" }],
      swept: [],
    },
    {
      case: "never a token with no name at all",
      tokens: [{ id: "g" }],
      owed: [{ attempt: "mate-door:p1:n7" }],
      swept: [],
    },
  ])("$case", ({ tokens, owed, swept }) => {
    expect(planThrowawaySweep({ tokens, owed })).toEqual(swept);
  });
});

describe("planExpiredThrowaways", () => {
  // Past the door's window no door admits a throwaway, so the person's own is dead weight
  // whichever tab or device minted it; by the platform's own `created`, never a local record.
  const expired = new Date(NOW - THROWAWAY_SWEEP_AGE_MS - 1).toISOString();
  const own = { name: "mate-door:p1:n1", createdByUser: "ada", created: expired };
  it.each([
    { case: "the person's own throwaway past the door's window", token: own, swept: ["t"] },
    {
      case: "never one a door may still admit",
      token: { ...own, created: new Date(NOW - THROWAWAY_SWEEP_AGE_MS).toISOString() },
      swept: [],
    },
    { case: "never another person's", token: { ...own, createdByUser: "bob" }, swept: [] },
    {
      case: "never one whose creator is not listed",
      token: { name: own.name, created: expired },
      swept: [],
    },
    { case: "never a Mate's own key", token: { ...own, name: "zcp-acme" }, swept: [] },
    { case: "never one with no mint time", token: { ...own, created: undefined }, swept: [] },
    {
      case: "never one with an unreadable mint time",
      token: { ...own, created: "soon" },
      swept: [],
    },
  ])("$case", ({ token, swept }) => {
    expect(
      planExpiredThrowaways({ tokens: [{ id: "t", ...token }], userId: "ada", nowEpochMs: NOW }),
    ).toEqual(swept);
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

describe("the door's mint pace", () => {
  /** The background mint's gap at the pace's steady rate. */
  const GAP = 60_000 / DOOR_MINT_PACE.perMinute;
  type Step =
    | { readonly at: number; readonly spend: "asked" | "background" }
    | { readonly at: number; readonly throttled: number | null };
  const run = (steps: ReadonlyArray<Step>) => {
    const pace = makeMintPace(DOOR_MINT_PACE);
    for (const step of steps) {
      if ("spend" in step) {
        // A background mint is spent only once the pace lets it start.
        if (step.spend === "background") expect(pace.readyAt(step.at)).toBeLessThanOrEqual(step.at);
        pace.spend(step.at);
      } else pace.throttled(step.at, step.throttled);
    }
    return pace;
  };
  const spends = (count: number, spend: "asked" | "background", at = 0): Array<Step> =>
    Array.from({ length: count }, () => ({ at, spend }));

  it("the platform's own limit leaves the pace at least half its headroom", () => {
    // Measured 2026-10-01: 80 mints, each deleted at once, in 14 s, drew no 429. The most the pace
    // ever starts in a minute is a full bucket and a minute's refill.
    expect(DOOR_MINT_PACE.burst + DOOR_MINT_PACE.perMinute).toBeLessThanOrEqual(80 / 2);
    expect(DOOR_MINT_PACE.burst).toBe(DOOR_MINT_BURST);
  });

  it.each([
    ["a fresh tab starts a full bucket at once", [], 0, 0, 0],
    ["the mint past a full bucket waits one gap", spends(DOOR_MINT_BURST, "background"), 0, 0, GAP],
    [
      "the bucket refills one mint a gap",
      [...spends(DOOR_MINT_BURST, "background"), { at: GAP, spend: "background" } as const],
      GAP,
      0,
      2 * GAP,
    ],
    [
      "an idle bucket never fills past the burst",
      [{ at: 0, spend: "background" } as const, ...spends(DOOR_MINT_BURST, "background", 600_000)],
      600_000,
      0,
      600_000 + GAP,
    ],
    [
      "a mint promised to a descriptor read counts as spent",
      spends(DOOR_MINT_BURST - 1, "background"),
      0,
      1,
      GAP,
    ],
    [
      "asked-for mints spend past empty, and the background waits the debt out",
      [...spends(DOOR_MINT_BURST, "background"), ...spends(3, "asked")],
      0,
      0,
      4 * GAP,
    ],
    [
      "the debt is bounded by one bucket",
      [...spends(DOOR_MINT_BURST, "background"), ...spends(50, "asked")],
      0,
      0,
      (DOOR_MINT_BURST + 1) * GAP,
    ],
    [
      "a 429 holds the background for the throttle, then refills from empty",
      [{ at: 0, throttled: null } as const],
      0,
      0,
      DOOR_MINT_THROTTLE_MS + GAP,
    ],
    [
      "a 429's Retry-After holds the background when it is the longer",
      [{ at: 0, throttled: 90_000 } as const],
      0,
      0,
      90_000 + GAP,
    ],
    [
      "an asked-for mint during a hold extends the wait by a gap",
      [{ at: 0, throttled: null } as const, { at: 1_000, spend: "asked" } as const],
      1_000,
      0,
      DOOR_MINT_THROTTLE_MS + 2 * GAP,
    ],
  ] as const)("%s", (_name, steps, now, owed, readyAt) => {
    expect(run(steps as ReadonlyArray<Step>).readyAt(now, owed)).toBeCloseTo(readyAt, 6);
  });
});

describe("zeropsThrowawayPlatform's diagnostics", () => {
  it("pairs each delete with its mint, and says a failed delete by its code", async () => {
    const client = {
      mintThrowaway: async (input: { readonly name: string }) => ({
        id: `token-${input.name.slice(-1)}`,
        token: "a-value",
        mintingToken: "access-1",
      }),
      deleteThrowaway: async (input: { readonly tokenId: string }) => {
        if (input.tokenId === "token-2") throw new ZeropsApiError("gone", "not-found", 404);
      },
    } as unknown as ZeropsApiClient;
    const throwaways = zeropsThrowawayPlatform(client);
    mateDiagnostics.enable();
    mateDiagnostics.clear();

    const first = await throwaways.mint({ clientId: "org", name: "mate-door:p1:n1" });
    await throwaways.remove({ clientId: "org", tokenId: first.id });
    const second = await throwaways.mint({ clientId: "org", name: "mate-door:p2:n2" });
    await expect(throwaways.remove({ clientId: "org", tokenId: second.id })).rejects.toThrow(
      "gone",
    );

    expect(mateDiagnostics.snapshot().map(({ t: _t, ...event }) => event)).toEqual([
      { kind: "throwaway", action: "mint", clientId: "org", outcome: "ok", tokenId: "token-1" },
      { kind: "throwaway", action: "delete", clientId: "org", tokenId: "token-1", outcome: "ok" },
      { kind: "throwaway", action: "mint", clientId: "org", outcome: "ok", tokenId: "token-2" },
      {
        kind: "throwaway",
        action: "delete",
        clientId: "org",
        tokenId: "token-2",
        outcome: "failed",
        code: "ZeropsApiError:not-found",
        status: 404,
      },
    ]);
    expect(JSON.stringify(mateDiagnostics.snapshot())).not.toContain("a-value");
  });
});

// Step A, open question 10: an organization's tokens are listed only to take back what this
// browser failed to delete — so a failed delete is owed, and one that went through is not.
describe("zeropsThrowawayPlatform's debt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores only this account's persisted organization debt after a reload", () => {
    const entries = new Map<string, string>();
    const storage = (account: string) => ({
      getItem: (key: string) => entries.get(`${account}:${key}`) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(`${account}:${key}`, value);
      },
      removeItem: (key: string) => {
        entries.delete(`${account}:${key}`);
      },
    });
    const debt = makeThrowawayDebt(storage("ada"));
    debt.owe("org-1", NOW);
    expect(makeThrowawayDebt(storage("ada")).failedAt("org-1")).toBe(NOW);
    expect(makeThrowawayDebt(storage("bea")).failedAt("org-1")).toBeNull();
    expect(makeThrowawayDebt(storage("ada")).failedAt("org-2")).toBeNull();
    debt.settle("org-1", NOW);
    expect(makeThrowawayDebt(storage("ada")).failedAt("org-1")).toBeNull();
  });

  it("keeps cleanup owed in memory if storage reads work but writes are blocked", () => {
    const debt = makeThrowawayDebt({
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    debt.owe("org-1", NOW);
    expect(debt.failedAt("org-1")).toBe(NOW);
  });

  it("records debt before mint so a crash during mint or door exchange can be swept", async () => {
    vi.useFakeTimers({ now: NOW });
    const debt = makeThrowawayDebt();
    const client = {
      mintThrowaway: async () => {
        expect(debt.failedAt("org-1")).toBe(NOW);
        return { id: "crash-token", token: "throwaway", mintingToken: "minting" };
      },
    } as unknown as ZeropsApiClient;
    await zeropsThrowawayPlatform(client, { debt }).mint({
      clientId: "org-1",
      name: "mate-door:crash:n1",
    });
    expect(debt.failedAt("org-1")).toBe(NOW);
  });

  it("keeps the id its mint answered with its debt, through a reload", async () => {
    vi.useFakeTimers({ now: NOW });
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    const debt = makeThrowawayDebt(storage);
    const client = {
      mintThrowaway: async () => ({ id: "door-1", token: "throwaway", mintingToken: "minting" }),
    } as unknown as ZeropsApiClient;
    debt.owe("org-1", NOW - 1, "mate-door:lost:n0");
    await zeropsThrowawayPlatform(client, { debt }).mint({
      clientId: "org-1",
      name: "mate-door:p1:n1",
    });
    const owed = [
      { attempt: "mate-door:lost:n0" },
      { attempt: "mate-door:p1:n1", tokenId: "door-1" },
    ];
    expect(debt.owed("org-1", NOW)).toEqual(owed);
    expect(makeThrowawayDebt(storage).owed("org-1", NOW)).toEqual(owed);
    // Only what was owed by then: a mint since is another door's, still in its window.
    expect(debt.owed("org-1", NOW - 1)).toEqual([{ attempt: "mate-door:lost:n0" }]);
  });

  it("successful cleanup never settles another door's outstanding token", async () => {
    vi.useFakeTimers({ now: NOW });
    const debt = makeThrowawayDebt();
    let next = 0;
    const client = {
      mintThrowaway: async () => ({
        id: `concurrent-${++next}`,
        token: "throwaway",
        mintingToken: "minting",
      }),
      deleteThrowaway: async () => {},
    } as unknown as ZeropsApiClient;
    const platform = zeropsThrowawayPlatform(client, { debt });
    const first = await platform.mint({ clientId: "org-1", name: "mate-door:concurrent:n1" });
    await platform.mint({ clientId: "org-1", name: "mate-door:concurrent:n2" });
    await platform.remove({ clientId: "org-1", tokenId: first.id });
    expect(debt.failedAt("org-1")).toBe(NOW);
  });

  it("owes the organization a sweep where a delete failed, and nothing where it went through", async () => {
    vi.useFakeTimers({ now: NOW });
    const client = {
      mintThrowaway: async (input: { readonly name: string }) => ({
        id: `token-${input.name.slice(-1)}`,
        token: "a-value",
        mintingToken: "access-1",
      }),
      deleteThrowaway: async (input: { readonly tokenId: string }) => {
        if (input.tokenId === "token-2") throw new ZeropsApiError("refused", "forbidden", 403);
      },
    } as unknown as ZeropsApiClient;
    const debt = makeThrowawayDebt();
    const throwaways = zeropsThrowawayPlatform(client, { debt });

    const kept = await throwaways.mint({ clientId: "org-a", name: "mate-door:p1:n1" });
    await throwaways.remove({ clientId: "org-a", tokenId: kept.id });
    const left = await throwaways.mint({ clientId: "org-b", name: "mate-door:p2:n2" });
    await expect(throwaways.remove({ clientId: "org-b", tokenId: left.id })).rejects.toThrow(
      "refused",
    );

    expect([debt.failedAt("org-a"), debt.failedAt("org-b")]).toEqual([null, NOW]);
    // A sweep over what failed before it settles it; one that failed since stays owed.
    debt.settle("org-b", NOW - 1);
    expect(debt.failedAt("org-b")).toBe(NOW);
    debt.settle("org-b", NOW);
    expect(debt.failedAt("org-b")).toBeNull();
  });
});

/** A verified Zerops account. */
function member(id: string, roleCode: string): ZeropsUser {
  return {
    id,
    email: `${id}@example.test`,
    clientUserList: [{ id: `cu-${id}`, clientId: "org-1", roleCode }],
  };
}

/** A browser's fetch: a request whose signal is already aborted never leaves. */
function browserFetch(fetch: FetchImplementation): FetchImplementation {
  return (input, init) =>
    init?.signal?.aborted === true
      ? Promise.reject(new DOMException("This operation was aborted", "AbortError"))
      : fetch(input, init);
}

/** One tab signed in to the account harness's Zerops, with a verified principal. */
function signedInTab(roleCode = "OWNER") {
  const rest = makeFakeZeropsRest();
  rest.addUser({ user: member("user-1", roleCode), password: "one" });
  rest.addUser({ user: member("user-2", "OWNER"), password: "two" });
  const sessionChanges: Array<ZeropsSession | null> = [];
  const client = new ZeropsApiClient({
    fetch: browserFetch(rest.fetch),
    onSessionChange: (session) => {
      sessionChanges.push(session);
    },
  });
  const session = rest.issueSession("user-1");
  client.restoreSession(session);
  const mints = () => rest.requests().filter(({ route }) => route.startsWith("POST /client/"));
  // Budgets of its own, so one case's mints never wait on another's.
  const budgets = makeThrowawayMintBudgets(() => Date.now());
  const throwaways = (options: { readonly signal?: AbortSignal; readonly asked?: boolean } = {}) =>
    zeropsThrowawayPlatform(client, { ...options, budgets });
  return { rest, client, session, sessionChanges, mints, throwaways };
}

/** Lets every promise that can settle without a timer settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("throwaway hygiene", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The client's half of T-L6: requests in flight never hold a mint.
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

  // AL-12: the account-write admission changes nothing about a lost answer.
  // Zerops may hold the token, so the mint is uncertain, never a network
  // failure a caller would read as "nothing happened".
  it("a rights-less mint whose answer is lost is uncertain", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const client = new ZeropsApiClient({
      fetch: async (input, init) => {
        const response = await tab.rest.fetch(input, init);
        if (init?.method === "POST") throw new TypeError("Failed to fetch");
        return response;
      },
    });
    client.restoreSession(tab.session);

    const failure = await zeropsThrowawayPlatform(client, { budgets: makeThrowawayMintBudgets() })
      .mint({ clientId: "org-1", name: "mate-door:p1:n1" })
      .then(
        () => null,
        (cause: unknown) => cause,
      );

    expect(failure).toMatchObject({ kind: "uncertain" });
    expect(tab.rest.integrationTokens()).toHaveLength(1);
  });

  it("aborting the exchange after the mint still deletes the token", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const exchange = new AbortController();
    const orphaned: Array<unknown> = [];

    const connecting = connectThroughThrowaway({
      platform: tab.throwaways({ signal: exchange.signal }),
      clientId: "org-1",
      projectId: "p1",
      nonce: "n1",
      onOrphaned: (cause) => orphaned.push(cause),
      // The door has the throwaway when the exchange is given up.
      connect: () =>
        new Promise<never>((_resolve, reject) => {
          exchange.signal.addEventListener("abort", () => reject(exchange.signal.reason), {
            once: true,
          });
        }),
    }).catch(() => "aborted");
    await settle();
    expect(tab.rest.integrationTokens()).toHaveLength(1);

    exchange.abort();

    await expect(connecting).resolves.toBe("aborted");
    expect(orphaned).toEqual([]);
    expect(tab.rest.orphanTokens()).toEqual([]);
    expect(tab.rest.integrationTokens()[0]?.deletedWith).toBe(tab.session.accessToken);
  });

  for (const row of [
    { next: "another person", email: "user-2@example.test", password: "two", revoked: true },
    { next: "the same person", email: "user-1@example.test", password: "one", revoked: true },
    { next: "another person", email: "user-2@example.test", password: "two", revoked: false },
  ] as const) {
    it(`finalizer 401 after sign-out/sign-in never clears the new session and never runs under another principal (${row.next}, first session ${row.revoked ? "revoked" : "alive"})`, async () => {
      vi.useFakeTimers();
      const tab = signedInTab();
      const orphaned: Array<unknown> = [];
      let signedInAgain: ZeropsSession | undefined;

      await connectThroughThrowaway({
        platform: tab.throwaways(),
        clientId: "org-1",
        projectId: "p1",
        nonce: "n1",
        onOrphaned: (cause) => orphaned.push(cause),
        // While the door answers, the person signs out and somebody signs in.
        connect: async () => {
          await tab.client.signOutLocally();
          if (row.revoked) tab.rest.expireAccessToken(tab.session.accessToken);
          signedInAgain = (await tab.client.login(row.email, row.password)).auth;
          return "connected";
        },
      });
      await settle();

      const deletes = tab.rest.requests().filter(({ route }) => route.startsWith("DELETE "));
      expect(deletes.map(({ token }) => token)).toEqual([tab.session.accessToken]);
      expect(tab.client.session?.accessToken).toBe(signedInAgain?.accessToken);
      expect(tab.sessionChanges.at(-1)?.accessToken).toBe(signedInAgain?.accessToken);
      expect(tab.rest.refreshes()).toBe(0);
      if (row.revoked) {
        expect(orphaned).toHaveLength(1);
        expect(tab.rest.orphanTokens()).toHaveLength(1);
      } else {
        expect(orphaned).toEqual([]);
        expect(tab.rest.integrationTokens()[0]?.deletedWith).toBe(tab.session.accessToken);
      }
    });
  }

  // CM-3: the organization's write flag would lock these members out, and
  // the door and HQ are what decide their roles.
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
      await platform.remove({ clientId: "org-1", tokenId: door.id });

      expect(tab.mints().map(({ body }) => body)).toEqual([
        expect.objectContaining({ name: "mate-door:p1:n1", roleCode: "NO_ACCESS", projects: [] }),
      ]);
      expect(tab.rest.orphanTokens()).toEqual([]);
    });
  }

  it("a background door mint past the bucket waits its gap; an asked-for one never waits", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const mint = (name: string, asked = false) =>
      tab.throwaways({ asked }).mint({ clientId: "org-1", name });
    const minted = (prefix: string) =>
      tab.mints().filter(({ body }) => (body as { name: string }).name.startsWith(prefix)).length;
    const gap = 60_000 / DOOR_MINT_PACE.perMinute;

    for (let n = 1; n <= DOOR_MINT_BURST; n += 1) await mint(`mate-door:p1:${n}`);
    expect(minted("mate-door:")).toBe(DOOR_MINT_BURST);

    const background = mint("mate-door:p1:background");
    await settle();
    expect(minted("mate-door:")).toBe(DOOR_MINT_BURST);

    // The Mate the person asked for is minted at once, past the empty bucket.
    await mint("mate-door:p2:asked", true);
    expect(minted("mate-door:")).toBe(DOOR_MINT_BURST + 1);

    // The background one waits out its own gap and the asked-for mint's.
    await vi.advanceTimersByTimeAsync(2 * gap - 1);
    expect(minted("mate-door:")).toBe(DOOR_MINT_BURST + 1);
    await vi.advanceTimersByTimeAsync(1);
    await background;
    expect(minted("mate-door:")).toBe(DOOR_MINT_BURST + 2);
  });

  it("a door mint the platform throttles holds the background ones, never an asked-for one", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const mint = (name: string, asked = false) =>
      tab.throwaways({ asked }).mint({ clientId: "org-1", name });
    const throttled = tab.rest.hold("POST /client/org-1/integration-token");
    const first = mint("mate-door:p1:1").then(
      () => null,
      (cause: unknown) => cause,
    );
    await settle();
    throttled.fail(429);
    expect(await first).toMatchObject({ status: 429 });

    const background = mint("mate-door:p1:2");
    await mint("mate-door:p2:asked", true);
    expect(tab.mints()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(DOOR_MINT_THROTTLE_MS);
    expect(tab.mints()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2 * (60_000 / DOOR_MINT_PACE.perMinute));
    await background;
    expect(tab.mints()).toHaveLength(3);
  });

  it("a mint queued behind the budget is dropped when somebody else signs in meanwhile", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const platform = tab.throwaways();
    for (let n = 1; n <= DOOR_MINT_BURST; n += 1)
      await platform.mint({ clientId: "org-1", name: `mate-door:p1:${n}` });
    const eleventh = platform.mint({ clientId: "org-1", name: "mate-door:p1:11" }).then(
      () => null,
      (cause: unknown) => cause,
    );
    await settle();

    await tab.client.signOutLocally();
    await tab.client.login("user-2@example.test", "two");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await eleventh).toMatchObject({ kind: "expired-session" });
    expect(tab.mints().filter(({ token }) => token !== tab.session.accessToken)).toEqual([]);
  });

  it("the next account in the tab starts with a budget of its own", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const platform = tab.throwaways();
    for (let n = 1; n <= DOOR_MINT_BURST; n += 1)
      await platform.mint({ clientId: "org-1", name: `mate-door:p1:${n}` });

    await tab.client.signOutLocally();
    const next = (await tab.client.login("user-2@example.test", "two")).auth;
    const first = platform.mint({ clientId: "org-1", name: "mate-door:p1:next" });
    await settle();

    expect(tab.mints().filter(({ token }) => token === next.accessToken)).toHaveLength(1);
    await first;
  });

  // KRLS, 2026-10-03: while the organization's reads stalled, one person's HQ door left eight
  // `mate-door:` throwaways in 21 s, one per try, none deleted. A door's next try presents the
  // throwaway its last try was not taken with, while it is young — never one mint per try.
  it("a door's next try presents the throwaway its last try was not taken with", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const presented: Array<string> = [];
    const notTaken = (outcome: { readonly ok: boolean }) => !outcome.ok;
    await expect(
      connectThroughThrowaway({
        platform: tab.throwaways({ asked: true }),
        clientId: "org-1",
        projectId: "p-hq",
        nonce: "n1",
        keep: notTaken,
        connect: async (token) => {
          presented.push(token);
          throw new Error("HQ's door did not answer.");
        },
      }),
    ).rejects.toThrow("HQ's door did not answer.");
    await settle();
    expect(tab.rest.orphanTokens()).toHaveLength(1);

    await expect(
      connectThroughThrowaway({
        platform: tab.throwaways({ asked: true }),
        clientId: "org-1",
        projectId: "p-hq",
        nonce: "n2",
        keep: notTaken,
        connect: async (token) => {
          presented.push(token);
          return "admitted";
        },
      }),
    ).resolves.toBe("admitted");
    await settle();

    expect(tab.mints()).toHaveLength(1);
    expect(new Set(presented).size).toBe(1);
    // Taken at last, it is deleted.
    expect(tab.rest.orphanTokens()).toEqual([]);
  });

  it("a throwaway held for a door nobody tries again is deleted once it is no longer young", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    await expect(
      connectThroughThrowaway({
        platform: tab.throwaways({ asked: true }),
        clientId: "org-1",
        projectId: "p-hq",
        nonce: "n1",
        keep: () => true,
        connect: async () => {
          throw new Error("HQ's door did not answer.");
        },
      }),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(THROWAWAY_REUSE_MS - 1);
    expect(tab.rest.orphanTokens()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.rest.orphanTokens()).toEqual([]);

    // The door's next try, past it, mints a new one.
    await connectThroughThrowaway({
      platform: tab.throwaways({ asked: true }),
      clientId: "org-1",
      projectId: "p-hq",
      nonce: "n2",
      connect: async () => "admitted",
    });
    expect(tab.mints()).toHaveLength(2);
  });

  // KRLS, 2026-10-03: mints the stall took past their answer stood on the account, and nothing
  // here knew to sweep them.
  it("a mint whose answer was lost owes the organization a sweep", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const client = new ZeropsApiClient({
      fetch: async (input, init) => {
        const response = await tab.rest.fetch(input, init);
        if (init?.method === "POST") throw new TypeError("Failed to fetch");
        return response;
      },
    });
    client.restoreSession(tab.session);
    const debt = makeThrowawayDebt();
    const platform = zeropsThrowawayPlatform(client, {
      budgets: makeThrowawayMintBudgets(() => Date.now()),
      debt,
    });
    await expect(
      platform.mint({ clientId: "org-1", name: "mate-door:p1:n1" }),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect(tab.rest.integrationTokens()).toHaveLength(1);
    expect(debt.failedAt("org-1")).toBe(Date.now());
  });

  it.each([
    { kind: "forbidden" as const, status: 403, state: "failed" },
    { kind: "network" as const, status: null, state: "unknown" },
  ])("persists a $state cleanup outcome and its exact target without credentials", async (row) => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    const debt = makeThrowawayDebt(storage);
    const remove = vi
      .fn()
      .mockRejectedValue(new ZeropsApiError("Delete refused.", row.kind, row.status));
    const client = {
      mintThrowaway: async () => ({
        id: "receipt-token",
        token: "throwaway-secret",
        mintingToken: "account-secret",
      }),
      deleteThrowaway: remove,
    } as unknown as ZeropsApiClient;
    const platform = zeropsThrowawayPlatform(client, { debt });
    await platform.mint({ clientId: "org-receipt", name: "mate-door:receipt:n1" });
    await expect(
      platform.remove({ clientId: "org-receipt", tokenId: "receipt-token" }),
    ).rejects.toThrow("Delete refused.");
    const restored = makeThrowawayDebt(storage);
    expect(restored.cleanupFailures("org-receipt")).toEqual([
      {
        attempt: "mate-door:receipt:n1",
        tokenId: "receipt-token",
        state: row.state,
        reason: "Delete refused.",
      },
    ]);
    expect(restored.sweepFailed("org-receipt")).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...entries.values()])).not.toContain("secret");
  });

  it("ends a failed delete after one attempt and leaves visible debt for the sweep", async () => {
    vi.useFakeTimers();
    const tab = signedInTab();
    const debt = makeThrowawayDebt();
    const platform = zeropsThrowawayPlatform(tab.client, {
      debt,
      budgets: makeThrowawayMintBudgets(() => Date.now()),
    });
    const minted = await platform.mint({ clientId: "org-1", name: "mate-door:delete:n1" });
    const held = tab.rest.hold(`DELETE /client/org-1/integration-token/${minted.id}`);
    const deleting = platform.remove({ clientId: "org-1", tokenId: minted.id });
    const outcome = expect(deleting).rejects.toMatchObject({ kind: "server" });
    await settle();
    held.fail(503);
    await settle();
    expect(debt.failedAt("org-1")).toBe(Date.now());
    await outcome;
    expect(debt.sweepFailed("org-1")).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(tab.rest.orphanTokens()).toHaveLength(1);
  });
});
