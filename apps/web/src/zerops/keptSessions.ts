/**
 * The account's kept Mate sessions on the web (`keptSessions.ts` in the client runtime), under the
 * account's scoped `localStorage`. The door's exchange presents them again (`environmentPorts.ts`),
 * and no kept session outlives the login it was opened under: the account's close ends every one
 * at its Mate however the account closes, and a stored login the platform refused ends every one
 * this origin holds (`ZeropsSessionProvider.tsx`).
 */
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import {
  KEPT_SESSIONS_KEY,
  makeKeptSessions,
  MATE_SESSIONS,
} from "@t3tools/client-runtime/zerops/keptSessions";
import { AuthZeropsClientScopes, type AuthSessionState } from "@t3tools/contracts";

import { accountLocalStorage, onAccountLifetimeClose } from "./accountLifetime";

const nowEpochMs = () => Date.now();

export const keptSessions = makeKeptSessions(accountLocalStorage, nowEpochMs, MATE_SESSIONS);

/** The tokens this page has ended: two closers never end one session twice. */
const ended = new Set<string>();

/**
 * Ends a session at its Mate. Nothing waits on it: a Mate that does not answer ends the session
 * with its day, as every session ended before any was kept.
 */
export function endMateSession(logout: { readonly url: string; readonly token: string }): void {
  if (ended.has(logout.token)) return;
  ended.add(logout.token);
  void fetch(logout.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${logout.token}` },
    keepalive: true,
  }).catch(() => undefined);
}

export function endKeptSession(registration: BearerConnectionRegistration): void {
  endMateSession({
    url: `${registration.profile.httpBaseUrl.replace(/\/+$/, "")}/api/auth/logout`,
    token: registration.credential.token,
  });
}

/**
 * Whether the Mate's answer holds a session this client can still use: live, and carrying every
 * scope it asks for now — a session from before a release that added a scope is not.
 */
export function keptSessionHeld(state: AuthSessionState): boolean {
  return (
    state.authenticated &&
    AuthZeropsClientScopes.every((scope) => state.scopes?.includes(scope) === true)
  );
}

/**
 * A stored login the platform refused: nobody is signed in on this origin any more, so every
 * session kept under any account here is ended and forgotten.
 */
export function endEveryKeptSession(): void {
  const keys: Array<string> = [];
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("mate:account:") && key.endsWith(`:${KEPT_SESSIONS_KEY}`)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    const sessions = makeKeptSessions(
      {
        getItem: () => window.localStorage.getItem(key),
        setItem: (_name, value) => window.localStorage.setItem(key, value),
        removeItem: () => window.localStorage.removeItem(key),
      },
      nowEpochMs,
      MATE_SESSIONS,
    );
    for (const registration of sessions.drain()) endKeptSession(registration);
  }
}

// However the account closes — signed out, replaced, its login refused while open — it ends every
// session it kept, whether or not this tab ever built a connection runtime.
onAccountLifetimeClose(() => {
  for (const registration of keptSessions.drain()) endKeptSession(registration);
});
