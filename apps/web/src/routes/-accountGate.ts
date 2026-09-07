import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";
import type { ZeropsSessionStatus } from "../zerops/ZeropsSessionProvider";

export type ZeropsAccountGateSurface = "app" | "auth-only" | "handover";
const HANDOVER_PATH_PATTERN = new RegExp(`^${ZEROPS_HANDOVER_CALLBACK_PATH}$`, "iu");

/** Account verification precedes all product routes, including historical pairing links.
 * Only the identity callback can run before the account it establishes exists. */
export function resolveZeropsAccountGate(input: {
  readonly pathname: string;
  readonly status: ZeropsSessionStatus;
}): ZeropsAccountGateSurface {
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  if (HANDOVER_PATH_PATTERN.test(pathname)) return "handover";
  return input.status === "signed-in" ? "app" : "auth-only";
}
