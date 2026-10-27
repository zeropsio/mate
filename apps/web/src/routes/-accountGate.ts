import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";
import type { ZeropsSessionStatus } from "../zerops/ZeropsSessionProvider";

export type ZeropsAccountGateSurface = "app" | "auth-only" | "pre-account";
const HANDOVER_PATH_PATTERN = new RegExp(`^${ZEROPS_HANDOVER_CALLBACK_PATH}$`, "iu");
/** The component kit (`/kit`): static fixtures that read no account, project or Mate. */
const KIT_PATH_PATTERN = /^\/kit$/iu;

/**
 * Account verification precedes all product routes, including historical
 * pairing links. Two routes run before the account exists: the identity
 * callback, which is what establishes the account, and the component kit,
 * which shows fixtures only.
 */
export function resolveZeropsAccountGate(input: {
  readonly pathname: string;
  readonly status: ZeropsSessionStatus;
}): ZeropsAccountGateSurface {
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  if (HANDOVER_PATH_PATTERN.test(pathname) || KIT_PATH_PATTERN.test(pathname)) {
    return "pre-account";
  }
  return input.status === "signed-in" ? "app" : "auth-only";
}
