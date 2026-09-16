/**
 * The person's Gitea session, held in memory for as long as the tab lives.
 *
 * Mate drives Gitea **as the person** (guide 4.4): the token it holds is theirs,
 * so Gitea enforces the rights the broker mirrored from Zerops and the app
 * cannot widen anybody's reach by asking nicely. The decisions — the PKCE pair,
 * the authorize URL, the exchange bodies, which registration to reuse — are
 * `client-runtime/zerops/giteaOAuth.ts`; this is the store and the two network
 * calls around it.
 *
 * ## Nothing is persisted
 *
 * The access token, the refresh token and the `client_id` live in module
 * memory, keyed by Gitea origin (the `client_id` also by app origin, because a
 * registration is bound to its redirect URI — an app served from a second
 * origin needs the broker to have registered that one too). A reload signs the person
 * in again, which is a second of a redirect they are already signed in for, and
 * is the price of not leaving a token that acts as them in a company forge
 * where every script on the origin can read it.
 *
 * The **pending request** — state and verifier — is the exception: the flow
 * leaves the page for Gitea and comes back, so it is kept in `sessionStorage`
 * for that round trip and taken out of it the moment the callback reads it.
 * Neither value is a credential on its own; the verifier is only useful to
 * whoever also holds the code, and the code only arrives here.
 */

import {
  buildGiteaAuthorizationRequest,
  createGiteaClient,
  GITEA_BROKER_OAUTH_CLIENT_PATH,
  GITEA_OAUTH_CLIENT_PENDING,
  giteaRefreshBody,
  giteaTokenExchangeBody,
  readGiteaBrokerOAuthClient,
  readGiteaCallback,
  readGiteaTokenAnswer,
  type GiteaClient,
} from "@t3tools/client-runtime/zerops";

const PENDING_KEY = "mate:gitea-oauth:v1";

interface GiteaTokens {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  /** Epoch milliseconds, or `undefined` when Gitea did not say. */
  readonly expiresAt: number | undefined;
}

/** In memory only. Never a storage key, never a log line, never a fixture. */
const tokens = new Map<string, GiteaTokens>();
const clientIds = new Map<string, string>();

function normalize(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function registrationKey(giteaOrigin: string, appOrigin: string): string {
  return `${normalize(giteaOrigin)}|${normalize(appOrigin)}`;
}

/** Whether this tab already holds a token for that Gitea. */
export function hasGiteaSession(giteaOrigin: string): boolean {
  return tokens.has(normalize(giteaOrigin));
}

/** Forgets everything about one Gitea — sign-out, or a token Gitea refused. */
export function forgetGiteaSession(giteaOrigin: string): void {
  tokens.delete(normalize(giteaOrigin));
}

/**
 * A client that acts as the person on that Gitea, or `null` when this tab has
 * not signed in to it yet.
 *
 * The token is read per call rather than captured, so a refresh reaches a
 * client somebody is already holding.
 */
export function giteaClientFor(giteaOrigin: string): GiteaClient | null {
  const origin = normalize(giteaOrigin);
  if (!tokens.has(origin)) return null;
  return createGiteaClient({
    origin,
    token: () => tokens.get(origin)?.accessToken ?? "",
    fetch: globalThis.fetch.bind(globalThis),
  });
}

export class GiteaSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GiteaSignInError";
  }
}

/**
 * The `client_id` for this (Gitea, app origin) pair, asked of the org's broker.
 *
 * The broker registered the application when it set the org's Gitea up, so
 * this call carries no auth and no cookie: a public client's id is not a
 * credential, and the alternative — the app creating its own registration with
 * the person's Gitea session — made an arbitrary colleague the owner of
 * everyone's sign-in. Before the broker's first pass it answers `503`, which
 * is a temporary state the person is told about rather than a failure.
 */
export async function ensureGiteaOAuthClientId(input: {
  readonly giteaOrigin: string;
  readonly brokerOrigin: string;
  readonly appOrigin: string;
}): Promise<string> {
  const key = registrationKey(input.giteaOrigin, input.appOrigin);
  const known = clientIds.get(key);
  if (known !== undefined) return known;

  const response = await fetch(
    `${normalize(input.brokerOrigin)}${GITEA_BROKER_OAUTH_CLIENT_PATH}`,
    { headers: { accept: "application/json" } },
  ).catch(() => null);
  if (response === null) {
    throw new GiteaSignInError("The broker did not answer, so Gitea sign-in cannot start.");
  }
  if (response.status === 503) throw new GiteaSignInError(GITEA_OAUTH_CLIENT_PENDING);
  if (!response.ok) {
    throw new GiteaSignInError("The broker would not say how Mate signs in to Gitea.");
  }
  const answer = readGiteaBrokerOAuthClient(
    await response.json().catch(() => null),
    input.appOrigin,
  );
  if (!answer.ok) throw new GiteaSignInError(answer.reason);
  clientIds.set(key, answer.client.clientId);
  return answer.client.clientId;
}

interface PendingRequest {
  readonly giteaOrigin: string;
  readonly clientId: string;
  readonly state: string;
  readonly verifier: string;
  /** Where to put the person back once they are signed in. */
  readonly returnTo: string;
}

function rememberPending(request: PendingRequest): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(request));
  } catch {
    /* Without storage the callback simply refuses and the person starts again. */
  }
}

function takePending(): PendingRequest | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return raw === null ? null : (JSON.parse(raw) as PendingRequest);
  } catch {
    return null;
  }
}

/**
 * Sends the browser to Gitea's own grant page, as a top-level navigation.
 *
 * A navigation and not a fetch: Gitea renders the grant itself, and a person
 * who is not signed in to Gitea lands on Gitea's sign-in — which is where the
 * broker's *Sign in with Zerops* button is.
 */
export async function startGiteaSignIn(input: {
  readonly giteaOrigin: string;
  readonly brokerOrigin: string;
  readonly returnTo: string;
}): Promise<void> {
  const appOrigin = window.location.origin;
  const clientId = await ensureGiteaOAuthClientId({
    giteaOrigin: input.giteaOrigin,
    brokerOrigin: input.brokerOrigin,
    appOrigin,
  });
  const request = await buildGiteaAuthorizationRequest({
    giteaOrigin: input.giteaOrigin,
    clientId,
    appOrigin,
    randomBytes: (into) => crypto.getRandomValues(into),
    sha256: async (data) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource)),
  });
  rememberPending({
    giteaOrigin: normalize(input.giteaOrigin),
    clientId,
    state: request.state,
    verifier: request.verifier,
    returnTo: input.returnTo,
  });
  window.location.assign(request.url);
}

export type GiteaCallbackOutcome =
  | { readonly ok: true; readonly returnTo: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Finishes the flow: matches the state, exchanges the code, keeps the token in
 * memory and says where the person was going.
 */
export async function completeGiteaSignIn(search: string): Promise<GiteaCallbackOutcome> {
  const pending = takePending();
  const result = readGiteaCallback(search, pending?.state);
  if (!result.ok) return { ok: false, reason: result.reason };
  if (pending === null) return { ok: false, reason: "This sign-in did not start here." };

  const answer = await exchange(
    pending.giteaOrigin,
    giteaTokenExchangeBody({
      clientId: pending.clientId,
      code: result.code,
      verifier: pending.verifier,
      appOrigin: window.location.origin,
    }),
  );
  if (answer === null) return { ok: false, reason: "Gitea would not exchange the sign-in." };
  tokens.set(pending.giteaOrigin, answer);
  clientIds.set(registrationKey(pending.giteaOrigin, window.location.origin), pending.clientId);
  return { ok: true, returnTo: pending.returnTo };
}

/**
 * Trades the refresh token for a new access token, in place.
 *
 * Answers whether the session survived: a refresh Gitea refuses means the
 * person signs in again, and a stale token left in the map would fail every
 * call afterwards with a `401` nobody could explain.
 */
export async function refreshGiteaSession(giteaOrigin: string): Promise<boolean> {
  const origin = normalize(giteaOrigin);
  const current = tokens.get(origin);
  const clientId = clientIds.get(registrationKey(origin, window.location.origin));
  if (current?.refreshToken === undefined || clientId === undefined) return false;
  const answer = await exchange(
    origin,
    giteaRefreshBody({ clientId, refreshToken: current.refreshToken }),
  );
  if (answer === null) {
    tokens.delete(origin);
    return false;
  }
  // Gitea may rotate the refresh token or keep it; the old one stays usable
  // only when it answers with none.
  tokens.set(origin, { ...answer, refreshToken: answer.refreshToken ?? current.refreshToken });
  return true;
}

async function exchange(giteaOrigin: string, body: string): Promise<GiteaTokens | null> {
  const response = await fetch(`${giteaOrigin}/login/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!response.ok) return null;
  const answer = readGiteaTokenAnswer(await response.json().catch(() => null));
  if (answer === null) return null;
  return {
    accessToken: answer.accessToken,
    refreshToken: answer.refreshToken,
    expiresAt: answer.expiresIn === undefined ? undefined : Date.now() + answer.expiresIn * 1000,
  };
}
