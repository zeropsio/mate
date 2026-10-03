import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  HQ_SESSIONS,
  KEPT_HQ_SESSIONS_KEY,
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

describe("no kept session outlives the login it was opened under", () => {
  it("the account's close ends every live kept session at its Mate, each once", () => {
    lifetime.openAccountLifetime("person-1");
    kept.keptSessions.keep("p1:zcp", session("shop"));
    kept.keptSessions.keep("p2:zcp", session("blog"));
    kept.keptSessions.keep("p3:zcp", session("ended", Date.now() - DAY_MS));
    // The tab's own closer already ended one of them.
    kept.endKeptSession(session("shop"));

    lifetime.closeAccountLifetime();

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

  it("a refused login ends every session kept under any account on this origin", () => {
    lifetime.openAccountLifetime("person-1");
    kept.keptSessions.keep("p1:zcp", session("shop"));
    // Another login's sessions, kept before it was replaced here.
    const other = `mate:account:person-2:${KEPT_SESSIONS_KEY}`;
    makeKeptSessions(
      {
        getItem: () => values.get(other) ?? null,
        setItem: (_name, value) => {
          values.set(other, value);
        },
        removeItem: () => {
          values.delete(other);
        },
      },
      Date.now,
      MATE_SESSIONS,
    ).keep("p9:zcp", session("docs"));

    kept.endEveryKeptSession();

    expect(fetched.map((call) => call.url).toSorted()).toEqual([
      "https://docs.example.test/mate/api/auth/logout",
      "https://shop.example.test/mate/api/auth/logout",
    ]);
    expect([...values.keys()].some((key) => key.endsWith(KEPT_SESSIONS_KEY))).toBe(false);
  });

  // Audit K7: HQ's sessions are kept by the same rules, so a refused login revokes them too.
  it("a refused login revokes every HQ session kept under any account on this origin", () => {
    const hqSession = (name: string) => ({
      address: `https://${name}.example.test`,
      token: `session-${name}`,
      expiresAtEpochMs: Date.now() + 12 * 3_600_000,
    });
    lifetime.openAccountLifetime("person-1");
    kept.keptHqSessions.keep("org-1:P_HQ:https://hq.example.test", hqSession("hq"));
    const other = `mate:account:person-2:${KEPT_HQ_SESSIONS_KEY}`;
    makeKeptSessions(
      {
        getItem: () => values.get(other) ?? null,
        setItem: (_name, value) => {
          values.set(other, value);
        },
        removeItem: () => {
          values.delete(other);
        },
      },
      Date.now,
      HQ_SESSIONS,
    ).keep("org-9:P_HQ9:https://hq9.example.test", hqSession("hq9"));

    kept.endEveryKeptSession();

    expect(fetched.map(({ url, authorization }) => [url, authorization]).toSorted()).toEqual([
      ["https://hq.example.test/api/session", "Bearer session-hq"],
      ["https://hq9.example.test/api/session", "Bearer session-hq9"],
    ]);
    expect([...values.keys()].some((key) => key.endsWith(KEPT_HQ_SESSIONS_KEY))).toBe(false);
  });
});
