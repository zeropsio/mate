import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";
import type { ZeropsSessionStatus } from "../zerops/ZeropsSessionProvider";

export type ZeropsAccountGateSurface = "app" | "auth-only" | "pre-account";
const HANDOVER_PATH_PATTERN = new RegExp(`^${ZEROPS_HANDOVER_CALLBACK_PATH}$`, "iu");

/** Where the broker sends a person to agree to signing in to Gitea (guide 3.6). */
export const GITEA_SIGNIN_PATH = "/gitea-signin";

/**
 * Account verification precedes all product routes, including historical
 * pairing links. Two routes run before the account exists, and only two:
 *
 * - the identity callback, which is what establishes the account;
 * - the Gitea consent page, signed out, which has to keep the request the
 *   broker put in its URL before sending the person off to sign in. Signed in
 *   it is an ordinary product route, because it reads the account's own Gitea
 *   projects to decide whether the `broker` in that URL is really theirs.
 */
export function resolveZeropsAccountGate(input: {
  readonly pathname: string;
  readonly status: ZeropsSessionStatus;
}): ZeropsAccountGateSurface {
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  if (HANDOVER_PATH_PATTERN.test(pathname)) return "pre-account";
  if (pathname.toLowerCase() === GITEA_SIGNIN_PATH && input.status !== "signed-in") {
    return "pre-account";
  }
  return input.status === "signed-in" ? "app" : "auth-only";
}
