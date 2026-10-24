import {
  HQ_SESSIONS,
  KEPT_HQ_SESSIONS_KEY,
  makeKeptSessions,
  type KeptHqSession,
} from "@t3tools/client-runtime/zerops/keptSessions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type * as AccountLifetimeModule from "./accountLifetime";
import type * as KeptSessionsModule from "./keptSessions";

const DAY_MS = 86_400_000;

function session(name: string, expiresAtEpochMs = Date.now() + DAY_MS): KeptHqSession {
  return {
    address: `https://${name}.example.test/hq/`,
    token: ["session", name].join("-"),
    expiresAtEpochMs,
  };
}

let values: Map<string, string>;
let fetched: Array<{ readonly url: string; readonly authorization: string }>;
let lifetime: typeof AccountLifetimeModule;
let kept: typeof KeptSessionsModule;

beforeEach(async () => {
  values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  fetched = [];
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      fetched.push({ url, authorization: new Headers(init.headers).get("authorization") ?? "" });
      return new Response(null, { status: 200 });
    }),
  );
  vi.resetModules();
  lifetime = await import("./accountLifetime");
  kept = await import("./keptSessions");
});

afterEach(async () => {
  await lifetime.closeAccountLifetime();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * An origin's Web Locks as the account's close uses them: shared holds, and an exclusive request
 * that answers at once whether anyone else holds the name.
 */
function fakeLocks() {
  const holders = new Map<string, { readonly mode: LockMode; count: number }>();
  const request = async <T>(
    name: string,
    options: { readonly mode?: LockMode; readonly ifAvailable?: boolean },
    callback: (lock: { readonly name: string } | null) => Promise<T> | T,
  ): Promise<T> => {
    const mode = options.mode ?? "exclusive";
    const held = holders.get(name);
    if (held !== undefined && (mode === "exclusive" || held.mode === "exclusive")) {
      if (options.ifAvailable === true) return callback(null);
      throw new Error(`The fake does not queue: ${name} is held.`);
    }
    const hold = held ?? { mode, count: 0 };
    hold.count += 1;
    holders.set(name, hold);
    try {
      return await callback({ name });
    } finally {
      hold.count -= 1;
      if (hold.count === 0) holders.delete(name);
    }
  };
  return { request };
}

// A stored login the platform refused never opened its account here: its own kept sessions end.
describe("a refused stored login's own kept sessions", () => {
  /** A session kept under an account no tab has open: written where that account keeps it. */
  const keepUnder = (accountId: string, key: string, name: string) => {
    const storageKey = `mate:account:${accountId}:${KEPT_HQ_SESSIONS_KEY}`;
    makeKeptSessions(
      {
        getItem: () => values.get(storageKey) ?? null,
        setItem: (_name, value) => {
          values.set(storageKey, value);
        },
        removeItem: () => {
          values.delete(storageKey);
        },
      },
      Date.now,
      HQ_SESSIONS,
    ).keep(key, session(name));
  };

  it.each([
    ["end where they were issued, and no other account's do", false, ["Bearer session-shop"]],
    ["wait for a tab that holds the account open", true, []],
  ] as const)("%s", async (_name, otherTabHolds, ended) => {
    keepUnder("person-1", "c1:hq1:https://shop", "shop");
    keepUnder("person-2", "c2:hq1:https://blog", "blog");
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    if (otherTabHolds)
      void locks.request(
        "mate:account-open:person-1",
        { mode: "shared" },
        () => new Promise(() => {}),
      );

    await kept.endKeptSessionsOf("person-1");

    expect(fetched.map(({ authorization }) => authorization)).toEqual(ended);
    lifetime.openAccountLifetime("person-2");
    expect(kept.keptHqSessions.read("c2:hq1:https://blog")).not.toBeNull();
  });
});

describe("no kept session outlives the login it was opened under", () => {
  // L08: one tab's sign-out revoked the sessions a neighbouring tab of the same account still used.
  it("the account's close leaves its kept sessions to another tab that holds it open", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    let otherTabCloses!: () => void;
    void locks.request(
      "mate:account-open:person-1",
      { mode: "shared" },
      () =>
        new Promise<void>((resolve) => {
          otherTabCloses = resolve;
        }),
    );
    lifetime.openAccountLifetime("person-1");
    kept.keptHqSessions.keep("c1:hq1:https://shop", session("shop"));

    await lifetime.closeAccountLifetime();

    expect(fetched).toEqual([]);
    lifetime.openAccountLifetime("person-1");
    expect(kept.keptHqSessions.read("c1:hq1:https://shop")).not.toBeNull();

    otherTabCloses();
    await lifetime.closeAccountLifetime();

    expect(fetched).toEqual([
      {
        url: "https://shop.example.test/hq/api/session",
        authorization: "Bearer session-shop",
      },
    ]);
    expect([...values.keys()].some((key) => key.endsWith(KEPT_HQ_SESSIONS_KEY))).toBe(false);
  });

  // L08: the connection catalog's Mate logouts follow the same rule, from a closer of their own.
  it.each([
    ["ends them once this tab let the account go", false, ["ended"]],
    ["leaves them to another tab that holds the account open", true, []],
  ] as const)("a closer's session ends %s", async (_name, otherTabHolds, expected) => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    if (otherTabHolds)
      void locks.request(
        "mate:account-open:person-1",
        { mode: "shared" },
        () => new Promise(() => {}),
      );
    const ends: string[] = [];
    lifetime.openAccountLifetime("person-1");
    // Registered after the kept sessions' own closer, so it runs before this tab lets go.
    const unregister = lifetime.onAccountLifetimeClose(() =>
      kept.endWhenAccountLeft(() => {
        ends.push("ended");
      }),
    );

    await lifetime.closeAccountLifetime();
    unregister();

    expect(ends).toEqual(expected);
  });

  it.each([[1], [2], [3]] as const)(
    "the account's close ends its kept HQ sessions and every other closer's sessions once this tab let the account go",
    async (others) => {
      vi.stubGlobal("navigator", { locks: fakeLocks() });
      lifetime.openAccountLifetime("person-1");
      kept.keptHqSessions.keep("c1:hq1:https://shop", session("shop"));
      kept.keptHqSessions.keep("c2:hq1:https://blog", session("blog"));
      const ends: number[] = [];
      const unregister = Array.from({ length: others }, (_, index) =>
        lifetime.onAccountLifetimeClose(() =>
          kept.endWhenAccountLeft(() => {
            ends.push(index);
          }),
        ),
      );

      await lifetime.closeAccountLifetime();
      for (const forget of unregister) forget();

      expect(fetched.map(({ authorization }) => authorization)).toEqual([
        "Bearer session-shop",
        "Bearer session-blog",
      ]);
      expect(ends.toSorted()).toEqual(Array.from({ length: others }, (_, index) => index));
      expect([...values.keys()].some((key) => key.endsWith(KEPT_HQ_SESSIONS_KEY))).toBe(false);
    },
  );

  it("the account's close leaves every closer's sessions to another tab that holds it open", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    void locks.request(
      "mate:account-open:person-1",
      { mode: "shared" },
      () => new Promise(() => {}),
    );
    lifetime.openAccountLifetime("person-1");
    kept.keptHqSessions.keep("c1:hq1:https://shop", session("shop"));
    const ends: string[] = [];
    const unregister = [0, 1].map(() =>
      lifetime.onAccountLifetimeClose(() =>
        kept.endWhenAccountLeft(() => {
          ends.push("ended");
        }),
      ),
    );

    await lifetime.closeAccountLifetime();
    for (const forget of unregister) forget();

    expect(fetched).toEqual([]);
    expect(ends).toEqual([]);
  });

  it("the account's close ends its kept sessions at once where the page has no Web Locks", async () => {
    // happy-dom reports `navigator.locks` as null.
    vi.stubGlobal("navigator", { locks: null });
    lifetime.openAccountLifetime("person-1");
    kept.keptHqSessions.keep("c1:hq1:https://shop", session("shop"));

    await lifetime.closeAccountLifetime();

    expect(fetched.map(({ authorization }) => authorization)).toEqual(["Bearer session-shop"]);
  });

  it("the account's close ends every live kept session where it was issued, each once", async () => {
    lifetime.openAccountLifetime("person-1");
    kept.keptHqSessions.keep("c1:hq1:https://shop", session("shop"));
    kept.keptHqSessions.keep("c2:hq1:https://blog", session("blog"));
    kept.keptHqSessions.keep("c1:hq1:https://ended", session("ended", Date.now() - DAY_MS));
    // The tab's own closer already ended one of them.
    kept.endHqSession(session("shop"));

    await lifetime.closeAccountLifetime();

    expect(fetched).toEqual([
      {
        url: "https://shop.example.test/hq/api/session",
        authorization: "Bearer session-shop",
      },
      {
        url: "https://blog.example.test/hq/api/session",
        authorization: "Bearer session-blog",
      },
    ]);
    expect([...values.keys()].some((key) => key.endsWith(KEPT_HQ_SESSIONS_KEY))).toBe(false);
  });
});
