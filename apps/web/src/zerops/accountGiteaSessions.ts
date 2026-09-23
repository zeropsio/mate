/**
 * The account's Gitea sessions in this tab: one `GiteaSessions` per account epoch
 * (`@t3tools/client-runtime/zerops/forge`, DESIGN §4.6), made when the account opens and closed
 * when it closes (`accountLifetime.ts`). A second person on this tab never reads Gitea with the
 * first person's token, and an answer that belonged to the first lands nowhere.
 *
 * Signed in to Mate is signed in to Gitea (D21): `useGiteaSession` wants the account's Gitea
 * signed in for as long as the surface that calls it is mounted — the flow provider, for the
 * whole account — and every other reader takes a client from {@link giteaClientFor}.
 *
 * This module is the sessions' browser half: fetch, the clocks, timers and the tab's visibility.
 * It registers with the account lifetime when it loads, which is before any account opens: the
 * app imports it statically through `ZeropsProjectFlowProvider`. It listens to the document and
 * the window only while an account is open.
 */
import type { ZeropsThrowawayPlatform } from "@t3tools/client-runtime/authorization";
import type { GiteaClient } from "@t3tools/client-runtime/zerops";
import {
  GITEA_SIGNED_OUT,
  makeGiteaSessions,
  type GiteaSessions,
  type GiteaSessionsPorts,
  type GiteaSessionView,
} from "@t3tools/client-runtime/zerops/forge";
import { useEffect, useSyncExternalStore } from "react";

import { randomUUID } from "../lib/utils";
import { onAccountLifetimeClose, onAccountLifetimeOpen } from "./accountLifetime";

/** A tab hidden at least this long wakes its waits when it is shown again (DESIGN §6.4). */
const VISIBLE_WAKE_AFTER_HIDDEN_MS = 30_000;

const tabVisible = (): boolean =>
  typeof document === "undefined" || document.visibilityState === "visible";

const browserPorts: GiteaSessionsPorts = {
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => ({ wall: Date.now(), mono: performance.now() }),
  visible: tabVisible,
  random: Math.random,
  nonce: randomUUID,
  setTimer: (delayMs, fire) => {
    const timer = setTimeout(fire, delayMs);
    return () => clearTimeout(timer);
  },
};

let current: GiteaSessions | null = null;
let unbindTabSignals: (() => void) | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/**
 * Tells the sessions when the tab is shown again and when it comes back online (DESIGN §6.4),
 * until the returned unbind.
 */
function bindTabSignals(sessions: GiteaSessions): () => void {
  if (typeof document === "undefined") return () => undefined;
  let hiddenSinceMs: number | null = null;
  const onVisibility = () => {
    if (!tabVisible()) {
      hiddenSinceMs = performance.now();
      return;
    }
    const hiddenForMs = hiddenSinceMs === null ? 0 : performance.now() - hiddenSinceMs;
    hiddenSinceMs = null;
    if (hiddenForMs >= VISIBLE_WAKE_AFTER_HIDDEN_MS) sessions.wake();
    else sessions.resume();
  };
  const onOnline = () => sessions.online();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  };
}

onAccountLifetimeOpen(() => {
  current = makeGiteaSessions(browserPorts);
  current.subscribe(changed);
  unbindTabSignals = bindTabSignals(current);
  changed();
});

onAccountLifetimeClose(() => {
  const closing = current;
  current = null;
  unbindTabSignals?.();
  unbindTabSignals = null;
  closing?.close();
  changed();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open account's Gitea sessions, or `null` while no account is open. */
export function accountGiteaSessions(): GiteaSessions | null {
  return current;
}

function useGiteaView(giteaOrigin: string | undefined): GiteaSessionView {
  return useSyncExternalStore(
    subscribe,
    () =>
      current === null || giteaOrigin === undefined ? GITEA_SIGNED_OUT : current.view(giteaOrigin),
    () => GITEA_SIGNED_OUT,
  );
}

/**
 * Wants the account's Gitea signed in while the calling surface is mounted, and says how that
 * stands: `signedIn` says what was read still stands — through a 401's reacquire and every failed
 * try after a token was held, until a refusal — `readable` says a request can go out now, and
 * `trouble` names a refusal at once and a Gitea or broker that does not answer after two failed
 * tries, beside what stands.
 */
export function useGiteaSession(input: {
  readonly giteaOrigin: string | undefined;
  readonly brokerOrigin: string | undefined;
  /** The org that owns the Gitea — where the throwaway is minted. */
  readonly clientId: string | undefined;
  readonly platform: ZeropsThrowawayPlatform | undefined;
}): { readonly signedIn: boolean; readonly readable: boolean; readonly trouble: string | null } {
  const { brokerOrigin, clientId, giteaOrigin, platform } = input;
  const sessions = useSyncExternalStore(subscribe, accountGiteaSessions, () => null);
  const view = useGiteaView(giteaOrigin);

  useEffect(() => {
    if (
      sessions === null ||
      giteaOrigin === undefined ||
      brokerOrigin === undefined ||
      clientId === undefined ||
      platform === undefined
    ) {
      return;
    }
    return sessions.demand({ giteaOrigin, brokerOrigin, clientId, platform });
  }, [sessions, giteaOrigin, brokerOrigin, clientId, platform]);

  return { signedIn: view.signedIn, readable: view.readable, trouble: view.trouble };
}

/**
 * Whether a request can go out to that Gitea as the person now. A reader that reads once keys
 * its read on it, so it reads again when a token comes back.
 */
export function useGiteaReadable(giteaOrigin: string | undefined): boolean {
  return useGiteaView(giteaOrigin).readable;
}

/**
 * A client that acts as the person on that Gitea, or `null` while the account holds no session
 * there. Each request carries the token held when it is sent; `onUnauthorized` is told when one
 * ends in Gitea's 401 that no token recovered.
 */
export function giteaClientFor(
  giteaOrigin: string,
  onUnauthorized?: () => void,
): GiteaClient | null {
  return current?.clientFor(giteaOrigin, onUnauthorized) ?? null;
}

/** The person's login on that Gitea, `u-…`, while signed in. */
export function giteaSessionLogin(giteaOrigin: string): string | undefined {
  return current?.view(giteaOrigin).login;
}
