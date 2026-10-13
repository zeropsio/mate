/**
 * Device login: how this client signs in to Zerops, and how it asks for sudo mode.
 *
 * The client starts a request on the API (`POST /auth/device-login`, or `…/sudo` with the
 * session's bearer), sends the person to the request's consent page (the API's
 * `verificationUrl`: app.zerops.io's today, HQ's once the backend points it there), and polls
 * `…/check` until the person approves or denies there. An approved login answers a full session
 * (access token, refresh token, expiry), exactly a password login's; an approved sudo request
 * answers nothing, and the session that asked is now in sudo.
 *
 * Nothing is delivered to this client's origin, so a client served from any origin collects its
 * own session; the consent page is the only place credentials are typed.
 *
 * The poll secret proves the poller started the request. It lives in memory only, never in
 * storage or a URL: a reload during sign-in starts over, and a request is cheap and lasts five
 * minutes.
 *
 * Pure and platform-free: the fetch, the clock and the waiting belong to the client that calls
 * this (a tab, or the desktop main process).
 *
 * @module zerops/deviceLogin
 */
import type { ZeropsSession } from "./session.ts";

const AUTH_PREFIX = "/api/rest/public/auth";

/** A login signs a person in; a sudo request puts the session that asked into sudo mode. */
export type ZeropsDeviceLoginKind = "login" | "sudo";

/** The app's Sign up: a signed-out person lands on the consent page's sign-up, not its log-in. */
export type ZeropsDeviceLoginIntent = "register";

export interface ZeropsDeviceLoginRequest {
  readonly kind: ZeropsDeviceLoginKind;
  readonly requestId: string;
  readonly pollSecret: string;
  /** The code the consent page shows beside the request, for the person to compare. */
  readonly userCode: string;
  readonly verificationUrl: string;
  /** When the platform forgets the request, on the caller's clock. */
  readonly expiresAtMs: number;
  readonly intervalMs: number;
}

export type ZeropsDeviceLoginOutcome =
  /** `session` is the approved login's; a sudo approval carries none. */
  | { readonly kind: "approved"; readonly session: ZeropsSession | null }
  | { readonly kind: "denied" }
  | { readonly kind: "expired" }
  | { readonly kind: "cancelled" };

/** One `check`: settled, still pending, or worth asking again after an interval. */
export type ZeropsDeviceLoginCheck =
  | { readonly status: "pending" }
  | { readonly status: "retry" }
  | Exclude<ZeropsDeviceLoginOutcome, { readonly kind: "cancelled" }>;

/** The platform refused to start or check a request, with its words and code. */
export class ZeropsDeviceLoginRefused extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = "ZeropsDeviceLoginRefused";
    this.status = status;
    this.code = code;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_EXPIRES_IN_S = 300;
const DEFAULT_INTERVAL_S = 3;
/** Past the request's own expiry, one more check is still worth it: clocks differ. */
const EXPIRY_GRACE_MS = 10_000;

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

async function refusalOf(response: Response, fallback: string): Promise<ZeropsDeviceLoginRefused> {
  let body: Record<string, unknown> | null = null;
  try {
    body = asRecord(await response.json());
  } catch {
    // A status alone still says enough.
  }
  const error = asRecord(body?.["error"]) ?? body;
  const code = error === null ? null : stringField(error, "code");
  const message = error === null ? null : stringField(error, "message");
  return new ZeropsDeviceLoginRefused(message ?? fallback, response.status, code);
}

/**
 * Starts a request. A sudo request is the session's own, so it carries the session's bearer; a
 * login carries none.
 */
export async function startZeropsDeviceLogin(input: {
  readonly fetch: Fetch;
  readonly apiBase: string;
  readonly appCode: string;
  readonly kind: ZeropsDeviceLoginKind;
  readonly bearer?: string;
  readonly nowMs: number;
}): Promise<ZeropsDeviceLoginRequest> {
  const path = input.kind === "sudo" ? "/device-login/sudo" : "/device-login";
  const response = await input.fetch(`${input.apiBase.replace(/\/+$/u, "")}${AUTH_PREFIX}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(input.bearer === undefined ? {} : { Authorization: `Bearer ${input.bearer}` }),
    },
    body: JSON.stringify({ appCode: input.appCode }),
  });
  if (!response.ok) throw await refusalOf(response, "Zerops would not start the sign-in.");
  const body = asRecord(await response.json());
  const requestId = body === null ? null : stringField(body, "requestId");
  const pollSecret = body === null ? null : stringField(body, "pollSecret");
  const userCode = body === null ? null : stringField(body, "userCode");
  const verificationUrl = body === null ? null : stringField(body, "verificationUrl");
  if (requestId === null || pollSecret === null || userCode === null || verificationUrl === null) {
    throw new ZeropsDeviceLoginRefused(
      "Zerops answered the sign-in with nothing to open.",
      200,
      null,
    );
  }
  return {
    kind: input.kind,
    requestId,
    pollSecret,
    userCode,
    verificationUrl,
    expiresAtMs: input.nowMs + positiveNumber(body?.["expiresIn"], DEFAULT_EXPIRES_IN_S) * 1000,
    intervalMs: Math.max(1, positiveNumber(body?.["interval"], DEFAULT_INTERVAL_S)) * 1000,
  };
}

/** The session an approved login answers: `{auth: Auth, user}`, the platform's login shape. */
function approvedSession(auth: unknown): ZeropsSession | null {
  const record = asRecord(asRecord(auth)?.["auth"]);
  if (record === null) return null;
  const accessToken = stringField(record, "accessToken");
  if (accessToken === null) return null;
  const refreshToken = stringField(record, "refreshToken");
  const expiresAt = stringField(record, "expiresAt");
  const userId = stringField(record, "userId");
  const tokenType = stringField(record, "tokenType");
  const expiresIn = record["expiresIn"];
  const twoFAMethods = record["twoFAMethods"];
  return {
    accessToken,
    ...(refreshToken === null ? {} : { refreshToken }),
    ...(expiresAt === null ? {} : { expiresAt }),
    ...(typeof expiresIn === "number" ? { expiresIn } : {}),
    ...(userId === null ? {} : { userId }),
    ...(tokenType === null ? {} : { tokenType }),
    ...(Array.isArray(twoFAMethods)
      ? { twoFAMethods: twoFAMethods.filter((method) => typeof method === "string") }
      : {}),
    ...(typeof record["twoFAVerified"] === "boolean"
      ? { twoFAVerified: record["twoFAVerified"] }
      : {}),
  };
}

/**
 * Asks once. A request the platform no longer knows (404) has expired: it lives five minutes and
 * works once. A throttled or failing platform, or a lost connection, is asked again later.
 */
export async function checkZeropsDeviceLogin(input: {
  readonly fetch: Fetch;
  readonly apiBase: string;
  readonly request: ZeropsDeviceLoginRequest;
}): Promise<ZeropsDeviceLoginCheck> {
  let response: Response;
  try {
    response = await input.fetch(
      `${input.apiBase.replace(/\/+$/u, "")}${AUTH_PREFIX}/device-login/check`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: input.request.requestId,
          pollSecret: input.request.pollSecret,
        }),
      },
    );
  } catch {
    return { status: "retry" };
  }
  if (response.status === 404 || response.status === 410) return { kind: "expired" } as const;
  if (response.status === 429 || response.status >= 500) return { status: "retry" };
  if (!response.ok) throw await refusalOf(response, "Zerops would not finish the sign-in.");
  const body = asRecord(await response.json());
  switch (body?.["status"]) {
    case "PENDING":
      return { status: "pending" };
    case "DENIED":
      return { kind: "denied" };
    case "APPROVED": {
      if (input.request.kind === "sudo") return { kind: "approved", session: null };
      const session = approvedSession(body["auth"]);
      if (session === null) {
        throw new ZeropsDeviceLoginRefused(
          "Zerops approved the sign-in without a session.",
          200,
          null,
        );
      }
      return { kind: "approved", session };
    }
    default:
      return { status: "retry" };
  }
}

/**
 * Polls until the request settles: every interval, and at once whenever `wait` returns early
 * (the tab became visible again, or its window regained focus). It ends at the request's expiry
 * plus a grace, on a 404, or when `signal` aborts.
 */
export async function pollZeropsDeviceLogin(input: {
  readonly request: ZeropsDeviceLoginRequest;
  readonly check: () => Promise<ZeropsDeviceLoginCheck>;
  /** Resolves after `ms`, or earlier when it is worth asking now; resolves at once on abort. */
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly nowMs: () => number;
  readonly signal: AbortSignal;
}): Promise<ZeropsDeviceLoginOutcome> {
  const { request, signal } = input;
  while (!signal.aborted) {
    if (input.nowMs() > request.expiresAtMs + EXPIRY_GRACE_MS) return { kind: "expired" };
    await input.wait(request.intervalMs, signal);
    if (signal.aborted) break;
    const answer = await input.check();
    if (signal.aborted) break;
    if ("kind" in answer) return answer;
  }
  return { kind: "cancelled" };
}

function isWebUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

/**
 * The consent link: the API's `verificationUrl` as it comes, plus this client's parameters. The
 * only place it is built.
 *
 * - `consentOrigin` swaps the page's origin (a local HQ).
 * - `intent: "register"` sends a signed-out person to sign-up.
 * - `popup` asks the page to close its window once decided.
 *
 * Only an http(s) link is opened: the window it goes to starts as this client's own
 * `about:blank`, where any other scheme would run in this origin.
 */
export function zeropsDeviceLoginUrl(input: {
  readonly verificationUrl: string;
  readonly consentOrigin?: string;
  readonly intent?: ZeropsDeviceLoginIntent;
  readonly popup?: boolean;
}): string {
  const given = new URL(input.verificationUrl);
  if (!isWebUrl(given)) throw new Error("The Zerops consent link is not a web address.");
  const url =
    input.consentOrigin === undefined
      ? given
      : new URL(`${given.pathname}${given.search}${given.hash}`, input.consentOrigin);
  if (!isWebUrl(url) || (input.consentOrigin !== undefined && url.origin !== input.consentOrigin)) {
    throw new Error("The Zerops consent origin is not a web origin.");
  }
  if (input.intent !== undefined) url.searchParams.set("intent", input.intent);
  if (input.popup === true) url.searchParams.set("display", "popup");
  return url.toString();
}
