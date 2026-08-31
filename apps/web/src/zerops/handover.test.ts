import { describe, expect, it } from "vite-plus/test";

import {
  ZEROPS_HANDOVER_NONCE_KEY,
  completeZeropsHandover,
  startZeropsHandover,
  type ZeropsHandoverNonceStore,
} from "./handover";

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
    const url = new URL(startZeropsHandover({ store }));
    const sent = url.searchParams.get("state") ?? "";

    expect(sent).not.toBe("");
    expect(store.take()).toBe(sent);
  });

  it("mints a fresh nonce per attempt, so an abandoned one cannot be reused", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const url = new URL(startZeropsHandover({ store: fakeStore() }));
      seen.add(url.searchParams.get("state") ?? "");
    }
    expect(seen.size).toBe(32);
    for (const nonce of seen) {
      // Long enough that guessing one is not a strategy.
      expect(nonce.length).toBeGreaterThanOrEqual(22);
    }
  });

  it("carries the sign-up intent when that is the button the user pressed", () => {
    const url = new URL(startZeropsHandover({ store: fakeStore(), intent: "register" }));
    expect(url.searchParams.get("intent")).toBe("register");
    expect(url.pathname).toBe("/authorize-app");
  });
});

describe("completeZeropsHandover", () => {
  it("accepts a callback answering the nonce this browser stored", () => {
    const store = fakeStore("nonce-1");
    const outcome = completeZeropsHandover({
      fragment: "#refreshToken=rt-1&state=nonce-1&clientId=org-1&zcpClaimed=true",
      store,
    });

    expect(outcome).toEqual({
      kind: "session",
      refreshToken: "rt-1",
      clientId: "org-1",
      zcpClaimed: true,
    });
  });

  it("spends the nonce, so the same callback cannot be replayed", () => {
    // A back button, a restored tab or a copied link must not sign anyone in
    // a second time off one authorization.
    const store = fakeStore("nonce-1");
    const fragment = "#refreshToken=rt-1&state=nonce-1";

    expect(completeZeropsHandover({ fragment, store })).toMatchObject({ kind: "session" });
    expect(completeZeropsHandover({ fragment, store })).toEqual({ kind: "mismatched" });
  });

  it("refuses a credential this browser never asked for, and reads nothing out of it", () => {
    const store = fakeStore(null);
    const outcome = completeZeropsHandover({
      fragment: "#refreshToken=attacker-token&state=whatever",
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
    expect(ZEROPS_HANDOVER_NONCE_KEY).toBe("zerops-code.handover-nonce.v1");
  });
});

describe("startZeropsHandover from a dev server", () => {
  // Without this the callback goes to the production origin, where the nonce
  // this tab stored does not exist — the sign-in dies at "did not come from
  // this window" and the dev server never sees a credential.
  it("asks the platform to come back to this localhost port", () => {
    const url = new URL(
      startZeropsHandover({ store: fakeStore(), origin: "http://localhost:5173" }),
    );

    expect(url.searchParams.get("app")).toBe("zerops-code");
    expect(url.searchParams.get("port")).toBe("5173");
  });

  it("infers the default port when the origin leaves it implicit", () => {
    const url = new URL(startZeropsHandover({ store: fakeStore(), origin: "http://localhost" }));
    expect(url.searchParams.get("port")).toBe("80");
  });

  describe("sends no port anywhere else, so the registered origin is used", () => {
    // `origin.ts` trusts the hostname `localhost` and deliberately not
    // `127.0.0.1`; the destination rule follows the same line, and a lookalike
    // hostname must not slip through it.
    for (const origin of [
      "https://z3.krls.cz",
      "http://127.0.0.1:5173",
      "https://localhost.evil.example",
      "https://zcp-2333-8080.prg1.zerops.app",
    ]) {
      it(origin, () => {
        const url = new URL(startZeropsHandover({ store: fakeStore(), origin }));
        expect(url.searchParams.get("port")).toBeNull();
      });
    }
  });
});
