/**
 * The Zerops sign-in hand-over, client half.
 *
 * Sign-up and third-party sign-in can only run on `app.zerops.io`: Turnstile's
 * site key is bound to that hostname, and the GitHub OAuth callback is a fixed
 * URL registered on Zerops' own OAuth App. So the user authenticates there, the
 * platform mints them a **personal access token** for this client, and
 * redirects it back here.
 *
 * A personal token rather than the account's own session: it is minted for this
 * client alone, it is revocable on its own from Settings without touching the
 * browser session, and nothing durable belonging to the account's own sign-in
 * ever crosses. It is user-scoped, so it still spans every organization the
 * account belongs to — which the picker needs.
 *
 * Two rules shape the contract, and both live in this file so neither side can
 * drift from them:
 *
 * 1. **The client never names a destination.** It names a *mode*; the platform
 *    maps the mode to a callback from its own registry. No URL ever crosses in
 *    the request, so there is nothing to validate and no open-redirect surface
 *    to get wrong. The single exception is a dev server's loopback port, which
 *    is a number on a hostname the platform fixes — see
 *    `ZEROPS_HANDOVER_DEV_APP_MODE`.
 * 2. **The token comes back in the fragment, and only against a nonce this
 *    browser issued.** A fragment never reaches a server, so it stays out
 *    of access logs and `Referer`. The nonce is what stops a crafted
 *    `#token=…` link signing this browser into someone else's account —
 *    which is why `readZeropsHandover` takes the expected nonce as a parameter
 *    rather than leaving the check to its callers.
 *
 * Pure and platform-free (zone rule R1): the nonce's randomness and its
 * storage belong to the client that calls this.
 *
 * @module zerops/handover
 */

/** Where the platform's own client lives, and the only place sign-up works. */
export const DEFAULT_ZEROPS_GUI_URL = "https://app.zerops.io";

/**
 * The mode this client asks for. The platform's registry maps it to our
 * callback origin; an unknown mode is refused there before anything renders.
 * A registry key, not a brand string: it stays `zerops-code` (the value
 * registered in the platform client, `z3-handover.util.ts`) across product
 * renames — no user ever sees it, and changing it needs a platform release.
 */
export const ZEROPS_HANDOVER_APP_MODE = "zerops-code";

/** The route that receives the redirect. Registered platform-side per mode. */
export const ZEROPS_HANDOVER_CALLBACK_PATH = "/zerops/authorized";

const AUTHORIZE_PATH = "/authorize-app";

/** Ask for the sign-up entry rather than sign-in; the platform picks the route. */
export type ZeropsHandoverIntent = "register";

export function buildZeropsAuthorizeUrl(input: {
  readonly state: string;
  readonly intent?: ZeropsHandoverIntent;
  /**
   * Set only by a dev server on `localhost`, and then the callback goes to
   * `http://localhost:<port>` instead of the registered origin.
   *
   * This is the one thing a caller contributes to its own destination, and it
   * is a **number**, never a URL: the platform interpolates it into a hostname
   * and path it fixes, so there is nothing to parse and none of the ways URL
   * validation is normally got wrong (`https://localhost@evil.example`,
   * `localhost.evil.example`, backslashes) can arise. What it costs is the
   * ordinary native-app-flow exposure — a process already on the user's
   * machine could receive the session, and such a process can read the browser
   * profile anyway.
   */
  readonly loopbackPort?: number;
  readonly guiBaseUrl?: string;
}): string {
  const state = input.state.trim();
  if (!state) {
    // Without a nonce the callback cannot be checked, so the request would
    // produce a credential this client must then refuse. Fail at the source.
    throw new Error("A Zerops hand-over needs a nonce to verify its callback against.");
  }
  const url = new URL(AUTHORIZE_PATH, input.guiBaseUrl ?? DEFAULT_ZEROPS_GUI_URL);
  url.searchParams.set("app", ZEROPS_HANDOVER_APP_MODE);
  url.searchParams.set("state", state);
  if (input.loopbackPort !== undefined) {
    // Refuse rather than quietly drop it: a dropped port sends the credential
    // to the registered origin and leaves this dev server waiting for a
    // callback that is never coming.
    if (
      !Number.isInteger(input.loopbackPort) ||
      input.loopbackPort < 1 ||
      input.loopbackPort > 65_535
    ) {
      throw new Error(`${String(input.loopbackPort)} is not a port a callback can come back on.`);
    }
    url.searchParams.set("port", String(input.loopbackPort));
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
      /** A personal access token, usable directly as the session's bearer. */
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
  expectedState: string | null,
): ZeropsHandoverOutcome {
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  const token = params.get("token")?.trim() ?? "";
  const error = params.get("error")?.trim() ?? "";
  const echoedState = params.get("state")?.trim() ?? "";

  // Anything carrying none of the three is somebody else's fragment, or none
  // at all — a plain visit to the route, not a failed hand-over.
  if (!token && !error && !echoedState) {
    return { kind: "absent" };
  }

  const expected = expectedState?.trim() ?? "";
  if (!expected || echoedState !== expected) {
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
