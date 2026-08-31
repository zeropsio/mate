/**
 * Which browser origins may talk to a z3 server running inside a Zerops
 * project.
 *
 * Upstream leaves CORS at a wildcard and puts no `Origin` check on the
 * websocket upgrade, which is survivable for a loopback server and is not for
 * one published on the public internet by the container's own nginx. Both
 * holes are closed by the same list:
 *
 * - the container's own origin, matched per request against the host it was
 *   asked for rather than configured. A client served under `/z3/` is
 *   same-origin with this API, so this case never appears in CORS at all - it
 *   exists only on the upgrade, which a browser sends an `Origin` for whether
 *   or not the request is cross-site.
 * - `localhost` on any port and either scheme, so a developer's Vite server
 *   can drive a real container. This is a product-level convenience, not a
 *   temporary hack, and it deliberately does NOT extend to `127.0.0.1`: the
 *   trust is on the hostname, the same rule the zcp welcome bridge uses.
 * - an HTTPS subdomain of `zerops.app`, `zerops.dev` or `zerops.io`. This
 *   Zerops-issued domain set mirrors the container nginx's `frame-ancestors`
 *   boundary. It trusts every Zerops tenant, not only Zerops the vendor:
 *   `https://evil.<some-container-host>.zerops.app` is allowed, and gains no
 *   ambient authority only because a Zerops server refuses the browser cookie
 *   it never issues and this CORS policy is uncredentialed.
 * - the two desktop shell origins.
 * - `https://z3.krls.cz`, the hosted web client's current home. TEMPORARY:
 *   it is a personal domain standing in until the hosted client moves to a
 *   Zerops-issued one, which the `.zerops.app`/`.dev`/`.io` rule above already
 *   covers. It is built in rather than configured because the client has to
 *   reach EVERY user's container, and `T3CODE_ZEROPS_ALLOWED_ORIGINS` is
 *   per-container — only an operator who has typed it into that one service's
 *   env would be reachable, which is not a product. Delete this entry the day
 *   the client is served from a Zerops domain.
 * - anything named in `T3CODE_ZEROPS_ALLOWED_ORIGINS`, matched exactly.
 *
 * A request that carries no `Origin` is allowed to upgrade: a caller that is
 * not a browser cannot be cross-site request forged, and every script, the
 * desktop shell and the mobile app arrive that way.
 *
 * @module zerops/origin
 */
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";

/** The custom schemes the packaged desktop renderer is served from. */
const DESKTOP_SHELL_ORIGINS = ["t3code://app", "t3code-dev://app"] as const;
/**
 * TEMPORARY — the hosted web client's current home, a personal domain standing
 * in until it moves to a Zerops-issued one. Remove this constant and its entry
 * below once that move happens; the Zerops suffix rule covers it from then on.
 */
const HOSTED_CLIENT_ORIGINS = ["https://z3.krls.cz"] as const;
const ZEROPS_BROWSER_ORIGIN_SUFFIXES = [".zerops.app", ".zerops.dev", ".zerops.io"] as const;

const parseOrigin = (origin: string): URL | undefined => {
  try {
    return new URL(origin);
  } catch {
    return undefined;
  }
};

export interface ZeropsOriginAllowlist {
  /**
   * Cross-origin browser access: CORS. Takes `string | undefined` because that
   * is how the CORS middleware calls it - a request with no `Origin` header
   * passes `undefined` straight through, on every response, not just
   * preflights.
   */
  readonly allowsOrigin: (origin: string | undefined) => boolean;
  /** The websocket upgrade, which also knows the host it was asked for. */
  readonly allowsUpgrade: (input: {
    readonly origin: string | undefined;
    readonly host: string | undefined;
    readonly forwardedHost?: string | undefined;
  }) => boolean;
}

export const makeZeropsOriginAllowlist = (
  environment: ZeropsEnvironment,
): ZeropsOriginAllowlist => {
  const configured = new Set<string>([
    ...environment.allowedOrigins,
    ...DESKTOP_SHELL_ORIGINS,
    ...HOSTED_CLIENT_ORIGINS,
  ]);

  const allowsOrigin = (origin: string | undefined): boolean => {
    if (origin === undefined || origin.length === 0) {
      return false;
    }
    if (configured.has(origin)) {
      return true;
    }
    const parsed = parseOrigin(origin);
    // The leading dot anchors every Zerops suffix below its apex:
    // `evilzerops.app` and the bare `zerops.app` cannot pass.
    return (
      parsed !== undefined &&
      ((parsed.hostname === "localhost" &&
        (parsed.protocol === "http:" || parsed.protocol === "https:")) ||
        (parsed.protocol === "https:" &&
          ZEROPS_BROWSER_ORIGIN_SUFFIXES.some(
            (suffix) =>
              parsed.hostname.endsWith(suffix) &&
              parsed.hostname.length > suffix.length &&
              !parsed.hostname.slice(0, -suffix.length).endsWith("."),
          )))
    );
  };

  const allowsUpgrade: ZeropsOriginAllowlist["allowsUpgrade"] = (input) => {
    const origin = input.origin?.trim() ?? "";
    if (origin.length === 0) {
      return true;
    }
    if (allowsOrigin(origin)) {
      return true;
    }
    const parsed = parseOrigin(origin);
    if (parsed === undefined) {
      return false;
    }
    // Same-origin. `Host` is what the browser asked for and cannot be set by a
    // cross-origin page; `X-Forwarded-Host` covers the container's nginx,
    // which terminates the request and rewrites `Host` to the upstream.
    return parsed.host === input.host || parsed.host === input.forwardedHost;
  };

  return { allowsOrigin, allowsUpgrade };
};
