import { readHashParams } from "./remote.ts";

const CONNECT_AUTH_STATE_PARAM = "state";
const CONNECT_AUTH_CHALLENGE_PARAM = "challenge";
const CONNECT_AUTH_PORT_PARAM = "port";
const CONNECT_AUTH_CODE_SEPARATOR = ".";
const CONNECT_LOOPBACK_CALLBACK_PATH = "/callback";

const CONNECT_AUTHORIZE_PATH = "/connect";
const CONNECT_CALLBACK_PATH = "/connect/callback";

/**
 * The CLI prints URLs against this origin and the web bundle uses it to
 * decide whether it is the hosted deployment — the two must agree, so the
 * default lives here.
 */
export const DEFAULT_HOSTED_APP_URL = "https://mate.zerops.io";

/**
 * Requested at authorize time by the hosted page and honored by the CLI's
 * token exchange; keep both sides on this single definition.
 */
export const CONNECT_OAUTH_SCOPES = ["openid", "profile", "email"] as const;

export interface ConnectAuthorizeRequest {
  readonly state: string;
  readonly challenge: string;
  /**
   * Present when a loopback CLI initiated the request: the hosted /connect
   * page then asks Clerk to redirect the authorization code straight to
   * `http://127.0.0.1:<port>/callback` instead of the hosted callback page.
   */
  readonly loopbackPort?: number;
}

/**
 * The URL the CLI prints for the user to open in a browser. `state` and
 * `code_challenge` ride the fragment so they never reach the hosted app's
 * server or CDN logs; neither is a secret.
 *
 * Both CLI flows route through the hosted /connect page rather than hitting
 * Clerk's /oauth/authorize directly: a signed-out browser sent straight to
 * /oauth/authorize goes through Clerk's sign-in redirect, which does not
 * reliably preserve the authorize query parameters (state, response_type,
 * code_challenge). The hosted page waits for a Clerk session first, then
 * forwards the request with the parameters intact.
 */
export function buildConnectAuthorizeRequestUrl(input: {
  readonly hostedAppUrl: string;
  readonly state: string;
  readonly challenge: string;
  readonly loopbackPort?: number;
}): string {
  const url = new URL(CONNECT_AUTHORIZE_PATH, input.hostedAppUrl);
  url.hash = new URLSearchParams([
    [CONNECT_AUTH_STATE_PARAM, input.state],
    [CONNECT_AUTH_CHALLENGE_PARAM, input.challenge],
    ...(input.loopbackPort === undefined
      ? []
      : [[CONNECT_AUTH_PORT_PARAM, String(input.loopbackPort)] as [string, string]]),
  ]).toString();
  return url.toString();
}

export function readConnectAuthorizeRequest(url: URL): ConnectAuthorizeRequest | null {
  const params = readHashParams(url);
  const state = params.get(CONNECT_AUTH_STATE_PARAM)?.trim() ?? "";
  const challenge = params.get(CONNECT_AUTH_CHALLENGE_PARAM)?.trim() ?? "";
  if (!state || !challenge) {
    return null;
  }
  const port = params.get(CONNECT_AUTH_PORT_PARAM);
  if (port === null) {
    return { state, challenge };
  }
  // A present-but-invalid port means the link was corrupted; reject the whole
  // request rather than silently downgrading a loopback flow to the
  // out-of-band one, which would strand the waiting CLI.
  const loopbackPort = parseLoopbackPort(port.trim());
  if (loopbackPort === null) {
    return null;
  }
  return { state, challenge, loopbackPort };
}

function parseLoopbackPort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Redirect URI for the CLI's local callback listener. Must stay in sync with
 * the redirect URI registered on the Clerk CLI OAuth application.
 */
export function connectLoopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CONNECT_LOOPBACK_CALLBACK_PATH}`;
}

export function connectCallbackUrl(hostedAppUrl: string): string {
  return new URL(CONNECT_CALLBACK_PATH, hostedAppUrl).toString();
}

export interface ConnectAuthCode {
  readonly code: string;
  readonly state: string;
}

/**
 * Validates an out-of-band authorization code against the state of the request this process
 * generated. Returns the parsed code or a user-facing error message; both
 * the prompt's live validation and the authoritative post-prompt check go
 * through here so they cannot drift.
 */
export function checkConnectAuthCode(
  blob: string,
  expectedState: string,
): ConnectAuthCode | string {
  const parsed = parseConnectAuthCode(blob);
  if (parsed === null) {
    return "That does not look like a T3 Connect code. Copy the full code.";
  }
  if (parsed.state !== expectedState) {
    return "That code belongs to a different connect request. Open the URL above and try again.";
  }
  return parsed;
}

function parseConnectAuthCode(blob: string): ConnectAuthCode | null {
  const trimmed = blob.trim();
  const separatorIndex = trimmed.lastIndexOf(CONNECT_AUTH_CODE_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }
  const code = trimmed.slice(0, separatorIndex);
  const state = trimmed.slice(separatorIndex + 1);
  return { code, state };
}
