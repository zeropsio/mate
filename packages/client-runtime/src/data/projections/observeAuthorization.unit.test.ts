import { expect, it } from "vite-plus/test";
import type { ObserveCredentialRead } from "./observeCredential.ts";
import { authorizesObserveByItself } from "./observeAuthorization.ts";
const NONE = { authorized: false, userId: null, expiresAt: null };
const AUTH = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
const known = (value: typeof NONE | typeof AUTH, stale = false) =>
  ({ state: "known", value, stale }) satisfies ObserveCredentialRead["metadata"];
// witness: packages/client-runtime/src/data/projections/observeAuthorization.ts | !metadata.stale → metadata.stale
it("PJ65: A Mate's own person opening it authorizes observation by itself only when the Mate is read as not authorized: never when already authorized, from a last known state, or before the authorization is read", () => {
  expect(authorizesObserveByItself({ mine: true, metadata: known(NONE), asked: false })).toBe(true);
  expect(authorizesObserveByItself({ mine: true, metadata: known(AUTH), asked: false })).toBe(
    false,
  );
  expect(authorizesObserveByItself({ mine: true, metadata: known(NONE, true), asked: false })).toBe(
    false,
  );
  expect(
    authorizesObserveByItself({ mine: true, metadata: { state: "reading" }, asked: false }),
  ).toBe(false);
});
