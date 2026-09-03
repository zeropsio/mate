import { describe, expect, it } from "@effect/vitest";

import { credentialRenewAtEpochMs } from "./credentialRenewal.ts";

const ISSUED_AT = 1_000_000;

describe("credentialRenewAtEpochMs", () => {
  it("renews a Zerops membership window well before it lapses", () => {
    // The Zerops identity door caps a session at one membership window
    // (900s by default). Renewing at 80% of it leaves three minutes of slack
    // for a slow round trip while still re-proving membership every window.
    const expiresAt = ISSUED_AT + 900_000;
    expect(
      credentialRenewAtEpochMs({ issuedAtEpochMs: ISSUED_AT, expiresAtEpochMs: expiresAt }),
    ).toBe(ISSUED_AT + 720_000);
  });

  it("keeps a floor under the lead so a short window still renews ahead of expiry", () => {
    const expiresAt = ISSUED_AT + 60_000;
    // 20% of a minute is 12s, too tight for a round trip — the floor wins.
    expect(
      credentialRenewAtEpochMs({ issuedAtEpochMs: ISSUED_AT, expiresAtEpochMs: expiresAt }),
    ).toBe(ISSUED_AT + 30_000);
  });

  it("caps the lead so a long-lived pairing token is not renewed constantly", () => {
    // A one-time-token session lives 30 days; 20% of that would renew it six
    // days early, for no benefit.
    const expiresAt = ISSUED_AT + 30 * 24 * 60 * 60 * 1000;
    expect(
      credentialRenewAtEpochMs({ issuedAtEpochMs: ISSUED_AT, expiresAtEpochMs: expiresAt }),
    ).toBe(expiresAt - 300_000);
  });

  it("never schedules before the credential was issued", () => {
    // A window shorter than the lead floor would otherwise resolve to a moment
    // already in the past, which reads as "renew forever".
    const expiresAt = ISSUED_AT + 20_000;
    expect(
      credentialRenewAtEpochMs({ issuedAtEpochMs: ISSUED_AT, expiresAtEpochMs: expiresAt }),
    ).toBe(ISSUED_AT);
  });

  it("declines to schedule when the credential does not carry an expiry", () => {
    // Records persisted before the expiry was stored, and any door that does
    // not report one: proactive renewal is off, the reactive path still covers
    // them.
    expect(credentialRenewAtEpochMs({ issuedAtEpochMs: ISSUED_AT })).toBeNull();
    expect(credentialRenewAtEpochMs({})).toBeNull();
  });
});
