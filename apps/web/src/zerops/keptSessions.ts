/**
 * The account's kept sessions on the web (`keptSessions.ts` in the client runtime) — its
 * organizations' HQs' — under the account's scoped `localStorage`. HQ's API presents its own
 * again (`accountHq.ts`), and no kept session outlives the login it was opened under: the account's close ends every one where it was
 * issued however the account closes, and a stored login the platform refused ends its own account's
 * (`endKeptSessionsOf`) — each once no other tab of this origin holds that account open, since a
 * neighbouring tab still on the account uses them.
 */
import { writeBrowserStorage } from "../lib/storage";
import { endIssuedSession } from "@t3tools/client-runtime/data";
import {
  HQ_SESSIONS,
  makeKeptSessions,
  type KeptHqSession,
} from "@t3tools/client-runtime/zerops/keptSessions";

import {
  accountLocalStorage,
  accountStorageKey,
  accountStorageKeyOf,
  currentAccountId,
  onAccountLifetimeClose,
  onAccountLifetimeOpen,
} from "./accountLifetime";

const nowEpochMs = () => Date.now();

export const keptHqSessions = makeKeptSessions(accountLocalStorage, nowEpochMs, HQ_SESSIONS);

/** The tokens this page has ended: two closers never end one session twice. */
const ended = new Set<string>();

/**
 * Ends a bearer session at its environment. Nothing waits on it: one that does not answer ends
 * the session with its deadline.
 */
export function endMateSession(logout: { readonly url: string; readonly token: string }): void {
  if (ended.has(logout.token)) return;
  ended.add(logout.token);
  endIssuedSession({ url: logout.url, method: "POST", token: logout.token });
}

/** Revokes a session HQ issued (`DELETE /api/session`); nothing waits on it, as for a Mate's. */
export function endHqSession(session: KeptHqSession): void {
  if (ended.has(session.token)) return;
  ended.add(session.token);
  endIssuedSession({
    url: `${session.address.replace(/\/+$/, "")}/api/session`,
    method: "DELETE",
    token: session.token,
  });
}

/** The shared Web Lock every tab holds on the account it has open. */
const accountOpenLock = (accountId: string) => `mate:account-open:${accountId}`;

/**
 * The origin's Web Locks; absent outside a secure context, where a tab's close decides alone. An
 * implementation without them may also report `null` (happy-dom does).
 */
function webLocks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator.locks ?? undefined);
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
export function endWhenAccountLeft(end: () => void): Promise<void> {
  const accountId = currentAccountId();
  return accountId === null ? Promise.resolve() : endWhenLeft(accountId, end);
}

/** The ends waiting on each account, run together in one lock check. */
const pendingEnds = new Map<
  string,
  { readonly ends: Array<() => void>; readonly done: Promise<void> }
>();

/**
 * Runs `end` once this tab let `accountId` go and no tab of this origin holds it open. Ends asked
 * for in the same wait share one check: the grant of one request never makes another's see the
 * account as held.
 */
function endWhenLeft(accountId: string, end: () => void): Promise<void> {
  const locks = webLocks();
  if (locks === undefined) {
    end();
    return Promise.resolve();
  }
  const pending = pendingEnds.get(accountId);
  if (pending !== undefined) {
    pending.ends.push(end);
    return pending.done;
  }
  const ends = [end];
  const own = hold?.accountId === accountId ? hold.released : Promise.resolve();
  const done = own.then(() =>
    locks.request(accountOpenLock(accountId), { ifAvailable: true }, (lock) => {
      pendingEnds.delete(accountId);
      if (lock !== null) for (const run of ends) run();
    }),
  );
  pendingEnds.set(accountId, { ends, done });
  return done;
}

/** The HQ sessions kept under `key`, still readable once their account has closed. */
function keptUnder(key: string) {
  return makeKeptSessions(
    {
      getItem: () => window.localStorage.getItem(key),
      setItem: (_name, value) => writeBrowserStorage(window.localStorage, key, value),
      removeItem: () => window.localStorage.removeItem(key),
    },
    nowEpochMs,
    HQ_SESSIONS,
  );
}

/** The HQ sessions kept under `hqKey`, ended where issued. */
function endKeptUnder(hqKey: string): void {
  for (const session of keptUnder(hqKey).drain()) endHqSession(session);
}

/**
 * A stored login the platform refused never opened its account here: that account's own kept
 * sessions end, once no tab of this origin holds the account open. No other account's are touched.
 */
export function endKeptSessionsOf(accountId: string): Promise<void> {
  const hqKey = accountStorageKeyOf(accountId, HQ_SESSIONS.storageKey);
  return endWhenLeft(accountId, () => endKeptUnder(hqKey));
}

// However the account closes — signed out, replaced, its login refused while open — it ends every
// session it kept, whether or not this tab ever built a connection runtime or reached HQ; where
// another tab still holds the account open, that tab's close does.
onAccountLifetimeClose(() => {
  const hqKey = accountStorageKey(HQ_SESSIONS.storageKey);
  if (hqKey === null) return;
  const completed = endWhenAccountLeft(() => endKeptUnder(hqKey));
  hold?.release();
  return completed;
});
