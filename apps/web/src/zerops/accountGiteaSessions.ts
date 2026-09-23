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
 * This module is the sessions' browser half: fetch, the clocks and timers. It registers with the
 * account lifetime when it loads, which is before any account opens: the app imports it statically
 * through `ZeropsProjectFlowProvider`. The tab reaches the sessions through the account's
 * PlatformSignals port, which the data provider binds before anything can demand a session.
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
import type { PlatformSignal, PlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { useEffect, useSyncExternalStore } from "react";

import { randomUUID } from "../lib/utils";
import { onAccountLifetimeClose, onAccountLifetimeOpen } from "./accountLifetime";

/** The account's tab signals, once the data provider bound them. */
let tabSignals: PlatformSignals | null = null;

const browserPorts: GiteaSessionsPorts = {
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => ({ wall: Date.now(), mono: performance.now() }),
  visible: () => tabSignals !== null && !tabSignals.hidden(),
  random: Math.random,
  nonce: randomUUID,
  setTimer: (delayMs, fire) => {
    const timer = setTimeout(fire, delayMs);
    return () => clearTimeout(timer);
  },
};

let current: GiteaSessions | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** What the sessions hear of the tab (DESIGN §6.4). */
function hear(signal: PlatformSignal): void {
  if (current === null) return;
  switch (signal.type) {
    case "visibility":
      // Shown again: what came due while hidden runs now; a visible wake says more on its own.
      if (!signal.hidden) current.resume();
      return;
    case "network":
      if (signal.online) current.online();
      return;
    case "wake":
      // A hidden wake only evaluates expiry; a visible one tries every wait again now.
      if (signal.visible) current.wake();
      else current.resume();
  }
}

/** The account's tab reaches its Gitea sessions through `signals`, until the returned unbind. */
export function bindGiteaSessionsSignals(signals: PlatformSignals): () => void {
  tabSignals = signals;
  const unlisten = signals.listen(hear);
  return () => {
    unlisten();
    if (tabSignals === signals) tabSignals = null;
  };
}

onAccountLifetimeOpen(() => {
  current = makeGiteaSessions(browserPorts);
  current.subscribe(changed);
  changed();
});

onAccountLifetimeClose(() => {
  const closing = current;
  current = null;
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
