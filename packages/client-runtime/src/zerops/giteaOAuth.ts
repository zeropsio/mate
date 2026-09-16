/**
 * Signing in to the account's Gitea as the person — OAuth2 authorization code
 * with PKCE, against Gitea's own `/login/oauth` endpoints (guide 4.4, P11).
 *
 * ## Why the app acts as the person and not as the broker
 *
 * Gitea already knows what this person may do: the broker mirrors their Zerops
 * role into teams at every sign-in (guide 1.4). A token that acts as the person
 * is therefore a token Gitea polices — a `read` member cannot merge a recipe
 * change however the app asks. The broker is not in this path at all, so
 * nothing the app does here can widen anybody's reach.
 *
 * ## The public application, made as the person
 *
 * Gitea has no way to declare an OAuth application out of band, and the broker
 * deliberately does not make one: creating applications is a site-admin write,
 * and the broker's whole contract is that it never acts for a caller it did not
 * prove. So the app registers its own, lazily, **as the person** after their
 * first Gitea sign-in through the broker's consent page:
 *
 * ```
 * POST /user/applications/oauth2
 * { name: "Zerops Mate", redirect_uris: ["<app origin>/gitea/callback"],
 *   confidential_client: false }
 * ```
 *
 * or reuses one already named `Zerops Mate` **whose redirect URIs cover this
 * origin**. A public client has no secret, so the `client_id` is not a
 * credential; it is still kept in memory only, per app origin, because an app
 * served from a second origin needs a second redirect URI and therefore a
 * different registration rather than a stale one from a previous run.
 *
 * ## What never touches storage
 *
 * The verifier, the state, the access token and the refresh token. They live
 * for the session in memory (`apps/web/src/zerops/giteaSession.ts`); a token in
 * `localStorage` is a token every script on the origin can read, and this one
 * acts as the person in their company's forge.
 *
 * Nothing here reaches a network, a clock or a platform global (rule R1): the
 * caller brings `fetch`, the random bytes and the SHA-256.
 *
 * @module giteaOAuth
 */

/** What the app registers itself as in Gitea, and looks for before registering. */
import type { RandomBytes } from "./newProject.ts";

export const GITEA_OAUTH_APPLICATION_NAME = "Zerops Mate";

/** Where Gitea sends the browser back. Relative to the app's own origin. */
export const GITEA_OAUTH_CALLBACK_PATH = "/gitea/callback";

/** The only challenge method Mate uses; `plain` is a downgrade, never offered. */
export const GITEA_PKCE_METHOD = "S256";

/** 32 bytes of entropy, which base64url-encodes to the 43 characters RFC 7636 wants. */
export const GITEA_PKCE_VERIFIER_BYTES = 32;

/** The redirect URI for an app served from this origin. */
export function giteaOAuthRedirectUri(appOrigin: string): string {
  return `${appOrigin.trim().replace(/\/+$/u, "")}${GITEA_OAUTH_CALLBACK_PATH}`;
}

/**
 * base64url without padding — the encoding every value in this flow uses.
 *
 * Written out rather than taken from `btoa`, which is a platform global this
 * package may not read (rule R1) and which takes a binary string rather than
 * bytes.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += alphabet[a >> 2];
    out += alphabet[((a & 0b11) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += alphabet[((b & 0b1111) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += alphabet[c & 0b111111];
  }
  return out;
}

/** The SHA-256 the caller brings — `crypto.subtle.digest` in every shell. */
export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;

export interface GiteaPkcePair {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: typeof GITEA_PKCE_METHOD;
}

/**
 * A fresh verifier and its challenge.
 *
 * The challenge is the base64url of the SHA-256 of the **ASCII of the
 * verifier**, not of the bytes it was encoded from — a distinction that costs
 * an afternoon when it is got wrong, because the authorize step succeeds
 * either way and only the exchange fails.
 */
export async function createGiteaPkcePair(input: {
  readonly randomBytes: RandomBytes;
  readonly sha256: Sha256;
}): Promise<GiteaPkcePair> {
  const verifier = base64UrlEncode(input.randomBytes(new Uint8Array(GITEA_PKCE_VERIFIER_BYTES)));
  const digest = await input.sha256(asciiBytes(verifier));
  return { verifier, challenge: base64UrlEncode(digest), method: GITEA_PKCE_METHOD };
}

/** The verifier is base64url, so every character is one ASCII byte. */
function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  return bytes;
}

/** An opaque value of the same shape as the verifier — the `state`. */
export function createGiteaOAuthState(randomBytes: RandomBytes): string {
  return base64UrlEncode(randomBytes(new Uint8Array(16)));
}

export interface GiteaAuthorizationRequest {
  /** Where to send the browser, as a top-level navigation. */
  readonly url: string;
  /** Held in memory until the callback comes back, and matched against it. */
  readonly state: string;
  /** Held in memory until the exchange, and sent with it. Never stored. */
  readonly verifier: string;
}

/**
 * The `/login/oauth/authorize` navigation, with everything the exchange will
 * have to repeat.
 *
 * A top-level navigation and not a fetch: Gitea renders its own grant page
 * there, and a person who is not signed in to Gitea yet has to land on Gitea's
 * own sign-in — which is where the broker's *Sign in with Zerops* button is.
 */
export async function buildGiteaAuthorizationRequest(input: {
  readonly giteaOrigin: string;
  readonly clientId: string;
  readonly appOrigin: string;
  readonly randomBytes: RandomBytes;
  readonly sha256: Sha256;
}): Promise<GiteaAuthorizationRequest> {
  const pkce = await createGiteaPkcePair({ randomBytes: input.randomBytes, sha256: input.sha256 });
  const state = createGiteaOAuthState(input.randomBytes);
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: giteaOAuthRedirectUri(input.appOrigin),
    response_type: "code",
    state,
    code_challenge_method: pkce.method,
    code_challenge: pkce.challenge,
  });
  return {
    url: `${origin(input.giteaOrigin)}/login/oauth/authorize?${query.toString()}`,
    state,
    verifier: pkce.verifier,
  };
}

export type GiteaCallbackResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: string };

/**
 * What came back on `/gitea/callback`, checked against the state this session
 * sent.
 *
 * A mismatched state is not a recoverable error and gets no detail: it means
 * the response belongs to a request this browser did not make, which is the
 * one thing `state` exists to catch.
 */
export function readGiteaCallback(
  search: string,
  expectedState: string | undefined,
): GiteaCallbackResult {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const error = params.get("error");
  if (error !== null) {
    return { ok: false, reason: params.get("error_description") ?? error };
  }
  const state = params.get("state");
  if (expectedState === undefined || state === null || state !== expectedState) {
    return { ok: false, reason: "This sign-in did not start here." };
  }
  const code = params.get("code");
  if (code === null || code.length === 0) return { ok: false, reason: "Gitea sent no code." };
  return { ok: true, code };
}

/**
 * `POST /login/oauth/access_token`, as `application/x-www-form-urlencoded`.
 *
 * **No `client_secret`.** The application is registered
 * `confidential_client: false`, and the verifier is what proves the exchange
 * belongs to the browser that started the flow. Measured 2026-09-16: Gitea
 * answers this from a listed CORS origin with no secret at all.
 */
export function giteaTokenExchangeBody(input: {
  readonly clientId: string;
  readonly code: string;
  readonly verifier: string;
  readonly appOrigin: string;
}): string {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: giteaOAuthRedirectUri(input.appOrigin),
  }).toString();
}

/** The same endpoint, with the refresh token this session already holds. */
export function giteaRefreshBody(input: {
  readonly clientId: string;
  readonly refreshToken: string;
}): string {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  }).toString();
}

export interface GiteaTokenAnswer {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  /** Seconds, as Gitea states them. The caller turns it into a moment. */
  readonly expiresIn: number | undefined;
}

/** Gitea's token answer, or `null` when it does not carry a usable token. */
export function readGiteaTokenAnswer(body: unknown): GiteaTokenAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.length === 0) return null;
  return {
    accessToken: record.access_token,
    refreshToken: typeof record.refresh_token === "string" ? record.refresh_token : undefined,
    expiresIn: typeof record.expires_in === "number" ? record.expires_in : undefined,
  };
}

/** What `POST /user/applications/oauth2` is asked for. */
export function giteaOAuthApplicationBody(appOrigin: string): {
  readonly name: string;
  readonly redirect_uris: ReadonlyArray<string>;
  readonly confidential_client: boolean;
} {
  return {
    name: GITEA_OAUTH_APPLICATION_NAME,
    redirect_uris: [giteaOAuthRedirectUri(appOrigin)],
    confidential_client: false,
  };
}

/** As much of Gitea's application record as choosing one needs. */
export interface GiteaOAuthApplication {
  readonly id?: number;
  readonly name?: string | undefined;
  readonly client_id?: string | undefined;
  readonly redirect_uris?: ReadonlyArray<string> | undefined;
  readonly confidential_client?: boolean | undefined;
}

/**
 * An existing registration this origin may use, or `undefined`.
 *
 * Both halves matter. The name is how a second run finds what the first one
 * made; the redirect URI is what Gitea checks at the exchange, so a `Zerops
 * Mate` registered by the desktop app for `t3code://` is not a registration a
 * browser on `https://…` can use — and reusing it would fail at the very last
 * step of the flow, with a message about a redirect nobody typed.
 *
 * A confidential application is skipped too: it needs a secret this app does
 * not have and must not be given one.
 */
export function findGiteaOAuthApplication(
  applications: ReadonlyArray<GiteaOAuthApplication>,
  appOrigin: string,
): GiteaOAuthApplication | undefined {
  const redirect = giteaOAuthRedirectUri(appOrigin);
  return applications.find(
    (application) =>
      application.name === GITEA_OAUTH_APPLICATION_NAME &&
      application.confidential_client !== true &&
      typeof application.client_id === "string" &&
      application.client_id.length > 0 &&
      (application.redirect_uris ?? []).includes(redirect),
  );
}

function origin(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}
