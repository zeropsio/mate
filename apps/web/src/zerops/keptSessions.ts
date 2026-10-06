/**
 * The account's kept sessions on the web (`keptSessions.ts` in the client runtime) — its Mates'
 * and its organizations' HQs' — under the account's scoped `localStorage`. The door's exchange
 * presents a Mate's again (`environmentPorts.ts`), HQ's API its own (`accountHq.ts`), and no kept
 * session outlives the login it was opened under: the account's close ends every one where it was
 * issued however the account closes, and a stored login the platform refused ends its own account's
 * (`endKeptSessionsOf`) — each once no other tab of this origin holds that account open, since a
 * neighbouring tab still on the account uses them.
 */
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import { endIssuedSession } from "@t3tools/client-runtime/data";
import {
  HQ_SESSIONS,
  makeKeptSessions,
  MATE_SESSIONS,
  type KeptHqSession,
  type KeptSessionKind,
} from "@t3tools/client-runtime/zerops/keptSessions";
import { AuthZeropsClientScopes, type AuthSessionState } from "@t3tools/contracts";

import {
  accountLocalStorage,
  accountStorageKey,
  accountStorageKeyOf,
  currentAccountId,
  onAccountLifetimeClose,
  onAccountLifetimeOpen,
} from "./accountLifetime";

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
  endIssuedSession({ url: logout.url, method: "POST", token: logout.token });
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
function endHqSession(session: KeptHqSession): void {
  if (ended.has(session.token)) return;
  ended.add(session.token);
  endIssuedSession({
    url: `${session.address.replace(/\/+$/, "")}/api/session`,
    method: "DELETE",
    token: session.token,
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

/** The shared Web Lock every tab holds on the account it has open. */
const accountOpenLock = (accountId: string) => `mate:account-open:${accountId}`;

/** The origin's Web Locks; absent outside a secure context, where a tab's close decides alone. */
function webLocks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

/**
 * This tab's hold on the account it has open. It stays the last one as the account closes, so a
 * closer that runs before the hold is let go still waits for it.
 */
let hold: {
  readonly accountId: string;
  readonly release: () => void;
  readonly released: Promise<void>;
} | null = null;

onAccountLifetimeOpen(() => {
  const locks = webLocks();
  const accountId = currentAccountId();
  if (locks === undefined || accountId === null) return;
  let release!: () => void;
  const holding = new Promise<void>((resolve) => {
    release = resolve;
  });
  const released = locks
    .request(accountOpenLock(accountId), { mode: "shared" }, () => holding)
    .then(
      () => undefined,
      () => undefined,
    );
  hold = { accountId, release, released };
});

/**
 * Called as the account closes: runs `end` — the end of sessions the account kept — once this tab
 * has let the account go and no other tab of this origin holds it open. A neighbouring tab still
 * on the account uses those sessions, and its own close ends them. Without Web Locks, at once.
 */
export function endWhenAccountLeft(end: () => void): void {
  const accountId = currentAccountId();
  if (accountId !== null) endWhenLeft(accountId, end);
}

/** Runs `end` once this tab let `accountId` go and no tab of this origin holds it open. */
function endWhenLeft(accountId: string, end: () => void): void {
  const locks = webLocks();
  if (locks === undefined) return end();
  const own = hold?.accountId === accountId ? hold.released : Promise.resolve();
  void own.then(() =>
    locks.request(accountOpenLock(accountId), { ifAvailable: true }, (lock) => {
      if (lock !== null) end();
    }),
  );
}

/** The sessions of one kind kept under `key`, still readable once their account has closed. */
function keptUnder<T, E>(key: string, kind: KeptSessionKind<T, E>) {
  return makeKeptSessions(
    {
      getItem: () => window.localStorage.getItem(key),
      setItem: (_name, value) => window.localStorage.setItem(key, value),
      removeItem: () => window.localStorage.removeItem(key),
    },
    nowEpochMs,
    kind,
  );
}

/** Tokens of the Mate sessions this page minted: only those can be this tab's alone. */
const mintedHere = new Set<string>();

/**
 * Keeps a Mate session this tab minted for `key`. The one it displaces is ended at its Mate only
 * where this tab minted it and no other tab of this origin holds the account open; otherwise
 * another tab may still use it, so it is set aside beside the new one and ends with the account.
 */
export function keepMintedMateSession(
  key: string,
  registration: BearerConnectionRegistration,
): void {
  mintedHere.add(registration.credential.token);
  const displaced = keptSessions.keep(key, registration);
  const accountId = currentAccountId();
  const storageKey = accountStorageKey(MATE_SESSIONS.storageKey);
  if (displaced === null || accountId === null || storageKey === null) return;
  const token = displaced.credential.token;
  const setAside = () => {
    keptUnder(storageKey, MATE_SESSIONS).keep(`${key}:displaced:${token}`, displaced);
  };
  if (!mintedHere.has(token)) return setAside();
  const locks = webLocks();
  if (locks === undefined) return endKeptSession(displaced);
  void locks.query().then(({ held = [] }) => {
    const holders = held.filter((lock) => lock.name === accountOpenLock(accountId)).length;
    if (holders > 1) setAside();
    else endKeptSession(displaced);
  }, setAside);
}

/** The sessions of every kind `accountId` keeps, its Mates' and its HQs', ended where issued. */
function endKeptUnder(mateKey: string, hqKey: string): void {
  for (const registration of keptUnder(mateKey, MATE_SESSIONS).drain())
    endKeptSession(registration);
  for (const session of keptUnder(hqKey, HQ_SESSIONS).drain()) endHqSession(session);
}

/**
 * A stored login the platform refused never opened its account here: that account's own kept
 * sessions end, once no tab of this origin holds the account open. No other account's are touched.
 */
export function endKeptSessionsOf(accountId: string): void {
  const mateKey = accountStorageKeyOf(accountId, MATE_SESSIONS.storageKey);
  const hqKey = accountStorageKeyOf(accountId, HQ_SESSIONS.storageKey);
  endWhenLeft(accountId, () => endKeptUnder(mateKey, hqKey));
}

// However the account closes — signed out, replaced, its login refused while open — it ends every
// session it kept, whether or not this tab ever built a connection runtime or reached HQ; where
// another tab still holds the account open, that tab's close does.
onAccountLifetimeClose(() => {
  const mateKey = accountStorageKey(MATE_SESSIONS.storageKey);
  const hqKey = accountStorageKey(HQ_SESSIONS.storageKey);
  if (mateKey === null || hqKey === null) return;
  endWhenAccountLeft(() => endKeptUnder(mateKey, hqKey));
  hold?.release();
});
