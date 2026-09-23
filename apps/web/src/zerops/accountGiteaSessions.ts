/**
 * The web's binding to the account's Gitea sessions in this tab: one `GiteaSessions` per account
 * epoch (`@t3tools/client-runtime/zerops/forge`, DESIGN §4.6), which the account runtime's
 * post-grant stage builds on the epoch's first grant and ends when the account closes. A second
 * person on this tab never reads Gitea with the first person's token, and an answer that belonged
 * to the first lands nowhere.
 *
 * Signed in to Mate is signed in to Gitea (D21): `useGiteaSession` wants the account's Gitea
 * signed in for as long as the surface that calls it is mounted — the flow provider, for the
 * whole account — and every other reader takes a client from {@link giteaClientFor}.
 *
 * The host binds the sessions of each post-grant stage it stands up (`accountForge.ts`). Closing
 * the account lifetime unbinds them and forgets every token at once, before the account runtime's
 * own close gets to them.
 */
import type { ZeropsThrowawayPlatform } from "@t3tools/client-runtime/authorization";
import type { GiteaClient } from "@t3tools/client-runtime/zerops";
import {
  GITEA_SIGNED_OUT,
  type GiteaSessions,
  type GiteaSessionView,
} from "@t3tools/client-runtime/zerops/forge";
import { useEffect, useSyncExternalStore } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";

let current: GiteaSessions | null = null;
const listeners = new Set<() => void>();
/** How the bound sessions tell this binding they changed, until they are unbound. */
let unsubscribeCurrent: () => void = () => undefined;

function changed(): void {
  for (const listener of listeners) listener();
}

function publish(next: GiteaSessions | null): void {
  unsubscribeCurrent();
  unsubscribeCurrent = () => undefined;
  current = next;
  if (next !== null) unsubscribeCurrent = next.subscribe(changed);
  changed();
}

onAccountLifetimeClose(() => {
  const closing = current;
  if (closing === null) return;
  publish(null);
  closing.close();
});

/**
 * Makes `sessions` — the open account's — the ones surfaces read. Returns the way to unbind them,
 * which leaves a newer binding alone.
 */
export function bindAccountGiteaSessions(sessions: GiteaSessions): () => void {
  publish(sessions);
  return () => {
    if (current === sessions) publish(null);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open account's Gitea sessions, or `null` before its first grant and after sign-out. */
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
