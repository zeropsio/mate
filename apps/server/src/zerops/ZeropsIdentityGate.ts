/**
 * ZeropsIdentityGate - the door into a mate server that runs inside a Zerops
 * project.
 *
 * The client presents its Zerops access token; this proves the caller is a
 * member of the container's project and, on that proof alone, mints the
 * ordinary short-lived pairing grant every other bootstrap method produces.
 * The client then does the normal RFC 8693 exchange. There is no second
 * session model and no shared container secret: the only credential is the
 * user's own Zerops identity.
 *
 * The token is never stored. It travels as an argument, becomes a request
 * header for two reads, and is gone. What outlives the call is a grant whose
 * `subject` is the Zerops user id - which is what makes per-user revocation
 * (`revokeBySubject`) meaningful.
 *
 * @module ZeropsIdentityGate
 */
import type { AuthEnvironmentScope, AuthPairingCredentialResult } from "@t3tools/contracts";
import { AuthZeropsClientScopes } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { verifyProjectMembership } from "./ZeropsIdentity.ts";
import { verifyThrowawayCaller } from "./ZeropsThrowawayIdentity.ts";

/**
 * How long the minted grant stays redeemable. It is handed straight back over
 * an authenticated response and exchanged immediately, so it needs minutes,
 * not hours - the same budget the cloud mint path uses.
 */
export const ZEROPS_PAIRING_GRANT_TTL = Duration.minutes(2);

/**
 * What a Zerops member's client is allowed to do: the ordinary client set plus
 * command execution. Administrative scopes - managing other clients' access -
 * stay off this path; membership is the door, not a privilege level.
 *
 * The same list the client asks for (`AuthZeropsClientScopes`), and it has to
 * be: the exchange refuses a request for a scope the grant does not carry.
 */
export const zeropsGrantScopes: ReadonlyArray<AuthEnvironmentScope> = AuthZeropsClientScopes;

/**
 * Proves membership and mints the pairing grant. Fails without issuing
 * anything when the caller is not a member, presents an invalid token, or the
 * platform cannot be reached.
 */
export const mintZeropsPairingCredential = Effect.fn("Zerops.mintPairingCredential")(
  function* (input: {
    readonly environment: ZeropsEnvironment;
    readonly token: string;
    readonly proofKeyThumbprint?: string;
  }) {
    const member = yield* verifyProjectMembership({
      environment: input.environment,
      token: input.token,
    });
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const issued = yield* serverAuth.createPairingLink({
      // Names the door, so the session it becomes is the one that can renew
      // itself by re-proving membership.
      method: "zerops-identity",
      scopes: zeropsGrantScopes,
      subject: `zerops-user:${member.userId}`,
      ttl: ZEROPS_PAIRING_GRANT_TTL,
      label: member.role === undefined ? "Zerops" : `Zerops ${member.role}`,
      ...(input.proofKeyThumbprint ? { proofKeyThumbprint: input.proofKeyThumbprint } : {}),
    });
    return {
      id: issued.id,
      credential: issued.credential,
      ...(issued.label ? { label: issued.label } : {}),
      expiresAt: issued.expiresAt,
    } satisfies AuthPairingCredentialResult;
  },
);

/**
 * Proves a throwaway, resolves its creator's role, and mints the pairing
 * grant — the only door `zerops-throwaway` has.
 *
 * Fails without issuing anything when the credential is not a throwaway for
 * this Mate, when its creator is `READ_ONLY` here (the Mate is theirs to see,
 * not to open), when they are no member at all, or when the platform cannot be
 * reached. The scopes are the same set `zerops-identity` grants: role decides
 * *whether* the door opens, never *how far*.
 */
export const mintZeropsThrowawayPairingCredential = Effect.fn(
  "Zerops.mintThrowawayPairingCredential",
)(function* (input: {
  readonly environment: ZeropsEnvironment;
  readonly token: string;
  readonly proofKeyThumbprint?: string;
}) {
  const caller = yield* verifyThrowawayCaller({
    environment: input.environment,
    token: input.token,
  });
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const issued = yield* serverAuth.createPairingLink({
    // Names the door, so 3.3's re-check knows which sessions it owns.
    method: "zerops-throwaway",
    scopes: zeropsGrantScopes,
    subject: `zerops-user:${caller.userId}`,
    ttl: ZEROPS_PAIRING_GRANT_TTL,
    label: `Zerops ${caller.role}`,
    ...(input.proofKeyThumbprint ? { proofKeyThumbprint: input.proofKeyThumbprint } : {}),
  });
  return {
    id: issued.id,
    credential: issued.credential,
    ...(issued.label ? { label: issued.label } : {}),
    expiresAt: issued.expiresAt,
  } satisfies AuthPairingCredentialResult;
});
