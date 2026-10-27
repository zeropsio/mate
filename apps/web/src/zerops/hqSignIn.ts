/**
 * Signing in from HQ's Mate card with no click: one trip of this tab through HQ's consent page.
 *
 * HQ's card opens this client at `?signin=hq` and leaves a one-time note in this tab's storage on
 * its own origin. A tab with no session starts a device login (`deviceLogin.ts`), keeps the
 * request, and goes to the consent page in the same tab, asking HQ to send it back to
 * `?signin=hq-return`. HQ approves a fresh request its note vouches for without showing its card,
 * shows the card where it cannot (one click), and sends the tab back after either answer. Back
 * here, the tab collects the request's session as the window sign-in does.
 *
 * **Why this tab's `sessionStorage`.** The tab itself leaves, so the request outlives the page that
 * started it: two loads on this origin and nothing more. It never goes into an address or
 * `localStorage`. The next load of this tab takes it out, whatever that load does with it, and one
 * past five minutes is no longer the platform's.
 *
 * **Why the same tab.** HQ's note is this tab's: a new window has none and always gets the card.
 *
 * The `signin` parameter leaves the address as the page loads, before the router reads it, in
 * every case: a tab already signed in only loses it. Without it, nothing here runs.
 */
import { browserTransportFetch } from "@t3tools/client-runtime/data";
import type { ZeropsSession } from "@t3tools/client-runtime/zerops";
import {
  checkZeropsDeviceLogin,
  pollZeropsDeviceLogin,
  startZeropsDeviceLogin,
  zeropsDeviceLoginUrl,
  type ZeropsDeviceLoginOutcome,
} from "@t3tools/client-runtime/zerops/deviceLogin";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useSyncExternalStore } from "react";

import { appBasePathHref } from "../basePath";
import { browserWait, zeropsConsentOrigin, zeropsLoginAppCode } from "./deviceLogin";

export const ZEROPS_HQ_SIGN_IN_KEY = "zerops-mate.hq-sign-in.v1";

const SIGN_IN_PARAM = "signin";

/** How long the platform keeps a request; past it, a kept one has nothing left to collect. */
const REQUEST_LIFETIME_MS = 5 * 60_000;

/** The request a trip through HQ started, kept in this tab while the tab is away. */
export interface ZeropsHqSignInEntry {
  readonly requestId: string;
  readonly pollSecret: string;
  /** When it started, on the wall clock: it outlives the page that started it. */
  readonly startedAt: number;
  readonly intervalMs: number;
}

/** What this load does about HQ, read as it loads. */
export type ZeropsHqSignInStep =
  /** HQ's card opened this tab: with no session, it leaves for HQ. */
  | { readonly kind: "start" }
  /** HQ answered and sent the tab back: its request, unless this tab no longer holds it in time. */
  | { readonly kind: "return"; readonly entry: ZeropsHqSignInEntry | "expired" | "missing" }
  /** The tab came back another way (Back) while it held a request: HQ's answer is asked once. */
  | { readonly kind: "resume"; readonly entry: ZeropsHqSignInEntry };

/** A tab's `sessionStorage`: where site data is blocked, every access throws. */
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ZeropsHqSignInPorts {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly apiBase: string;
  readonly appCode: string;
  /** The build's consent origin (HQ's) over the API's link, as the window sign-in swaps it. */
  readonly consentOrigin: string | undefined;
  /** Where HQ sends this tab once it answered. */
  readonly returnUrl: string;
  readonly storage: TabStorage | null;
  /** Sends this tab to `url`. */
  readonly assign: (url: string) => void;
  /** The wall clock: a kept request outlives the page that started it. */
  readonly nowMs: () => number;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
}

function parseEntry(raw: string | null): ZeropsHqSignInEntry | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { requestId, pollSecret, startedAt, intervalMs } = value as Record<string, unknown>;
    return typeof requestId === "string" &&
      typeof pollSecret === "string" &&
      typeof startedAt === "number" &&
      typeof intervalMs === "number"
      ? { requestId, pollSecret, startedAt, intervalMs }
      : null;
  } catch {
    return null;
  }
}

/** Takes this tab's kept request out of its storage: it is read once, by the next load. */
function takeEntry(
  storage: TabStorage | null,
  nowMs: number,
): ZeropsHqSignInEntry | "expired" | "missing" {
  let raw: string | null;
  try {
    raw = storage?.getItem(ZEROPS_HQ_SIGN_IN_KEY) ?? null;
    if (raw !== null) storage?.removeItem(ZEROPS_HQ_SIGN_IN_KEY);
  } catch {
    return "missing";
  }
  const entry = parseEntry(raw);
  if (entry === null) return "missing";
  return nowMs - entry.startedAt > REQUEST_LIFETIME_MS ? "expired" : entry;
}

/**
 * What a load does about HQ, read from its address and this tab's storage, and its address
 * without `signin` (`null` where it had none). The kept request is taken out whatever comes next.
 */
export function readZeropsHqSignInStep(input: {
  readonly href: string;
  readonly storage: TabStorage | null;
  readonly nowMs: number;
}): { readonly step: ZeropsHqSignInStep | null; readonly href: string | null } {
  const url = new URL(input.href);
  const signIn = url.searchParams.get(SIGN_IN_PARAM);
  const kept = takeEntry(input.storage, input.nowMs);
  const step: ZeropsHqSignInStep | null =
    signIn === "hq"
      ? { kind: "start" }
      : signIn === "hq-return"
        ? { kind: "return", entry: kept }
        : typeof kept === "object"
          ? { kind: "resume", entry: kept }
          : null;
  if (signIn === null) return { step, href: null };
  url.searchParams.delete(SIGN_IN_PARAM);
  return { step, href: `${url.pathname}${url.search}${url.hash}` };
}

/**
 * Starts the login, keeps it in this tab and sends the tab to the consent page, `back` naming the
 * way home. Started as the tab leaves, not earlier: HQ's note vouches only for a fresh request.
 * Where this tab can keep nothing, it stays: its landing's own sign-in still works.
 */
export async function startZeropsHqSignIn(
  ports: ZeropsHqSignInPorts,
): Promise<{ readonly kind: "left" | "kept-nothing" }> {
  if (ports.storage === null) return { kind: "kept-nothing" };
  const startedAt = ports.nowMs();
  const request = await startZeropsDeviceLogin({
    fetch: ports.fetch,
    apiBase: ports.apiBase,
    appCode: ports.appCode,
    kind: "login",
    nowMs: startedAt,
  });
  const entry: ZeropsHqSignInEntry = {
    requestId: request.requestId,
    pollSecret: request.pollSecret,
    startedAt,
    intervalMs: request.intervalMs,
  };
  try {
    ports.storage.setItem(ZEROPS_HQ_SIGN_IN_KEY, JSON.stringify(entry));
  } catch {
    return { kind: "kept-nothing" };
  }
  ports.assign(
    zeropsDeviceLoginUrl({
      verificationUrl: request.verificationUrl,
      ...(ports.consentOrigin === undefined ? {} : { consentOrigin: ports.consentOrigin }),
      back: ports.returnUrl,
    }),
  );
  return { kind: "left" };
}

/**
 * Collects HQ's answer to a kept request: asked at once, since HQ answered before it sent the tab
 * back, then every interval until it settles or the request's five minutes pass. `once` asks a
 * single time, for a tab that came back without HQ's answer: still pending, it is `cancelled`.
 */
export async function finishZeropsHqSignIn(input: {
  readonly entry: ZeropsHqSignInEntry;
  readonly ports: ZeropsHqSignInPorts;
  readonly once: boolean;
  readonly signal: AbortSignal;
}): Promise<ZeropsDeviceLoginOutcome> {
  const { entry, ports } = input;
  const request = {
    kind: "login" as const,
    requestId: entry.requestId,
    pollSecret: entry.pollSecret,
    expiresAtMs: entry.startedAt + REQUEST_LIFETIME_MS,
    intervalMs: entry.intervalMs,
  };
  const check = () =>
    checkZeropsDeviceLogin({ fetch: ports.fetch, apiBase: ports.apiBase, request });
  const first = await check();
  if ("kind" in first) return first;
  if (input.once || input.signal.aborted) return { kind: "cancelled" };
  return pollZeropsDeviceLogin({
    request,
    check,
    wait: ports.wait,
    nowMs: ports.nowMs,
    signal: input.signal,
  });
}

// ---- This page's trip ----

/** What the landing shows of the trip: nothing, the wait while it runs, or why it ended. */
export type ZeropsHqSignInState =
  | { readonly kind: "idle" }
  /** On its way to HQ, or collecting HQ's answer: the landing waits in place of its sign-in. */
  | { readonly kind: "running" }
  /** The trip ended without a session: the landing says why, with Try again. */
  | { readonly kind: "failed"; readonly message: string };

/** The session a trip signs in to. */
export interface ZeropsHqSignInSession {
  readonly apiBase: string;
  /** Proves and keeps an approved session (`adoptDeviceLogin`). */
  readonly adopt: (session: ZeropsSession) => Promise<void>;
}

const IDLE: ZeropsHqSignInState = { kind: "idle" };
const RUNNING: ZeropsHqSignInState = { kind: "running" };

const ENDED: Record<"expired" | "missing", string> = {
  expired: "The sign-in through HQ timed out.",
  missing: "The sign-in came back to a tab that didn't start it.",
};

let step: ZeropsHqSignInStep | null = null;
let state: ZeropsHqSignInState = IDLE;
let running: AbortController | null = null;
const listeners = new Set<() => void>();

function show(next: ZeropsHqSignInState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function tabStorage(): TabStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** A page Back restored as it left, from the back/forward cache: a reload reads its step again. */
function reloadIfRestored(event: PageTransitionEvent): void {
  if (event.persisted) window.location.reload();
}

function browserPorts(apiBase: string): ZeropsHqSignInPorts {
  return {
    fetch: browserTransportFetch,
    apiBase,
    appCode: zeropsLoginAppCode(),
    consentOrigin: zeropsConsentOrigin(),
    returnUrl: `${window.location.origin}${appBasePathHref()}?${SIGN_IN_PARAM}=hq-return`,
    storage: tabStorage(),
    assign: (url) => {
      window.addEventListener("pageshow", reloadIfRestored, { once: true });
      window.location.assign(url);
    },
    nowMs: Date.now,
    wait: browserWait,
  };
}

/**
 * Reads this load's step and takes `signin` out of the address and its history entry. Called once,
 * before the router reads the address (`main.tsx`).
 */
export function captureZeropsHqSignIn(): void {
  const read = readZeropsHqSignInStep({
    href: window.location.href,
    storage: tabStorage(),
    nowMs: Date.now(),
  });
  if (read.href !== null) window.history.replaceState(window.history.state, "", read.href);
  step = read.step;
  // The landing waits from its first frame on, rather than showing a sign-in it is about to leave.
  show(step === null ? IDLE : RUNNING);
}

async function runStep(
  taken: ZeropsHqSignInStep,
  session: ZeropsHqSignInSession,
  signal: AbortSignal,
): Promise<ZeropsHqSignInState | "left"> {
  const ports = browserPorts(session.apiBase);
  try {
    if (taken.kind === "start") {
      return (await startZeropsHqSignIn(ports)).kind === "left" ? "left" : IDLE;
    }
    if (typeof taken.entry === "string") return { kind: "failed", message: ENDED[taken.entry] };
    const outcome = await finishZeropsHqSignIn({
      entry: taken.entry,
      ports,
      once: taken.kind === "resume",
      signal,
    });
    if (signal.aborted) return IDLE;
    if (outcome.kind === "approved" && outcome.session !== null) {
      await session.adopt(outcome.session);
      return IDLE;
    }
    // A denial is the person's own answer: the landing as it was. So is a tab back without one.
    return outcome.kind === "expired" && taken.kind === "return"
      ? { kind: "failed", message: ENDED.expired }
      : IDLE;
  } catch (cause) {
    return taken.kind === "resume" ? IDLE : { kind: "failed", message: zeropsErrorMessage(cause) };
  }
}

function run(taken: ZeropsHqSignInStep, session: ZeropsHqSignInSession): void {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  show(RUNNING);
  void runStep(taken, session, controller.signal).then((end) => {
    if (running !== controller) return;
    running = null;
    // Leaving for HQ, the wait stands until the page goes.
    if (end !== "left") show(end);
  });
}

/**
 * Settles this load's step once the session check does: signed out (`session` given), it runs;
 * any other way it is spent unrun, and a trip still collecting stops, the person signed in already.
 */
export function driveZeropsHqSignIn(session: ZeropsHqSignInSession | null): void {
  const taken = step;
  step = null;
  if (session === null) {
    running?.abort();
    running = null;
    show(IDLE);
    return;
  }
  if (taken !== null) run(taken, session);
}

/** Try again after a failed trip: a new one, through HQ again. */
export function retryZeropsHqSignIn(session: ZeropsHqSignInSession): void {
  run({ kind: "start" }, session);
}

/** Back to the landing from a failed trip. */
export function dismissZeropsHqSignIn(): void {
  show(IDLE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(): ZeropsHqSignInState {
  return state;
}

/** The trip as the landing shows it. */
export function useZeropsHqSignIn(): ZeropsHqSignInState {
  return useSyncExternalStore(subscribe, current, current);
}
