/**
 * The account's kept sessions on the web (`keptSessions.ts` in the client runtime) — its Mates'
 * and its organizations' HQs' — under the account's scoped `localStorage`. The door's exchange
 * presents a Mate's again (`environmentPorts.ts`), HQ's API its own (`accountHq.ts`), and no kept
 * session outlives the login it was opened under: the account's close ends every one where it was
 * issued however the account closes.
 */
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import {
  HQ_SESSIONS,
  makeKeptSessions,
  MATE_SESSIONS,
  type KeptHqSession,
} from "@t3tools/client-runtime/zerops/keptSessions";
import { AuthZeropsClientScopes, type AuthSessionState } from "@t3tools/contracts";

import { accountLocalStorage, onAccountLifetimeClose } from "./accountLifetime";

const nowEpochMs = () => Date.now();

export const keptSessions = makeKeptSessions(accountLocalStorage, nowEpochMs, MATE_SESSIONS);

export const keptHqSessions = makeKeptSessions(accountLocalStorage, nowEpochMs, HQ_SESSIONS);

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

/**
 * Drops the session kept for a Mate's target where it is kept, and ends nothing at the Mate: one
 * gone from the platform's listing has nobody to answer, and asking would be a failed request.
 */
export function forgetKeptMateSession(key: string): void {
  const registration = keptSessions.read(key);
  if (registration !== null) keptSessions.forget(key, registration.credential.token);
}

export function endKeptSession(registration: BearerConnectionRegistration): void {
  endMateSession({
    url: `${registration.profile.httpBaseUrl.replace(/\/+$/, "")}/api/auth/logout`,
    token: registration.credential.token,
  });
}

/** Revokes a session HQ issued (`DELETE /api/session`); nothing waits on it, as for a Mate's. */
export function endHqSession(session: KeptHqSession): void {
  if (ended.has(session.token)) return;
  ended.add(session.token);
  void fetch(`${session.address.replace(/\/+$/, "")}/api/session`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.token}` },
    keepalive: true,
  }).catch(() => undefined);
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

// However the account closes — signed out, replaced, its login refused while open — it ends every
// session it kept, whether or not this tab ever built a connection runtime or reached HQ.
onAccountLifetimeClose(() => {
  for (const registration of keptSessions.drain()) endKeptSession(registration);
  for (const session of keptHqSessions.drain()) endHqSession(session);
});
