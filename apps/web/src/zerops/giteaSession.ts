/**
 * The person's Gitea session, held in memory for as long as the tab lives.
 *
 * Mate drives Gitea **as the person** (guide 4.4): the token it holds is theirs,
 * so Gitea enforces the rights the broker mirrored from Zerops and the app
 * cannot widen anybody's reach by asking nicely. Where the token comes from is
 * the org's broker, on the same proof the app makes at a Mate's door (D21): a
 * throwaway Zerops token with no rights, minted as the person and deleted
 * after the one call, names them; the broker — Gitea's site admin — makes sure
 * their account exists and mints a token that acts as them. No Gitea screen,
 * no button: a person who signed in to Mate is signed in to Gitea.
 *
 * ## Nothing is persisted
 *
 * The token lives in module memory, keyed by Gitea origin. A reload acquires
 * another, which is one round trip nobody sees, and is the price of not
 * leaving a token that acts as the person in a company forge where every
 * script on the origin could read it. The broker retires every app token by
 * age; the first `401` Gitea answers forgets the session here, and the surface
 * acquires again.
 *
 * ## One acquisition at a time
 *
 * Several surfaces may want the same Gitea in the same tick — the Git tab, a
 * dialog — and a throwaway costs two platform calls, so one acquisition per
 * origin is in flight at most and everybody awaits it.
 */

import { useSyncExternalStore } from "react";

import {
  acquireGiteaPersonToken,
  MateCredentialError,
  type ZeropsThrowawayPlatform,
} from "@t3tools/client-runtime/authorization";
import { createGiteaClient, type GiteaClient } from "@t3tools/client-runtime/zerops";

import { randomUUID } from "../lib/utils";

interface GiteaSession {
  readonly accessToken: string;
  /** The person's login on that Gitea, `u-…`. */
  readonly login: string;
}

/** In memory only. Never a storage key, never a log line, never a fixture. */
const sessions = new Map<string, GiteaSession>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function normalize(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Whether this tab already holds a token for that Gitea. */
export function hasGiteaSession(giteaOrigin: string): boolean {
  return sessions.has(normalize(giteaOrigin));
}

/** The person's login on that Gitea, once signed in. */
export function giteaSessionLogin(giteaOrigin: string): string | undefined {
  return sessions.get(normalize(giteaOrigin))?.login;
}

/** Forgets everything about one Gitea — a token Gitea refused, or a sign-out. */
export function forgetGiteaSession(giteaOrigin: string): void {
  if (sessions.delete(normalize(giteaOrigin))) changed();
}

/** Tells the listener whenever a session appears or goes. */
export function subscribeGiteaSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the tab holds a session for that Gitea, as React state. */
export function useGiteaSignedIn(giteaOrigin: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeGiteaSessions,
    () => giteaOrigin !== undefined && hasGiteaSession(giteaOrigin),
    () => false,
  );
}

/**
 * A client that acts as the person on that Gitea, or `null` when this tab has
 * not signed in to it yet.
 *
 * The token is read per call rather than captured, so a session acquired
 * again reaches a client somebody is already holding. A `401` is Gitea saying
 * the token is gone — retired by the broker, or revoked — so the session is
 * forgotten on the spot and the surface that owns the tab acquires another.
 */
export function giteaClientFor(giteaOrigin: string): GiteaClient | null {
  const origin = normalize(giteaOrigin);
  if (!sessions.has(origin)) return null;
  const fetchAsPerson: typeof globalThis.fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init);
    if (response.status === 401 && sessions.has(origin)) {
      sessions.delete(origin);
      changed();
    }
    return response;
  };
  return createGiteaClient({
    origin,
    token: () => sessions.get(origin)?.accessToken ?? "",
    fetch: fetchAsPerson,
  });
}

export class GiteaSignInError extends Error {
  /**
   * The broker or Gitea is not there yet — the account's Gitea is still
   * setting up. Worth asking again in a while, not worth a red line.
   */
  readonly pending: boolean;

  constructor(message: string, pending = false) {
    super(message);
    this.name = "GiteaSignInError";
    this.pending = pending;
  }
}

/** The words for what the broker answered, in the person's terms. */
export function giteaSignInMessage(cause: unknown): GiteaSignInError {
  if (cause instanceof GiteaSignInError) return cause;
  if (cause instanceof MateCredentialError) {
    if (cause.status === 502 || cause.status === 503) {
      return new GiteaSignInError("Gitea is still setting up.", true);
    }
    if (cause.status === 403) {
      return new GiteaSignInError("You are not a member of this organization's Gitea.");
    }
    if (cause.status === 401) {
      return new GiteaSignInError("Zerops did not accept the sign-in. Sign in to Mate again.");
    }
    return new GiteaSignInError(cause.message);
  }
  if (cause instanceof TypeError) {
    // fetch's own failure: the broker did not answer at all.
    return new GiteaSignInError("Gitea is still setting up.", true);
  }
  return new GiteaSignInError(
    cause instanceof Error ? cause.message : "Gitea sign-in did not go through.",
  );
}

export interface EnsureGiteaSessionInput {
  readonly giteaOrigin: string;
  readonly brokerOrigin: string;
  /** The org that owns the Gitea — where the throwaway is minted. */
  readonly clientId: string;
  readonly platform: ZeropsThrowawayPlatform;
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Makes sure this tab holds a session for that Gitea, acquiring one from the
 * broker when it does not. Resolves once a session is there; rejects with a
 * `GiteaSignInError` that says whether it is worth trying again later.
 */
export function ensureGiteaSession(input: EnsureGiteaSessionInput): Promise<void> {
  const origin = normalize(input.giteaOrigin);
  if (sessions.has(origin)) return Promise.resolve();
  const running = inflight.get(origin);
  if (running !== undefined) return running;

  const acquisition = acquireGiteaPersonToken({
    brokerUrl: input.brokerOrigin,
    giteaUrl: origin,
    clientId: input.clientId,
    nonce: randomUUID(),
    platform: input.platform,
    fetch: input.fetch ?? globalThis.fetch.bind(globalThis),
  })
    .then((answer) => {
      sessions.set(origin, { accessToken: answer.token, login: answer.login });
      changed();
    })
    .catch((cause: unknown) => {
      throw giteaSignInMessage(cause);
    })
    .finally(() => {
      inflight.delete(origin);
    });
  inflight.set(origin, acquisition);
  return acquisition;
}
