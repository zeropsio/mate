import type { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";

import type { BearerConnectionCredential } from "./catalog.ts";
import type { ConnectionAttemptError } from "./model.ts";

/**
 * When a stored bearer should be exchanged for a fresh one.
 *
 * Renewing ahead of the deadline keeps the failure off the user's screen — a
 * credential that expires unnoticed surfaces as "Connection failed. The
 * environment credential is invalid."
 *
 * **Nothing renews a Zerops session any more, and that is the point.** The
 * Zerops door used to cap a session at one membership window because the
 * server could not re-check membership on its own, so the client re-minted
 * every fifteen minutes — which meant a person's own Zerops token arriving at
 * a container four times an hour, forever. The server now re-reads roles
 * itself (`ZeropsMembershipWatch`) and ends the sessions whose answer changed;
 * the client re-sends nothing in between and opens a new one with a fresh
 * throwaway when it has to (guide 3.5). This contract stays for a door that
 * has something to re-present; no client supplies one today.
 */

/** Long enough for a slow round trip on a bad connection. */
const MIN_RENEWAL_LEAD_MS = 30_000;
/** A 30-day pairing session must not be renewed six days early. */
const MAX_RENEWAL_LEAD_MS = 300_000;
const RENEWAL_LEAD_FRACTION = 0.2;

export interface RenewableCredentialLifetime {
  readonly issuedAtEpochMs?: number | undefined;
  readonly expiresAtEpochMs?: number | undefined;
}

/**
 * The moment to renew at, or `null` when the credential carries no expiry —
 * records persisted before the deadline was stored, and doors that report none.
 * Those keep the reactive path (fail, then re-mint) as their only recovery.
 */
export function credentialRenewAtEpochMs(credential: RenewableCredentialLifetime): number | null {
  const expiresAtEpochMs = credential.expiresAtEpochMs;
  if (expiresAtEpochMs === undefined) {
    return null;
  }
  const issuedAtEpochMs = credential.issuedAtEpochMs;
  const lifetimeMs = issuedAtEpochMs === undefined ? 0 : expiresAtEpochMs - issuedAtEpochMs;
  const leadMs = Math.min(
    MAX_RENEWAL_LEAD_MS,
    Math.max(MIN_RENEWAL_LEAD_MS, Math.round(lifetimeMs * RENEWAL_LEAD_FRACTION)),
  );
  // A window shorter than the floor would resolve to a moment already past,
  // which a scheduler reads as "renew continuously". Clamp to issue time so it
  // renews once, immediately, instead.
  return Math.max(issuedAtEpochMs ?? 0, expiresAtEpochMs - leadMs);
}

/**
 * Exchanges a stored bearer for a fresh one, using whatever the door that
 * minted it needs.
 *
 * Optional: a client that does not provide it keeps the reactive path — the
 * connection fails on an expired credential and something re-mints afterwards.
 * The registry looks it up with `Effect.serviceOption`, so mobile and desktop
 * are unaffected until they supply one.
 *
 * `Option.none()` means "nothing to renew here" (an origin this renewer does
 * not handle) and is not an error.
 */
export class ConnectionCredentialRenewer extends Context.Service<
  ConnectionCredentialRenewer,
  {
    readonly renew: (input: {
      readonly environmentId: EnvironmentId;
      readonly connectionId: string;
      /** The stored profile's origin, when the entry has one. */
      readonly httpBaseUrl: string | undefined;
      readonly credential: BearerConnectionCredential;
    }) => Effect.Effect<Option.Option<BearerConnectionCredential>, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/connection/credentialRenewal/ConnectionCredentialRenewer") {}

export const layer = (service: ConnectionCredentialRenewer["Service"]) =>
  Layer.succeed(ConnectionCredentialRenewer, ConnectionCredentialRenewer.of(service));
