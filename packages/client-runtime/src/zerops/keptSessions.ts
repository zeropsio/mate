/**
 * A Mate's session, kept across loads (the owner, 2026-10-02).
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
 *   beside it and can mint a throwaway for every Mate.
 * - The account's close ends every kept session at its Mate and forgets them all (`drain`).
 * - A refusal forgets only the session it was about: another tab may have kept a newer one.
 *
 * @module keptSessions
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { BearerConnectionRegistration } from "../connection/catalog.ts";

/** The account-scoped storage key the kept sessions live under. */
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

/** The sessions kept for the account, by target (`projectId:serviceId`). */
export interface KeptSessions {
  /** The session kept for this target, unless it would end within the lead. */
  readonly read: (key: string) => BearerConnectionRegistration | null;
  /** Keeps the session a target was just connected with, in place of any before it. */
  readonly keep: (key: string, registration: BearerConnectionRegistration) => void;
  /** Forgets this target's session while it is still the one with this token. */
  readonly forget: (key: string, token: string) => void;
  /** Every session still live, for the account's close to end; nothing stays kept. */
  readonly drain: () => ReadonlyArray<BearerConnectionRegistration>;
}

const decodeRegistration = Schema.decodeUnknownOption(BearerConnectionRegistration);
const encodeRegistration = Schema.encodeSync(BearerConnectionRegistration);

export function makeKeptSessions(
  storage: KeptSessionStorage,
  nowEpochMs: () => number,
): KeptSessions {
  /** Every entry that decodes, in the order it was kept; a storage that refuses holds none. */
  const load = (): Map<string, BearerConnectionRegistration> => {
    const kept = new Map<string, BearerConnectionRegistration>();
    let raw: unknown;
    try {
      const text = storage.getItem(KEPT_SESSIONS_KEY);
      raw = text === null ? null : JSON.parse(text);
    } catch {
      return kept;
    }
    if (typeof raw !== "object" || raw === null) return kept;
    for (const [key, value] of Object.entries(raw)) {
      const registration = decodeRegistration(value);
      if (Option.isSome(registration)) kept.set(key, registration.value);
    }
    return kept;
  };

  /** Whether the session ends within `leadMs`; one with no deadline is its Mate's to judge. */
  const ended = (registration: BearerConnectionRegistration, leadMs: number): boolean => {
    const deadline = registration.credential.expiresAtEpochMs;
    return deadline !== undefined && nowEpochMs() + leadMs >= deadline;
  };

  /** Writes what is kept, past-deadline entries dropped; an empty set removes the key. */
  const save = (kept: ReadonlyMap<string, BearerConnectionRegistration>): void => {
    const live = [...kept].filter(([, registration]) => !ended(registration, 0));
    try {
      if (live.length === 0) storage.removeItem(KEPT_SESSIONS_KEY);
      else
        storage.setItem(
          KEPT_SESSIONS_KEY,
          JSON.stringify(
            Object.fromEntries(live.map(([key, value]) => [key, encodeRegistration(value)])),
          ),
        );
    } catch {
      // A storage that refuses keeps nothing: the next load mints, as it did before.
    }
  };

  return {
    read: (key) => {
      const registration = load().get(key);
      return registration === undefined || ended(registration, KEPT_SESSION_LEAD_MS)
        ? null
        : registration;
    },
    keep: (key, registration) => {
      const kept = load();
      kept.delete(key);
      kept.set(key, registration);
      save(kept);
    },
    forget: (key, token) => {
      const kept = load();
      if (kept.get(key)?.credential.token !== token) return;
      kept.delete(key);
      save(kept);
    },
    drain: () => {
      const live = [...load().values()].filter((registration) => !ended(registration, 0));
      try {
        storage.removeItem(KEPT_SESSIONS_KEY);
      } catch {
        // Nothing more to forget than a storage that refuses already holds.
      }
      return live;
    },
  };
}
