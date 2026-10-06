import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  KEPT_SESSIONS_KEY,
  makeKeptSessions,
  MATE_SESSIONS,
} from "@t3tools/client-runtime/zerops/keptSessions";
import { AuthZeropsClientScopes, EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type * as AccountLifetimeModule from "./accountLifetime";
import type * as KeptSessionsModule from "./keptSessions";

const DAY_MS = 86_400_000;

function session(name: string, expiresAtEpochMs = Date.now() + DAY_MS) {
  const environmentId = EnvironmentId.make(`env-${name}`);
  const connectionId = `bearer:env-${name}`;
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({ environmentId, label: name, connectionId }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId,
      label: name,
      httpBaseUrl: `https://${name}.example.test/mate/`,
      wsBaseUrl: `wss://${name}.example.test/mate/`,
    }),
    credential: new BearerConnectionCredential({
      token: ["session", name].join("-"),
      expiresAtEpochMs,
      origin: "zerops-identity",
    }),
  });
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

afterEach(() => {
  lifetime.closeAccountLifetime();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a kept session's check", () => {
  const state = (input: {
    readonly authenticated?: boolean;
    readonly scopes?: AuthSessionState["scopes"] | null;
  }): AuthSessionState => {
    const { scopes = [...AuthZeropsClientScopes], authenticated = true } = input;
    return { authenticated, auth: {}, ...(scopes === null ? {} : { scopes }) } as never;
  };
  it.each([
    ["live, with every scope the client asks for", state({}), true],
    ["ended", state({ authenticated: false }), false],
    [
      "live but from before a release that added a scope",
      state({ scopes: AuthZeropsClientScopes.slice(0, -1) }),
      false,
    ],
    ["live, its scopes unsaid", state({ scopes: null }), false],
  ] as const)("%s", (_name, answer, held) => {
    expect(kept.keptSessionHeld(answer)).toBe(held);
  });
});

// t10, 2026-10-03: a deleted project's kept session went on being read on every load.
describe("a Mate gone from the platform's listing", () => {
  it("has its kept session dropped where it is kept, with nothing sent to the Mate", () => {
    lifetime.openAccountLifetime("person-1");
    kept.keptSessions.keep("project-dan:zcp", session("dan"));

    kept.forgetKeptMateSession("project-dan:zcp");

    expect(kept.keptSessions.read("project-dan:zcp")).toBeNull();
    expect(fetched).toEqual([]);
  });
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
  /** Every hold now, one entry per holder, as `navigator.locks.query()` lists them. */
  const query = async () => ({
    held: [...holders].flatMap(([name, hold]) =>
      Array.from({ length: hold.count }, () => ({ name, mode: hold.mode })),
    ),
  });
  return { request, query };
}

/** Lets the close's lock requests and the ends they decide run. */
const settleLocks = () => new Promise((resolve) => setTimeout(resolve, 0));

// L08: a Mate session one tab minted displaced the one a neighbouring tab of the account still used.
describe("a Mate session this tab mints in place of a kept one", () => {
  const logouts = () => fetched.map(({ authorization }) => authorization);
  const holdAccount = (locks: ReturnType<typeof fakeLocks>) => {
    let lets!: () => void;
    void locks.request(
      "mate:account-open:person-1",
      { mode: "shared" },
      () =>
        new Promise<void>((resolve) => {
          lets = resolve;
        }),
    );
    return () => lets();
  };

  it.each([
    ["another tab kept, while that tab holds the account", "other", true, []],
    ["another tab kept, after that tab let the account go", "other", false, []],
    ["this tab minted, while another tab holds the account", "mine", true, []],
    ["this tab minted, alone on the account", "mine", false, ["Bearer session-old"]],
  ] as const)("ends the one it displaced only where %s", async (_name, by, held, ended) => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    if (held) holdAccount(locks);
    lifetime.openAccountLifetime("person-1");
    if (by === "mine") kept.keepMintedMateSession("p1:zcp", session("old"));
    else kept.keptSessions.keep("p1:zcp", session("old"));

    kept.keepMintedMateSession("p1:zcp", session("new"));
    await settleLocks();

    expect(logouts()).toEqual(ended);
    expect(kept.keptSessions.read("p1:zcp")?.credential.token).toBe("session-new");
  });

  it("ends a session set aside with the account's other kept sessions", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    const otherTabLets = holdAccount(locks);
    lifetime.openAccountLifetime("person-1");
    kept.keptSessions.keep("p1:zcp", session("old"));
    kept.keepMintedMateSession("p1:zcp", session("new"));
    await settleLocks();

    otherTabLets();
    lifetime.closeAccountLifetime();
    await settleLocks();

    expect(logouts().toSorted()).toEqual(["Bearer session-new", "Bearer session-old"]);
  });
});

// A stored login the platform refused never opened its account here: its own kept sessions end.
describe("a refused stored login's own kept sessions", () => {
  /** A session kept under an account no tab has open: written where that account keeps it. */
  const keepUnder = (accountId: string, key: string, name: string) => {
    const storageKey = `mate:account:${accountId}:${KEPT_SESSIONS_KEY}`;
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
      MATE_SESSIONS,
    ).keep(key, session(name));
  };

  it.each([
    ["end at their Mate, and no other account's do", false, ["Bearer session-shop"]],
    ["wait for a tab that holds the account open", true, []],
  ] as const)("%s", async (_name, otherTabHolds, ended) => {
    keepUnder("person-1", "p1:zcp", "shop");
    keepUnder("person-2", "p2:zcp", "blog");
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    if (otherTabHolds)
      void locks.request(
        "mate:account-open:person-1",
        { mode: "shared" },
        () => new Promise(() => {}),
      );

    kept.endKeptSessionsOf("person-1");
    await settleLocks();

    expect(fetched.map(({ authorization }) => authorization)).toEqual(ended);
    lifetime.openAccountLifetime("person-2");
    expect(kept.keptSessions.read("p2:zcp")).not.toBeNull();
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
    kept.keptSessions.keep("p1:zcp", session("shop"));

    lifetime.closeAccountLifetime();
    await settleLocks();

    expect(fetched).toEqual([]);
    lifetime.openAccountLifetime("person-1");
    expect(kept.keptSessions.read("p1:zcp")).not.toBeNull();

    otherTabCloses();
    lifetime.closeAccountLifetime();
    await settleLocks();

    expect(fetched).toEqual([
      {
        url: "https://shop.example.test/mate/api/auth/logout",
        authorization: "Bearer session-shop",
      },
    ]);
    expect([...values.keys()].some((key) => key.endsWith(KEPT_SESSIONS_KEY))).toBe(false);
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
      kept.endWhenAccountLeft(() => ends.push("ended")),
    );

    lifetime.closeAccountLifetime();
    await settleLocks();
    unregister();

    expect(ends).toEqual(expected);
  });

  it("the account's close ends every live kept session at its Mate, each once", async () => {
    lifetime.openAccountLifetime("person-1");
    kept.keptSessions.keep("p1:zcp", session("shop"));
    kept.keptSessions.keep("p2:zcp", session("blog"));
    kept.keptSessions.keep("p3:zcp", session("ended", Date.now() - DAY_MS));
    // The tab's own closer already ended one of them.
    kept.endKeptSession(session("shop"));

    lifetime.closeAccountLifetime();
    await settleLocks();

    expect(fetched).toEqual([
      {
        url: "https://shop.example.test/mate/api/auth/logout",
        authorization: "Bearer session-shop",
      },
      {
        url: "https://blog.example.test/mate/api/auth/logout",
        authorization: "Bearer session-blog",
      },
    ]);
    expect([...values.keys()].some((key) => key.endsWith(KEPT_SESSIONS_KEY))).toBe(false);
  });
});
