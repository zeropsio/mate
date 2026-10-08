import { describe, expect, it } from "vite-plus/test";

import type { ZeropsHandoverOutcome } from "@t3tools/client-runtime/zerops/handover";

import {
  ZEROPS_HANDOVER_NONCE_KEY,
  completeZeropsHandover,
  mintZeropsHandoverNonce,
  readHandoverOnce,
  startZeropsHandover,
  type ZeropsHandoverNonceStore,
} from "./handover";

const here = { origin: "https://mate.zerops.io", path: "" } as const;

function fakeStore(initial: string | null = null): ZeropsHandoverNonceStore & {
  readonly reads: () => number;
} {
  let value = initial;
  let reads = 0;
  return {
    remember: (nonce) => {
      value = nonce;
    },
    take: () => {
      reads += 1;
      const taken = value;
      value = null;
      return taken;
    },
    reads: () => reads,
  };
}

describe("startZeropsHandover", () => {
  it("remembers the nonce it sent, so the callback has something to check against", () => {
    const store = fakeStore();
    const url = new URL(startZeropsHandover({ ...here, store }));
    const sent = url.searchParams.get("state") ?? "";

    expect(sent).not.toBe("");
    expect(store.take()).toBe(sent);
  });

  it("mints a fresh nonce per attempt, so an abandoned one cannot be reused", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const url = new URL(startZeropsHandover({ ...here, store: fakeStore() }));
      seen.add(url.searchParams.get("state") ?? "");
    }
    expect(seen.size).toBe(32);
    for (const nonce of seen) {
      // Long enough that guessing one is not a strategy.
      expect(nonce.length).toBeGreaterThanOrEqual(22);
    }
  });

  it("carries the sign-up intent when that is the button the user pressed", () => {
    const url = new URL(startZeropsHandover({ ...here, store: fakeStore(), intent: "register" }));
    expect(url.searchParams.get("intent")).toBe("register");
    expect(url.pathname).toBe("/authorize-app");
  });
});

describe("mintZeropsHandoverNonce", () => {
  // The native (desktop-bridge) sign-in hands this bare value to the main
  // process as `state` instead of building a browser URL with it — the
  // platform is opened by Electron's shell, not this tab's location.
  it("mints and remembers a nonce, so the callback has something to check against", () => {
    const store = fakeStore();
    const nonce = mintZeropsHandoverNonce({ store });

    expect(nonce).not.toBe("");
    expect(store.take()).toBe(nonce);
  });

  it("mints a fresh nonce per call", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      seen.add(mintZeropsHandoverNonce({ store: fakeStore() }));
    }
    expect(seen.size).toBe(32);
  });
});

describe("completeZeropsHandover", () => {
  it("accepts a callback answering the nonce this browser stored", () => {
    const store = fakeStore("nonce-1");
    const outcome = completeZeropsHandover({
      fragment: "#token=rt-1&state=nonce-1&zcpClaimed=true",
      store,
    });

    expect(outcome).toEqual({
      kind: "session",
      token: "rt-1",
      zcpClaimed: true,
    });
  });

  it("spends the nonce, so the same callback cannot be replayed", () => {
    // A back button, a restored tab or a copied link must not sign anyone in
    // a second time off one authorization.
    const store = fakeStore("nonce-1");
    const fragment = "#token=rt-1&state=nonce-1";

    expect(completeZeropsHandover({ fragment, store })).toMatchObject({ kind: "session" });
    expect(completeZeropsHandover({ fragment, store })).toEqual({ kind: "mismatched" });
  });

  it("refuses a credential this browser never asked for, and reads nothing out of it", () => {
    const store = fakeStore(null);
    const outcome = completeZeropsHandover({
      fragment: "#token=attacker-token&state=whatever",
      store,
    });

    expect(outcome).toEqual({ kind: "mismatched" });
    expect(JSON.stringify(outcome)).not.toContain("attacker-token");
  });

  it("leaves the nonce alone when there is no hand-over in the URL", () => {
    // An ordinary visit to the route must not burn a hand-over that is still
    // in flight in this tab.
    const store = fakeStore("nonce-1");
    expect(completeZeropsHandover({ fragment: "", store })).toEqual({ kind: "absent" });
    expect(store.reads()).toBe(0);
    expect(store.take()).toBe("nonce-1");
  });

  it("pins the storage key, because changing it silently breaks in-flight sign-ins", () => {
    expect(ZEROPS_HANDOVER_NONCE_KEY).toBe("zerops-mate.handover-nonce.v1");
  });
});

describe("startZeropsHandover names where this tab lives", () => {
  // The platform builds the callback as origin + path + /zerops/authorized, so
  // whatever this tab sends is where the token comes back — a lab instance on
  // a project route, a /mate build in a container, a dev server on localhost.
  const rows = [
    { origin: "https://mate.zerops.io", path: "" },
    { origin: "https://app-1abc.prg1.zerops.app", path: "" },
    { origin: "https://zcp-2333-8080.prg1.zerops.app", path: "/mate" },
    { origin: "http://localhost:5733", path: "" },
  ] as const;
  it.each(Array.from(rows, (row) => ({ title: `${row.origin}${row.path}`, row })))(
    "$title",
    ({ row }) => {
      const url = new URL(startZeropsHandover({ store: fakeStore(), ...row }));
      expect(url.searchParams.get("origin")).toBe(row.origin);
      expect(url.searchParams.get("path")).toBe(row.path);
      // The Zerops app finds the project by origin; no hint is sent.
      expect(url.searchParams.get("project")).toBeNull();
    },
  );

  // The platform returns to the origin it is given; a port beside it is never read.
  it("names a dev server by its origin alone, never by a port", () => {
    const url = new URL(
      startZeropsHandover({ store: fakeStore(), origin: "http://localhost:5173", path: "" }),
    );
    expect(url.searchParams.get("origin")).toBe("http://localhost:5173");
    expect(url.searchParams.has("port")).toBe(false);
  });

  it("goes to the Zerops app this build was pointed at", () => {
    const url = new URL(
      startZeropsHandover({ ...here, store: fakeStore(), guiBaseUrl: "https://app.zerops.dev" }),
    );
    expect(url.origin).toBe("https://app.zerops.dev");
  });
});

describe("reading the callback exactly once", () => {
  // `beforeLoad` runs more than once per navigation, and the first read is
  // destructive: it spends the nonce and scrubs the fragment out of the URL.
  // Without this, run 2 sees an empty fragment, reports `absent`, and the
  // component — which receives the LAST run's value — silently sends the user
  // back to the landing holding no session. Measured against a live dev
  // server: run 1 `session`, run 2 `absent`.
  it("returns the first outcome to every later caller, and reads only once", () => {
    const outcomes: ZeropsHandoverOutcome[] = [
      { kind: "session", token: "rt-1", zcpClaimed: false },
      { kind: "absent" },
    ];
    let reads = 0;
    const read = readHandoverOnce(() => {
      reads += 1;
      return outcomes[reads - 1] ?? { kind: "absent" };
    });

    expect(read()).toMatchObject({ kind: "session", token: "rt-1" });
    expect(read()).toMatchObject({ kind: "session", token: "rt-1" });
    expect(read()).toMatchObject({ kind: "session", token: "rt-1" });
    expect(reads).toBe(1);
  });

  it("caches an absent read too, so a plain visit stays cheap and stable", () => {
    let reads = 0;
    const read = readHandoverOnce(() => {
      reads += 1;
      return { kind: "absent" };
    });

    expect(read()).toEqual({ kind: "absent" });
    expect(read()).toEqual({ kind: "absent" });
    expect(reads).toBe(1);
  });
});
