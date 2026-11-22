import type { ZeropsSessionStatus } from "../zerops/ZeropsSessionProvider";

export type ZeropsAccountGateSurface = "app" | "auth-only" | "pre-account";
/** The component kit (`/kit`): static fixtures that read no account, project or Mate. */
const KIT_PATH_PATTERN = /^\/kit$/iu;

/**
 * Account verification precedes all product routes, including historical
 * pairing links. One route runs before the account exists: the component kit,
 * which shows fixtures only.
 */
export function resolveZeropsAccountGate(input: {
  readonly pathname: string;
  readonly status: ZeropsSessionStatus;
}): ZeropsAccountGateSurface {
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  if (KIT_PATH_PATTERN.test(pathname)) {
    return "pre-account";
  }
  return input.status === "signed-in" ? "app" : "auth-only";
}
