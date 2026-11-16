/**
 * When the person last opened each change's review on this device: what makes a comment somebody
 * left on their Mate's change news to them ("Sam R. commented") until they have read it.
 *
 * A convenience of this browser, never a fact: kept in memory for the visit and in the account's
 * local storage where that works. Where it does not, a comment's mark shows until the review is
 * opened in this visit, or the change moves.
 */
import { useSyncExternalStore } from "react";

import { accountLocalStorage } from "./accountLifetime";

const KEY = "mate:change-seen";
/** How many changes are remembered: the newest opened win. */
const KEPT = 200;

let seen: Record<string, string> | undefined;
const listeners = new Set<() => void>();

function held(): Record<string, string> {
  if (seen !== undefined) return seen;
  try {
    const stored: unknown = JSON.parse(accountLocalStorage.getItem(KEY) ?? "{}");
    seen =
      typeof stored === "object" && stored !== null
        ? Object.fromEntries(
            Object.entries(stored).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
  } catch {
    seen = {};
  }
  return seen;
}

/** A change's key here: its application, repository and number. */
export function changeSeenKey(appId: string, repository: string, number: number): string {
  return `${appId}:${repository}#${String(number)}`;
}

/** The person opened, or closed, this change's review now: what was said on it is read. */
export function markChangeSeen(key: string, at: string = new Date().toISOString()): void {
  const next = Object.entries({ ...held(), [key]: at })
    .toSorted(([, left], [, right]) => right.localeCompare(left))
    .slice(0, KEPT);
  seen = Object.fromEntries(next);
  try {
    accountLocalStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* Blocked storage: the visit's memory still holds it. */
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** When each change's review was last opened here, by `changeSeenKey`; follows `markChangeSeen`. */
export function useChangesSeen(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, held, held);
}
