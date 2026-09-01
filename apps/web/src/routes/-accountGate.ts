import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";

import type { ZeropsSessionStatus } from "../zerops/ZeropsSessionProvider";

export type ZeropsAccountGateSurface = "app" | "auth-only" | "handover" | "pairing";

const HANDOVER_PATH_PATTERN = new RegExp(`^${ZEROPS_HANDOVER_CALLBACK_PATH}$`, "iu");
const PAIRING_PATH_PATTERN = /^\/pair$/iu;
const ZEROPS_ENTRY_PATH_PATTERN = /^\/zerops$/iu;

export function resolveZeropsAccountGate(input: {
  readonly accountRequired?: boolean | undefined;
  readonly pathname: string;
  readonly status: ZeropsSessionStatus;
}): ZeropsAccountGateSurface {
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  if (HANDOVER_PATH_PATTERN.test(pathname)) return "handover";
  if (PAIRING_PATH_PATTERN.test(pathname)) return "pairing";
  if (ZEROPS_ENTRY_PATH_PATTERN.test(pathname) && input.status !== "signed-in") return "auth-only";
  if (input.accountRequired === false) return "app";
  return input.status === "signed-in" ? "app" : "auth-only";
}
