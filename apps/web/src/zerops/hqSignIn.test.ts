import { describe, expect, it } from "vite-plus/test";

import {
  ZEROPS_HQ_SIGN_IN_KEY,
  finishZeropsHqSignIn,
  readZeropsHqSignInStep,
  startZeropsHqSignIn,
  type ZeropsHqSignInEntry,
} from "./hqSignIn";

const API = "https://api.example.test";
const MATE = "https://mate.zerops.io";
const VERIFY = "https://app.zerops.io/authorize-login?request=req-1";
const MINUTE = 60_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A tab's `sessionStorage`, or one a storage policy blocks (every access throws). */
function tabStorage(blocked = false) {
  const items = new Map<string, string>();
  const guard = () => {
    if (blocked) throw new DOMException("blocked", "SecurityError");
  };
  return {
    items,
    getItem: (key: string) => {
      guard();
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      guard();
      items.set(key, value);
    },
    removeItem: (key: string) => {
      guard();
      items.delete(key);
    },
  };
}

const APPROVED = {
  status: "APPROVED",
  auth: {
    auth: {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-10-19T10:00:00Z",
      userId: "user-1",
    },
    user: { id: "user-1" },
  },
};

/**
 * A tab on its trip: the API answers the start and then each check from `checks`, every wait
 * passes at once, and `assign` records where the tab went.
 */
function trip(options: { readonly checks?: ReadonlyArray<unknown>; readonly now?: number } = {}) {
  const storage = tabStorage();
  const assigned: string[] = [];
  const requests: Array<{ url: string; body: unknown }> = [];
  const checks = [...(options.checks ?? [])];
  let now = options.now ?? 1_000_000;
  const ports = {
    fetch: async (url: string, init: RequestInit = {}) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith("/check")) {
        const next = checks.shift();
        return next instanceof Response ? next : json(200, next ?? { status: "PENDING" });
      }
      return json(200, {
        requestId: "req-1",
        pollSecret: "secret-1",
        userCode: "ABCD-EFGH",
        verificationUrl: VERIFY,
        expiresIn: 300,
        interval: 3,
      });
    },
    apiBase: API,
    appCode: "mate",
    consentOrigin: "https://hq.zerops.io",
    returnUrl: `${MATE}/?signin=hq-return`,
    storage,
    assign: (url: string) => {
      assigned.push(url);
    },
    nowMs: () => now,
    wait: async () => {
      now += 3_000;
    },
  };
  return {
    ports,
    storage,
    assigned,
    requests,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const entry = (over: Partial<ZeropsHqSignInEntry> = {}): ZeropsHqSignInEntry => ({
  requestId: "req-1",
  pollSecret: "secret-1",
  startedAt: 1_000_000,
  intervalMs: 3_000,
  ...over,
});

describe("opening Mate from HQ's card", () => {
  it("starts a login and sends the tab to HQ's consent page in the same tab, with its way back", async () => {
    const tab = trip();
    await expect(startZeropsHqSignIn(tab.ports)).resolves.toEqual({ kind: "left" });
    expect(tab.requests).toEqual([
      { url: `${API}/api/rest/public/auth/device-login`, body: { appCode: "mate" } },
    ]);
    expect(tab.assigned).toHaveLength(1);
    const consent = new URL(tab.assigned[0]!);
    expect(consent.origin).toBe("https://hq.zerops.io");
    expect(consent.pathname).toBe("/authorize-login");
    expect(consent.searchParams.get("request")).toBe("req-1");
    expect(consent.searchParams.get("back")).toBe(`${MATE}/?signin=hq-return`);
    expect(consent.searchParams.has("display")).toBe(false);
  });

  it("keeps the request in this tab's storage and never in an address", async () => {
    const tab = trip();
    await startZeropsHqSignIn(tab.ports);
    expect(JSON.parse(tab.storage.items.get(ZEROPS_HQ_SIGN_IN_KEY)!)).toEqual(entry());
    expect(tab.assigned[0]).not.toContain("secret-1");
  });

  it("stays on the landing where this tab can keep nothing for the trip", async () => {
    const tab = trip();
    const blocked = { ...tab.ports, storage: tabStorage(true) };
    await expect(startZeropsHqSignIn(blocked)).resolves.toEqual({ kind: "kept-nothing" });
    expect(tab.assigned).toEqual([]);
  });
});

describe("the address as the page loads", () => {
  const read = (href: string, storage = tabStorage(), nowMs = 1_000_000) =>
    readZeropsHqSignInStep({ href, storage, nowMs });

  it("takes the signin parameter out at once and keeps everything else", () => {
    expect(read(`${MATE}/?signin=hq&tab=chat#top`)).toEqual({
      step: { kind: "start" },
      href: "/?tab=chat#top",
    });
    expect(read(`${MATE}/?signin=other`)).toEqual({ step: null, href: "/" });
  });

  it("leaves an address without the parameter, and a tab holding no request, as they are", () => {
    expect(read(`${MATE}/zerops?project=p1`)).toEqual({ step: null, href: null });
  });

  it("takes the request out of this tab's storage as HQ sends the tab back", () => {
    const storage = tabStorage();
    storage.setItem(ZEROPS_HQ_SIGN_IN_KEY, JSON.stringify(entry()));
    expect(read(`${MATE}/?signin=hq-return`, storage)).toEqual({
      step: { kind: "return", entry: entry() },
      href: "/",
    });
    expect(storage.items.has(ZEROPS_HQ_SIGN_IN_KEY)).toBe(false);
  });

  it("reads a request older than five minutes, or none in this tab, as nothing to collect", () => {
    const storage = tabStorage();
    storage.setItem(ZEROPS_HQ_SIGN_IN_KEY, JSON.stringify(entry()));
    expect(read(`${MATE}/?signin=hq-return`, storage, 1_000_000 + 5 * MINUTE + 1)).toEqual({
      step: { kind: "return", entry: "expired" },
      href: "/",
    });
    expect(storage.items.has(ZEROPS_HQ_SIGN_IN_KEY)).toBe(false);
    expect(read(`${MATE}/?signin=hq-return`)).toEqual({
      step: { kind: "return", entry: "missing" },
      href: "/",
    });
  });

  it("collects a request this tab still holds when it comes back without HQ's answer", () => {
    const storage = tabStorage();
    storage.setItem(ZEROPS_HQ_SIGN_IN_KEY, JSON.stringify(entry()));
    expect(read(`${MATE}/`, storage)).toEqual({
      step: { kind: "resume", entry: entry() },
      href: null,
    });
    expect(storage.items.has(ZEROPS_HQ_SIGN_IN_KEY)).toBe(false);
  });
});

describe("back from HQ", () => {
  it("collects the approved session, asking at once", async () => {
    const tab = trip({ checks: [APPROVED] });
    const outcome = await finishZeropsHqSignIn({
      entry: entry(),
      ports: tab.ports,
      once: false,
      signal: new AbortController().signal,
    });
    expect(outcome).toMatchObject({ kind: "approved", session: { accessToken: "access-1" } });
    expect(tab.requests).toEqual([
      {
        url: `${API}/api/rest/public/auth/device-login/check`,
        body: { requestId: "req-1", pollSecret: "secret-1" },
      },
    ]);
  });

  it("keeps asking while the platform has not settled HQ's answer", async () => {
    const tab = trip({ checks: [{ status: "PENDING" }, json(503, {}), APPROVED] });
    const outcome = await finishZeropsHqSignIn({
      entry: entry(),
      ports: tab.ports,
      once: false,
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe("approved");
    expect(tab.requests).toHaveLength(3);
  });

  it("answers a denial as denied", async () => {
    const tab = trip({ checks: [{ status: "DENIED" }] });
    await expect(
      finishZeropsHqSignIn({
        entry: entry(),
        ports: tab.ports,
        once: false,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("gives up five minutes after the request started", async () => {
    const tab = trip({ now: 1_000_000 + 5 * MINUTE - 1_000 });
    await expect(
      finishZeropsHqSignIn({
        entry: entry(),
        ports: tab.ports,
        once: false,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "expired" });
  });

  it("asks once for a request the tab came back to without HQ's answer", async () => {
    const tab = trip();
    await expect(
      finishZeropsHqSignIn({
        entry: entry(),
        ports: tab.ports,
        once: true,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(tab.requests).toHaveLength(1);
  });
});
