import { describe, expect, it } from "vite-plus/test";

import {
  giteaHostOf,
  giteaSignInRefusalMessage,
  resolveGiteaSignInRequest,
  type KnownGiteaBroker,
} from "./giteaSignIn.ts";

const MINE: KnownGiteaBroker = {
  brokerOrigin: "https://broker-1234-8080.prg1.zerops.app",
  giteaOrigin: "https://web-1234-3000.prg1.zerops.app",
  clientId: "org-1",
};
const OTHER: KnownGiteaBroker = {
  brokerOrigin: "https://broker-9999-8080.prg1.zerops.app",
  giteaOrigin: "https://web-9999-3000.prg1.zerops.app",
  clientId: "org-2",
};

describe("resolveGiteaSignInRequest", () => {
  it("accepts a request for a Gitea this person's account has", () => {
    expect(
      resolveGiteaSignInRequest({ rid: "r1", broker: MINE.brokerOrigin, known: [OTHER, MINE] }),
    ).toEqual({
      ok: true,
      rid: "r1",
      brokerOrigin: MINE.brokerOrigin,
      giteaOrigin: MINE.giteaOrigin,
      giteaHost: "web-1234-3000.prg1.zerops.app",
      // The throwaway is minted in the org that holds this Gitea and nowhere
      // else: a token from another org cannot read this org's tokens.
      clientId: "org-1",
    });
  });

  it("tolerates a trailing slash on the broker origin", () => {
    const answer = resolveGiteaSignInRequest({
      rid: "r1",
      broker: `${MINE.brokerOrigin}/`,
      known: [MINE],
    });
    expect(answer.ok && answer.brokerOrigin).toBe(MINE.brokerOrigin);
  });

  // The whole point of the check: a link is a link, and anybody can send a
  // person here naming any origin as "the broker".
  for (const [name, broker] of [
    ["an origin the account does not have", "https://broker.attacker.example"],
    // A prefix match would accept this, which is exactly the trick.
    ["one that merely starts with a real one", `${MINE.brokerOrigin}.attacker.example`],
    ["a plausible-looking neighbour", OTHER.brokerOrigin.replace("9999", "9998")],
  ] as const) {
    it(`refuses ${name} before a token exists`, () => {
      expect(resolveGiteaSignInRequest({ rid: "r1", broker, known: [MINE, OTHER] })).toEqual({
        ok: false,
        reason: "unknown-broker",
      });
    });
  }

  it("refuses when the account has no Gitea at all", () => {
    expect(
      resolveGiteaSignInRequest({ rid: "r1", broker: MINE.brokerOrigin, known: [] }),
    ).toMatchObject({ ok: false, reason: "unknown-broker" });
  });

  for (const [name, input, reason] of [
    ["no request id", { rid: null, broker: MINE.brokerOrigin }, "missing-request"],
    ["a blank request id", { rid: "  ", broker: MINE.brokerOrigin }, "missing-request"],
    ["no broker at all", { rid: "r1", broker: null }, "missing-broker"],
    ["a blank broker", { rid: "r1", broker: "  " }, "missing-broker"],
  ] as const) {
    it(`refuses a link with ${name}`, () => {
      expect(resolveGiteaSignInRequest({ ...input, known: [MINE] })).toEqual({ ok: false, reason });
    });
  }

  it("says something true for every refusal", () => {
    for (const reason of ["missing-request", "missing-broker", "unknown-broker"] as const) {
      expect(giteaSignInRefusalMessage(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("giteaHostOf", () => {
  it.each([
    ["https://web-1-3000.prg1.zerops.app", "web-1-3000.prg1.zerops.app"],
    ["https://git.example.com/", "git.example.com"],
    ["git.example.com", "git.example.com"],
  ])("names %s as %s", (origin, host) => {
    expect(giteaHostOf(origin)).toBe(host);
  });
});
