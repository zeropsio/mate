import { describe, expect, it } from "@effect/vitest";

import { credentialExpired } from "./credentialExpiry.ts";

const ISSUED_AT = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("credentialExpired", () => {
  // A Zerops session lives a day on the server's clock; the client stores the
  // same deadline on its own clock (issued + `expires_in`), so the two agree
  // without comparing clocks.
  const expiresAt = ISSUED_AT + DAY_MS;
  it.each([
    { case: "a fresh session", now: ISSUED_AT, expired: false },
    { case: "an hour before its deadline", now: expiresAt - 60 * 60_000, expired: false },
    { case: "just outside one slow round trip", now: expiresAt - 30_001, expired: false },
    { case: "within one slow round trip of its deadline", now: expiresAt - 30_000, expired: true },
    { case: "at its deadline", now: expiresAt, expired: true },
    { case: "a day past its deadline", now: expiresAt + DAY_MS, expired: true },
  ])("$case: expired=$expired", ({ now, expired }) => {
    expect(credentialExpired({ expiresAtEpochMs: expiresAt }, now)).toBe(expired);
  });

  it("never judges a credential that carries no deadline", () => {
    // Its server's answer is the only judge; the connection learns it from the refusal.
    expect(credentialExpired({}, ISSUED_AT + 365 * DAY_MS)).toBe(false);
  });
});
