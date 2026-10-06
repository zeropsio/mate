/**
 * A Mate's session, kept across loads (the owner, 2026-10-02) — and HQ's, by the same rules
 * (audit K7): its door opened a session per load in this page's memory only, so every load minted
 * and deleted a throwaway on the first paint's path, and a sign-out left the session live for its
 * 12 hours.
 *
 * The door's throwaway (`doorThrowaway.ts`) opens a session on a Mate, and ending it is the
 * Mate's call: its membership watch ends it when the person's access changes, and its age ends
 * it after a day. Held in memory only, it was lost on every load, so every load minted and
 * deleted a throwaway per Mate, waited on the mint pace and the Zerops API to reach Mates that
 * were up, and left the session it dropped live on its Mate for the rest of the day.
 *
 * It is kept instead, per account, and presented again only where the exchange would present a
 * fresh one — the Mate's descriptor names the expected project and environment — and only once
 * the Mate says it is still its own (`identityExchange.ts`). Anything else mints, as before.
 *
 * - Nothing here outweighs what the same storage already holds: the account's Zerops token sits
 *   beside it and can mint a throwaway for every Mate. So no session stays kept once that token is
 *   gone: every way out of the account ends them at their Mates (`drain`), and so does a stored
 *   login the platform refuses.
 * - A session one keeps or forgets in place of another answers the one it displaced, for the
 *   caller to end at its Mate: a session dropped from here is never left live for its day.
 * - A refusal forgets only the session it was about: another tab may have kept a newer one. Two
 *   tabs writing at once can still lose one entry; its session ends with its day, as every session
 *   did before any was kept.
 *
 * @module keptSessions
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { BearerConnectionRegistration } from "../connection/catalog.ts";

/** The account-scoped storage key the kept Mate sessions live under. */
export const KEPT_SESSIONS_KEY = "mate-sessions.v1";

/**
 * A session with less than this left is not presented again: it would end within the load that
 * restored it, and a throwaway buys a whole day.
 */
export const KEPT_SESSION_LEAD_MS = 15 * 60_000;

/** The account's own storage; the web scopes every key to the signed-in account. */
export interface KeptSessionStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

/** The sessions of one kind kept for the account, by what each was opened for. */
export interface KeptSessions<T> {
  /** The session kept for this key, unless it would end within the lead. */
  readonly read: (key: string) => T | null;
  /** The keys whose sessions `read` would answer. */
  readonly keys: () => ReadonlyArray<string>;
  /**
   * Keeps the session just opened for a key, in place of any before it; answers the session it
   * displaced, or null when there was none or it was this one.
   */
  readonly keep: (key: string, session: T) => T | null;
  /** Forgets this key's session while it is still the one with this token; answers it. */
  readonly forget: (key: string, token: string) => T | null;
  /** Every session still live, for the account's close to end; nothing stays kept. */
  readonly drain: () => ReadonlyArray<T>;
}

/** One kind of kept session: where it is stored, what it is, its token and its deadline. */
export interface KeptSessionKind<T, E> {
  /** The account-scoped storage key the sessions of this kind live under. */
  readonly storageKey: string;
  readonly schema: Schema.Codec<T, E>;
  readonly token: (session: T) => string;
  /** When the session ends, epoch ms; undefined leaves it to its issuer to judge. */
  readonly expiresAtEpochMs: (session: T) => number | undefined;
}

/** The account-scoped storage key HQ's kept sessions live under. */
export const KEPT_HQ_SESSIONS_KEY = "hq-sessions.v1";

/** HQ's session as its door issued it, for the HQ at `address`. */
export const KeptHqSession = Schema.Struct({
  address: Schema.String,
  token: Schema.String,
  expiresAtEpochMs: Schema.Number,
});
export type KeptHqSession = typeof KeptHqSession.Type;

/** HQ's session, by organization and HQ (`clientId:hqProjectId:address`). */
export const HQ_SESSIONS: KeptSessionKind<KeptHqSession, typeof KeptHqSession.Encoded> = {
  storageKey: KEPT_HQ_SESSIONS_KEY,
  schema: KeptHqSession,
  token: (session) => session.token,
  expiresAtEpochMs: (session) => session.expiresAtEpochMs,
};

/** A Mate's session, by target (`projectId:serviceId`). */
export const MATE_SESSIONS: KeptSessionKind<
  BearerConnectionRegistration,
  typeof BearerConnectionRegistration.Encoded
> = {
  storageKey: KEPT_SESSIONS_KEY,
  schema: BearerConnectionRegistration,
  token: (registration) => registration.credential.token,
  expiresAtEpochMs: (registration) => registration.credential.expiresAtEpochMs,
};

export function makeKeptSessions<T, E>(
  storage: KeptSessionStorage,
  nowEpochMs: () => number,
  kind: KeptSessionKind<T, E>,
): KeptSessions<T> {
  const decode = Schema.decodeUnknownOption(kind.schema);
  const encode = Schema.encodeSync(kind.schema);
  /** The last text read and what it decoded to: the driver asks many times per pass. */
  let decoded: { readonly text: string; readonly kept: ReadonlyMap<string, T> } | null = null;

  /** Every entry that decodes, in the order it was kept; a storage that refuses holds none. */
  const load = (): Map<string, T> => {
    let text: string | null;
    try {
      text = storage.getItem(kind.storageKey);
    } catch {
      return new Map();
    }
    if (text === null) return new Map();
    if (decoded?.text === text) return new Map(decoded.kept);
    const kept = new Map<string, T>();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    if (typeof raw === "object" && raw !== null) {
      for (const [key, value] of Object.entries(raw)) {
        const session = decode(value);
        if (Option.isSome(session)) kept.set(key, session.value);
      }
    }
    decoded = { text, kept: new Map(kept) };
    return kept;
  };

  /** Whether the session ends within `leadMs`; one with no deadline is its issuer's to judge. */
  const ended = (session: T, leadMs: number): boolean => {
    const deadline = kind.expiresAtEpochMs(session);
    return deadline !== undefined && nowEpochMs() + leadMs >= deadline;
  };

  /** Writes what is kept, past-deadline entries dropped; an empty set removes the key. */
  const save = (kept: ReadonlyMap<string, T>): void => {
    const live = [...kept].filter(([, session]) => !ended(session, 0));
    try {
      if (live.length === 0) storage.removeItem(kind.storageKey);
      else
        storage.setItem(
          kind.storageKey,
          JSON.stringify(Object.fromEntries(live.map(([key, value]) => [key, encode(value)]))),
        );
    } catch {
      // A storage that refuses keeps nothing: the next load opens a session, as it did before.
    }
  };

  return {
    read: (key) => {
      const session = load().get(key);
      return session === undefined || ended(session, KEPT_SESSION_LEAD_MS) ? null : session;
    },
    keys: () =>
      [...load()]
        .filter(([, session]) => !ended(session, KEPT_SESSION_LEAD_MS))
        .map(([key]) => key),
    keep: (key, session) => {
      const kept = load();
      const before = kept.get(key) ?? null;
      kept.delete(key);
      kept.set(key, session);
      save(kept);
      return before !== null && kind.token(before) !== kind.token(session) ? before : null;
    },
    forget: (key, token) => {
      const kept = load();
      const before = kept.get(key) ?? null;
      if (before === null || kind.token(before) !== token) return null;
      kept.delete(key);
      save(kept);
      return before;
    },
    drain: () => {
      const live = [...load().values()].filter((session) => !ended(session, 0));
      try {
        storage.removeItem(kind.storageKey);
      } catch {
        // Nothing more to forget than a storage that refuses already holds.
      }
      return live;
    },
  };
}
