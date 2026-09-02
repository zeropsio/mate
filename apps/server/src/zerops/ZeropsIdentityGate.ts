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
import { AuthExecOperateScope, AuthStandardClientScopes } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { verifyProjectMembership } from "./ZeropsIdentity.ts";

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
 * `exec:operate` is here because a member of this project can already open a
 * shell in this container through code-server and through the agent, so it
 * grants no reach the door has not already proven. It is deliberately NOT in
 * the standard client set, so a pairing token handed to some other device does
 * not carry it.
 */
export const zeropsGrantScopes: ReadonlyArray<AuthEnvironmentScope> = [
  ...AuthStandardClientScopes,
  AuthExecOperateScope,
];

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
      subject: member.userId,
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
