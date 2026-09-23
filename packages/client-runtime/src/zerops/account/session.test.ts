import { describe, expect, it } from "@effect/vitest";

import { ZeropsApiError, type ZeropsUser } from "../api.ts";
import { INITIAL_BACKOFF, RETRY_RUNGS_MS } from "../knowledge/retryPolicy.ts";
import type { ZeropsSession } from "../session.ts";
import {
  ZEROPS_SESSION_OWNER_STORAGE_KEY,
  makeZeropsSessionDriver,
  parseZeropsSessionOwner,
  probeZeropsPrincipal,
  transitionZeropsSession,
  type ZeropsPrincipalVerdict,
  type ZeropsSessionEffect,
  type ZeropsSessionEvent,
  type ZeropsSessionOwner,
  type ZeropsSessionPorts,
  type ZeropsSessionState,
} from "./session.ts";

const person: ZeropsUser = { id: "user-1", email: "person@example.test", clientUserList: [] };
const other: ZeropsUser = { id: "user-2", email: "other@example.test", clientUserList: [] };
const stored: ZeropsSession = { accessToken: "access-1", refreshToken: "refresh-1" };
const next: ZeropsSession = { accessToken: "access-2", refreshToken: "refresh-2" };
const owner: ZeropsSessionOwner = { userId: "user-1", loginGeneration: "g1" };

const ctx = { nowMs: 1_000, random: () => 0.5 };
const user = (u: ZeropsUser): ZeropsPrincipalVerdict => ({ kind: "user", user: u });
const unauthorized: ZeropsPrincipalVerdict = { kind: "unauthorized" };
const unavailable: ZeropsPrincipalVerdict = { kind: "unavailable" };

const signedIn = (generation: string | null = "g1"): ZeropsSessionState => ({
  status: "signed-in",
  user: person,
  generation,
  token: { status: "current" },
});
const adopting = (retryAt: number | null = null, generation: string | null = "g1") =>
  ({
    status: "signed-in",
    user: person,
    generation,
    token: { status: "adopting", next, backoff: INITIAL_BACKOFF, retryAt },
  }) satisfies ZeropsSessionState;
const verifying = (session = stored): ZeropsSessionState => ({
  status: "verifying",
  session,
  backoff: INITIAL_BACKOFF,
});
const unavailableAt = (retryAt: number): ZeropsSessionState => ({
  status: "unavailable",
  session: stored,
  backoff: { rung: 1 },
  retryAt,
});

describe("transitionZeropsSession", () => {
  const rows: ReadonlyArray<
    readonly [
      name: string,
      from: ZeropsSessionState,
      event: ZeropsSessionEvent,
      to: ZeropsSessionState,
      effects: ReadonlyArray<ZeropsSessionEffect>,
    ]
  > = [
    [
      "boots signed out with nothing stored",
      { status: "booting" },
      { type: "LOADED", session: null },
      { status: "signed-out" },
      [],
    ],
    [
      "verifies a stored session",
      { status: "booting" },
      { type: "LOADED", session: stored },
      verifying(),
      [{ kind: "verify", session: stored }],
    ],
    [
      "opens the account on a verified principal and claims the owner record",
      verifying(),
      { type: "VERIFIED", session: stored, verdict: user(person) },
      signedIn(null),
      [
        { kind: "open-account", user: person },
        { kind: "claim-owner", userId: "user-1" },
      ],
    ],
    [
      "waits for a retry when the platform cannot answer",
      verifying(),
      { type: "VERIFIED", session: stored, verdict: unavailable },
      {
        status: "unavailable",
        session: stored,
        backoff: { rung: 1 },
        retryAt: 1_000 + RETRY_RUNGS_MS[0]!,
      },
      [{ kind: "schedule", at: 1_000 + RETRY_RUNGS_MS[0]! }],
    ],
    [
      "is signed out when the stored session is refused",
      verifying(),
      { type: "VERIFIED", session: stored, verdict: unauthorized },
      { status: "signed-out" },
      [],
    ],
    [
      "drops the answer for a session it no longer verifies",
      verifying(next),
      { type: "VERIFIED", session: stored, verdict: user(other) },
      verifying(next),
      [],
    ],
    [
      "keeps waiting on an early tick",
      unavailableAt(5_000),
      { type: "WAKE", trigger: "tick" },
      unavailableAt(5_000),
      [{ kind: "schedule", at: 5_000 }],
    ],
    [
      "verifies again when its retry time comes",
      unavailableAt(1_000),
      { type: "WAKE", trigger: "tick" },
      { status: "verifying", session: stored, backoff: { rung: 1 } },
      [{ kind: "verify", session: stored }],
    ],
    [
      "verifies again at once when the tab comes online",
      unavailableAt(60_000),
      { type: "WAKE", trigger: "online" },
      verifying(),
      [{ kind: "cancel-schedule" }, { kind: "verify", session: stored }],
    ],
    [
      "follows a sign-in in another tab while unavailable",
      unavailableAt(60_000),
      { type: "STORAGE_CHANGED", next, held: false },
      verifying(next),
      [{ kind: "cancel-schedule" }, { kind: "verify", session: next }],
    ],
    [
      "follows a sign-in in another tab while signed out",
      { status: "signed-out" },
      { type: "STORAGE_CHANGED", next, held: false },
      verifying(next),
      [{ kind: "verify", session: next }],
    ],
    [
      "follows a sign-in in another tab while booting",
      { status: "booting" },
      { type: "STORAGE_CHANGED", next, held: false },
      verifying(next),
      [{ kind: "verify", session: next }],
    ],
    [
      "verifies the newest session when storage changes during a verification",
      verifying(),
      { type: "STORAGE_CHANGED", next, held: false },
      verifying(next),
      [{ kind: "verify", session: next }],
    ],
    [
      "probes a session another tab stored",
      signedIn(),
      { type: "STORAGE_CHANGED", next, held: false },
      adopting(),
      [{ kind: "probe", session: next }],
    ],
    [
      "ignores a stored session it already holds",
      signedIn(),
      { type: "STORAGE_CHANGED", next, held: true },
      signedIn(),
      [],
    ],
    [
      "adopts the same principal under the same login generation",
      adopting(),
      { type: "PROBED", session: next, verdict: user(person), owner },
      signedIn(),
      [{ kind: "adopt", session: next }],
    ],
    [
      "adopts the same principal when no owner record exists (legacy)",
      adopting(),
      { type: "PROBED", session: next, verdict: user(person), owner: null },
      signedIn(),
      [{ kind: "adopt", session: next }],
    ],
    [
      "adopts and takes the generation when it held none yet",
      adopting(null, null),
      { type: "PROBED", session: next, verdict: user(person), owner },
      signedIn("g1"),
      [{ kind: "adopt", session: next }],
    ],
    [
      "closes and re-verifies another principal",
      adopting(),
      {
        type: "PROBED",
        session: next,
        verdict: user(other),
        owner: { userId: "user-2", loginGeneration: "g2" },
      },
      verifying(next),
      [{ kind: "close-account" }, { kind: "verify", session: next }],
    ],
    [
      "closes and re-verifies a new login of the same principal",
      adopting(),
      {
        type: "PROBED",
        session: next,
        verdict: user(person),
        owner: { userId: "user-1", loginGeneration: "g2" },
      },
      verifying(next),
      [{ kind: "close-account" }, { kind: "verify", session: next }],
    ],
    [
      "closes and re-verifies when the probe is refused",
      adopting(),
      { type: "PROBED", session: next, verdict: unauthorized, owner },
      verifying(next),
      [{ kind: "close-account" }, { kind: "verify", session: next }],
    ],
    [
      "stays signed in and retries when the probe cannot answer",
      adopting(),
      { type: "PROBED", session: next, verdict: unavailable, owner },
      {
        status: "signed-in",
        user: person,
        generation: "g1",
        token: {
          status: "adopting",
          next,
          backoff: { rung: 1 },
          retryAt: 1_000 + RETRY_RUNGS_MS[0]!,
        },
      },
      [{ kind: "schedule", at: 1_000 + RETRY_RUNGS_MS[0]! }],
    ],
    [
      "probes again when its retry time comes",
      adopting(1_000),
      { type: "WAKE", trigger: "tick" },
      adopting(),
      [{ kind: "probe", session: next }],
    ],
    [
      "probes again at once on a visible wake",
      adopting(60_000),
      { type: "WAKE", trigger: "visible" },
      adopting(),
      [{ kind: "cancel-schedule" }, { kind: "probe", session: next }],
    ],
    [
      "drops a probe answer for a session it no longer adopts",
      adopting(),
      { type: "PROBED", session: stored, verdict: user(other), owner },
      adopting(),
      [],
    ],
    [
      "closes the account when another tab signs out",
      signedIn(),
      { type: "STORAGE_CHANGED", next: null, held: false },
      { status: "signed-out" },
      [{ kind: "close-account" }, { kind: "forget-session" }],
    ],
    [
      "stops adopting when another tab signs out",
      adopting(60_000),
      { type: "STORAGE_CHANGED", next: null, held: false },
      { status: "signed-out" },
      [{ kind: "cancel-schedule" }, { kind: "close-account" }, { kind: "forget-session" }],
    ],
    [
      "closes the account when its own session ends",
      signedIn(),
      { type: "SESSION_ENDED" },
      { status: "signed-out" },
      [{ kind: "close-account" }],
    ],
    [
      "takes the owner record's generation when it holds none",
      signedIn(null),
      { type: "OWNER_CHANGED", owner },
      signedIn("g1"),
      [],
    ],
    [
      "ignores the owner record once it holds a generation",
      signedIn("g1"),
      { type: "OWNER_CHANGED", owner: { userId: "user-1", loginGeneration: "g2" } },
      signedIn("g1"),
      [],
    ],
    [
      "takes the generation it claimed",
      signedIn(null),
      { type: "OWNER_CLAIMED", owner },
      signedIn("g1"),
      [],
    ],
    [
      "signs in on its own sign-in with a new login generation",
      { status: "signed-out" },
      { type: "SIGNED_IN", user: person, generation: "g9" },
      signedIn("g9"),
      [
        { kind: "open-account", user: person },
        { kind: "write-owner", owner: { userId: "user-1", loginGeneration: "g9" } },
      ],
    ],
    [
      "closes the open account before its own sign-in as another person",
      signedIn(),
      { type: "SIGNED_IN", user: other, generation: "g9" },
      { status: "signed-in", user: other, generation: "g9", token: { status: "current" } },
      [
        { kind: "close-account" },
        { kind: "open-account", user: other },
        { kind: "write-owner", owner: { userId: "user-2", loginGeneration: "g9" } },
      ],
    ],
    [
      "waits at the second factor",
      { status: "signed-out" },
      { type: "SECOND_FACTOR_REQUIRED" },
      { status: "second-factor" },
      [],
    ],
    [
      "keeps a pending second factor when another tab signs out",
      { status: "second-factor" },
      { type: "STORAGE_CHANGED", next: null, held: false },
      { status: "second-factor" },
      [],
    ],
  ];

  it.each(rows)("%s", (_name, from, event, to, effects) => {
    const result = transitionZeropsSession(from, event, ctx);
    expect(result.state).toEqual(to);
    expect(result.effects).toEqual(effects);
  });
});

describe("parseZeropsSessionOwner", () => {
  it.each([
    ["a record", JSON.stringify(owner), owner],
    ["nothing", null, null],
    ["garbage", "{", null],
    ["a record without a generation", JSON.stringify({ userId: "user-1" }), null],
  ])("reads %s", (_name, raw, expected) => {
    expect(parseZeropsSessionOwner(raw)).toEqual(expected);
  });

  it("names the key beside the session key", () => {
    expect(ZEROPS_SESSION_OWNER_STORAGE_KEY).toBe("zerops-mate.zerops-session-owner.v1");
  });
});

/** One origin's storage and refresh lock, shared by the drivers of several tabs. */
function makeOrigin(initial: { session: ZeropsSession | null; owner: ZeropsSessionOwner | null }) {
  let session = initial.session;
  let ownerRecord = initial.owner;
  let tail = Promise.resolve();
  let generations = 0;
  return {
    session: () => session,
    setSession: (value: ZeropsSession | null) => {
      session = value;
    },
    owner: () => ownerRecord,
    setOwner: (value: ZeropsSessionOwner | null) => {
      ownerRecord = value;
    },
    tab: (overrides: Partial<ZeropsSessionPorts> = {}) => {
      const timers: Array<{ at: number; fire: () => void; cancelled: boolean }> = [];
      let now = 0;
      const events: string[] = [];
      const ports: ZeropsSessionPorts = {
        loadStored: async () => session,
        verify: async () => user(person),
        probe: async () => user(person),
        adopt: (adopted) => events.push(`adopt ${adopted.accessToken}`),
        forgetSession: () => events.push("forget"),
        openAccount: (opened) => events.push(`open ${opened.id}`),
        closeAccount: () => events.push("close"),
        owner: {
          read: () => ownerRecord,
          write: (record) => {
            ownerRecord = record;
          },
        },
        withRefreshLock: (work) => {
          const run = tail.then(work);
          tail = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
        },
        nowMs: () => now,
        setTimer: (delayMs, fire) => {
          const timer = { at: now + delayMs, fire, cancelled: false };
          timers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
        random: () => 0.5,
        newGeneration: () => `g${++generations}`,
        ...overrides,
      };
      const driver = makeZeropsSessionDriver(ports);
      return {
        driver,
        events,
        /** Time passes; the timers that come due fire in order. */
        advance: (ms: number) => {
          now += ms;
          for (const timer of timers.splice(0))
            if (timer.cancelled) continue;
            else if (timer.at <= now) timer.fire();
            else timers.push(timer);
        },
      };
    },
  };
}

const flush = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

describe("makeZeropsSessionDriver", () => {
  it("retries a boot the platform could not answer when its retry time comes", async () => {
    const origin = makeOrigin({ session: stored, owner: null });
    const answers: ZeropsPrincipalVerdict[] = [unavailable, user(person)];
    const tab = origin.tab({ verify: async () => answers.shift()! });
    tab.driver.start();
    await flush();
    expect(tab.driver.state().status).toBe("unavailable");

    tab.advance(RETRY_RUNGS_MS[0]!);
    await flush();

    expect(tab.driver.state().status).toBe("signed-in");
    expect(tab.events).toEqual(["open user-1"]);
  });

  it("creates the owner record once, and a second tab verifying at the same time takes its generation", async () => {
    const origin = makeOrigin({ session: stored, owner: null });
    const a = origin.tab();
    const b = origin.tab();
    a.driver.start();
    b.driver.start();
    await flush();

    expect(origin.owner()).toEqual({ userId: "user-1", loginGeneration: "g1" });
    expect(a.driver.state()).toMatchObject({ status: "signed-in", generation: "g1" });
    expect(b.driver.state()).toMatchObject({ status: "signed-in", generation: "g1" });
  });

  it("writes a new login generation on its own sign-in", async () => {
    const origin = makeOrigin({ session: null, owner: owner });
    const tab = origin.tab();
    tab.driver.start();
    await flush();

    tab.driver.signedIn(person);

    expect(origin.owner()).toEqual({ userId: "user-1", loginGeneration: "g1" });
    expect(tab.driver.state()).toMatchObject({ status: "signed-in", generation: "g1" });
  });

  it("drops an answer that arrives after it stopped", async () => {
    const origin = makeOrigin({ session: stored, owner: null });
    let answer!: (verdict: ZeropsPrincipalVerdict) => void;
    const tab = origin.tab({
      verify: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const stop = tab.driver.start();
    await flush();

    stop();
    answer(user(person));
    await flush();

    expect(tab.driver.state().status).toBe("booting");
    expect(tab.events).toEqual([]);
  });

  describe("renew", () => {
    const signedInTab = async (origin: ReturnType<typeof makeOrigin>) => {
      const tab = origin.tab();
      tab.driver.start();
      await flush();
      return tab;
    };

    it("refreshes over the network while storage still holds the stale session", async () => {
      const origin = makeOrigin({ session: stored, owner });
      const tab = await signedInTab(origin);

      const renewed = await tab.driver.renew(stored, async () => next);

      expect(renewed).toBe(next);
    });

    it("hands back the session another tab renewed for the same login", async () => {
      const origin = makeOrigin({ session: stored, owner });
      const tab = await signedInTab(origin);
      origin.setSession(next);
      let refreshed = false;

      const renewed = await tab.driver.renew(stored, async () => {
        refreshed = true;
        return stored;
      });

      expect(renewed).toBe(next);
      expect(refreshed).toBe(false);
    });

    it.each([
      ["another tab signed out", null, owner],
      ["another tab signed in anew", next, { userId: "user-1", loginGeneration: "g2" }],
      ["another person signed in", next, { userId: "user-2", loginGeneration: "g2" }],
    ] as const)("refuses without refreshing when %s", async (_name, session, record) => {
      const origin = makeOrigin({ session: stored, owner });
      const tab = await signedInTab(origin);
      origin.setSession(session);
      origin.setOwner(record);
      let refreshed = false;

      const error = await tab.driver
        .renew(stored, async () => {
          refreshed = true;
          return next;
        })
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ZeropsApiError);
      expect((error as ZeropsApiError).kind).toBe("expired-session");
      expect(refreshed).toBe(false);
    });

    it("runs one renewal at a time, so the second tab adopts the first one's refresh", async () => {
      const origin = makeOrigin({ session: stored, owner });
      const a = await signedInTab(origin);
      const b = await signedInTab(origin);
      let refreshes = 0;
      const refresh = async () => {
        refreshes += 1;
        await flush();
        origin.setSession(next);
        return next;
      };

      const renewed = await Promise.all([
        a.driver.renew(stored, refresh),
        b.driver.renew(stored, refresh),
      ]);

      expect(renewed).toEqual([next, next]);
      expect(refreshes).toBe(1);
    });
  });
});

describe("probeZeropsPrincipal", () => {
  const answering = (status: number) => {
    const sent: Array<{ readonly path: string; readonly authorization: string | null }> = [];
    const fetch = async (input: string, init?: RequestInit) => {
      sent.push({
        path: new URL(input).pathname,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(JSON.stringify(status === 200 ? person : { error: { code: "x" } }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    };
    return { fetch, sent };
  };

  it.each([
    [200, user(person)],
    [401, unauthorized],
    [503, unavailable],
  ] as const)("reads one user/info with the access token alone (%s)", async (status, verdict) => {
    const { fetch, sent } = answering(status);

    const answer = await probeZeropsPrincipal({ fetch, baseUrl: "https://api.example.test" }, next);

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
        baseUrl: "https://api.example.test",
      },
      next,
    );

    expect(answer).toEqual(unavailable);
  });
});
