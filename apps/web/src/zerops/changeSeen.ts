/**
 * The newest comment the person has read on each change, by its own time as HQ gave it: what makes
 * a later comment on their Mate's change news to them ("Sam R. commented") until they read it too.
 * A comment is read where its change's review shows it.
 *
 * HQ's time on both sides of the comparison: this device's clock decides nothing, so a wrong one
 * hides no comment. A convenience of this browser, never a fact: kept in memory for the visit and
 * in the account's local storage where that works. Where it does not, a comment's mark shows until
 * the review shows it in this visit.
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

/** The change's review shows the comment HQ timed `at`: it, and every earlier one, is read. */
export function markChangeSeen(key: string, at: string): void {
  const read = held()[key];
  if (read !== undefined && Date.parse(read) >= Date.parse(at)) return;
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

/** The newest comment read on each change, by `changeSeenKey`; follows `markChangeSeen`. */
export function useChangesSeen(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, held, held);
}
