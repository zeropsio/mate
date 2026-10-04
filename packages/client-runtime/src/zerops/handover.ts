/**
 * The Zerops sign-in hand-over, client half.
 *
 * Sign-in, sign-up and third-party sign-in run only on `app.zerops.io`:
 * Turnstile's site key is bound to that hostname, and the GitHub OAuth
 * callback is a fixed URL registered on Zerops' own OAuth App. So the user
 * authenticates there, and the platform hands this client the **access token
 * of its own session** — no refresh token, valid up to its five days, and dead
 * the moment app.zerops.io logs out or refreshes. Nothing is minted per
 * sign-in, so nothing piles up; a 401 sends the tab back for a fresh one.
 *
 * Two rules shape the contract, and both live in this file so neither side can
 * drift from them:
 *
 * 1. **The client names its own destination, and the platform checks it.** It
 *    sends its `origin` and its base `path`; the platform accepts the origin
 *    only when it is a route of a project the user can access (listed in that
 *    project's `MATE_SIGNIN_ORIGINS`), `mate.zerops.io`, or localhost, and
 *    builds the callback as origin + path + `/zerops/authorized`. Both are
 *    held here to the shapes the platform accepts, so a malformed one fails at
 *    the source.
 * 2. **The token comes back in the fragment, and only against a nonce this
 *    browser issued.** A fragment never reaches a server, so it stays out
 *    of access logs and `Referer`. The nonce is what stops a crafted
 *    `#token=…` link signing this browser into someone else's account —
 *    which is why `readZeropsHandover` takes the expected nonce as a parameter
 *    rather than leaving the check to its callers.
 *
 * **Transition.** Until the new FL is live on app.zerops.io, the app.zerops.io
 * still live speaks the old contract: it reads `state` and `port`, mints a
 * personal token, and echoes `state`. So the request carries both forms with
 * one nonce, and either echo is accepted; both credentials are bearers with no
 * refresh token. Every piece of it is marked TRANSITION and goes once the new
 * FL is live there.
 *
 * Pure and platform-free (zone rule R1): the nonce's randomness and its
 * storage belong to the client that calls this.
 *
 * @module zerops/handover
 */

/** Where the platform's own client lives, and the only place sign-up works. */
export const DEFAULT_ZEROPS_GUI_URL = "https://app.zerops.io";

/**
 * The mode this client asks for; an unknown mode is refused there before
 * anything renders.
 * A registry key, not a brand string: it stays `zerops-code` (the value
 * registered in the platform client, `z3-handover.util.ts`) across product
 * renames — no user ever sees it, and changing it needs a platform release.
 */
export const ZEROPS_HANDOVER_APP_MODE = "zerops-code";

/** The route that receives the redirect, under the client's base path. */
export const ZEROPS_HANDOVER_CALLBACK_PATH = "/zerops/authorized";

const AUTHORIZE_PATH = "/authorize-app";

/** The base-path shape both sides accept; empty is the origin root. */
const BASE_PATH_PATTERN = /^(\/[A-Za-z0-9._-]+)*$/u;

/** Ask for the sign-up entry rather than sign-in; the platform picks the route. */
export type ZeropsHandoverIntent = "register";

/** `scheme://host[:port]` over http(s), with nothing after it. */
function isBareWebOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === origin
    );
  } catch {
    return false;
  }
}

export function buildZeropsAuthorizeUrl(input: {
  readonly nonce: string;
  /** This client's origin, exactly as `location.origin` reads it. */
  readonly origin: string;
  /** The base path this bundle is served under; empty at the origin root. */
  readonly path: string;
  /**
   * The project this instance runs in, when the build names one (a dev
   * instance). A hint for the platform's origin check, never a destination.
   */
  readonly project?: string;
  /**
   * TRANSITION, with `state` below — remove both once the new FL is live on
   * app.zerops.io: the old one ignores `origin` and finds a dev server only by
   * this number, interpolated into `http://localhost:<port>`.
   */
  readonly loopbackPort?: number;
  readonly intent?: ZeropsHandoverIntent;
  readonly guiBaseUrl?: string;
}): string {
  const nonce = input.nonce.trim();
  if (!nonce) {
    // Without a nonce the callback cannot be checked, so the request would
    // produce a credential this client must then refuse. Fail at the source.
    throw new Error("A Zerops hand-over needs a nonce to verify its callback against.");
  }
  if (!isBareWebOrigin(input.origin)) {
    throw new Error(
      `${JSON.stringify(input.origin)} is not an origin a callback can come back to.`,
    );
  }
  if (!BASE_PATH_PATTERN.test(input.path)) {
    throw new Error(
      `${JSON.stringify(input.path)} is not a base path a callback can come back under.`,
    );
  }
  const url = new URL(AUTHORIZE_PATH, input.guiBaseUrl ?? DEFAULT_ZEROPS_GUI_URL);
  url.searchParams.set("app", ZEROPS_HANDOVER_APP_MODE);
  url.searchParams.set("origin", input.origin);
  url.searchParams.set("path", input.path);
  url.searchParams.set("nonce", nonce);
  // TRANSITION: the old FL reads the nonce as `state`.
  url.searchParams.set("state", nonce);
  if (input.loopbackPort !== undefined) {
    // Refuse rather than quietly drop it: a dropped port sends the old FL's
    // credential to mate.zerops.io and leaves this dev server waiting.
    if (
      !Number.isInteger(input.loopbackPort) ||
      input.loopbackPort < 1 ||
      input.loopbackPort > 65_535
    ) {
      throw new Error(`${String(input.loopbackPort)} is not a port a callback can come back on.`);
    }
    url.searchParams.set("port", String(input.loopbackPort));
  }
  if (input.project) {
    url.searchParams.set("project", input.project);
  }
  if (input.intent) {
    url.searchParams.set("intent", input.intent);
  }
  return url.toString();
}

export type ZeropsHandoverOutcome =
  /** Verified: a credential addressed to a request this browser made. */
  | {
      readonly kind: "session";
      /**
       * A bearer with no refresh token: the access token of the user's
       * app.zerops.io session, or (TRANSITION, old FL) a personal token.
       */
      readonly token: string;
      /** The organization the platform signed in, or null when it named none. */
      readonly clientId: string | null;
      /** True when a pool project was claimed, so the picker can be skipped. */
      readonly zcpClaimed: boolean;
    }
  /** The nonce checked out, but the hand-over did not produce a session. */
  | { readonly kind: "declined"; readonly code: string }
  /**
   * A hand-over-shaped response that this browser did not ask for. Carries
   * nothing from the response on purpose: the only safe thing to do with an
   * unverified credential is to not look at it.
   */
  | { readonly kind: "mismatched" }
  /** No hand-over in this URL at all — an ordinary visit to the route. */
  | { readonly kind: "absent" };

/** What the platform answers with when the user backs out at the consent step. */
export const ZEROPS_HANDOVER_DECLINED_CODE = "access_denied";

/** Our own code for a verified response that carried no usable credential. */
export const ZEROPS_HANDOVER_INVALID_CODE = "invalid_response";

export function readZeropsHandover(
  fragment: string,
  expectedNonce: string | null,
): ZeropsHandoverOutcome {
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  const token = params.get("token")?.trim() ?? "";
  const error = params.get("error")?.trim() ?? "";
  // TRANSITION: the old FL echoes the nonce as `state` (with a personal
  // token); drop that fallback once the new FL is live on app.zerops.io.
  const echoedNonce = (params.get("nonce") ?? params.get("state"))?.trim() ?? "";

  // Anything carrying none of the three is somebody else's fragment, or none
  // at all — a plain visit to the route, not a failed hand-over.
  if (!token && !error && !echoedNonce) {
    return { kind: "absent" };
  }

  const expected = expectedNonce?.trim() ?? "";
  if (!expected || echoedNonce !== expected) {
    return { kind: "mismatched" };
  }

  if (error) {
    return { kind: "declined", code: error };
  }
  if (!token) {
    return { kind: "declined", code: ZEROPS_HANDOVER_INVALID_CODE };
  }

  const clientId = params.get("clientId")?.trim() ?? "";
  return {
    kind: "session",
    token,
    clientId: clientId || null,
    zcpClaimed: params.get("zcpClaimed") === "true",
  };
}
