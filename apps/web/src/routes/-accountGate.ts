import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";

import type { ZeropsSessionStatus } from "../zerops/ZeropsSessionProvider";

export type ZeropsAccountGateSurface = "app" | "auth-only" | "handover" | "pairing";

const HANDOVER_PATH_PATTERN = new RegExp(`^${ZEROPS_HANDOVER_CALLBACK_PATH}$`, "iu");
const PAIRING_PATH_PATTERN = /^\/pair$/iu;

/**
 * The account is required everywhere. Mate is the surface a Zerops user signs
 * into, so there is no second product behind the login: a client with no
 * account reaches the login and nothing else.
 *
 * This used to depend on how the client was served, which made a signed-out
 * browser fall through to the upstream shell — the project tree, the branch
 * toolbar, and somebody's threads still readable. The two exceptions below are
 * routes that must run before an account can exist, not modes without one.
 */
export function resolveZeropsAccountGate(input: {
  readonly pathname: string;
  readonly status: ZeropsSessionStatus;
}): ZeropsAccountGateSurface {
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  // The identity callback carries the credential that creates the session, so
  // it cannot be behind the session.
  if (HANDOVER_PATH_PATTERN.test(pathname)) return "handover";
  // Pairing attaches an environment by one-time link. It stays reachable
  // because it is how a client is pointed at a container in the first place.
  if (PAIRING_PATH_PATTERN.test(pathname)) return "pairing";
  return input.status === "signed-in" ? "app" : "auth-only";
}
