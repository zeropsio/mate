/**
 * A source that blinks keeps what it last said: data never vanishes because the thing it was
 * read from went missing for a moment.
 *
 * The account's Gitea is found in the inventory (`giteaProject.ts`), and the inventory loses a
 * project for a moment whenever a socket is replaced and its interests are read again one at a
 * time. Without a hold, that moment emptied the registry, so every project left the flow, its
 * pull requests and merges were forgotten and read again from nothing: rows said "None yet" and
 * "Nothing merged" for up to half a minute (the owner, 2026-09-30).
 *
 * The last answer stands while the source is missing in the same scope, for
 * {@link BLINK_GRACE_MS}; past that the absence is real and it is let go. Another scope (another
 * organization) or none (signed out) never sees it.
 */
import { useEffect, useState } from "react";

/**
 * How long a missing source is a blink. The inventory's slowest measured recovery after its
 * socket was replaced took 18.9 s (3.9 s since); a minute is three times that, and one Gitea
 * refresh cycle (`GROUP_FORGE_REFRESH_MS`), so something truly gone is dropped within one more.
 */
export const BLINK_GRACE_MS = 60_000;

/** What was last answered, and in which scope. */
export interface BlinkHeld<T> {
  readonly key: string;
  readonly value: T;
}

/** What to show: the answer, else — in the same scope — the one held. */
export function shownThroughBlink<T>(input: {
  readonly value: T | undefined;
  /** The scope it is read in; `undefined` when there is none (signed out). */
  readonly key: string | undefined;
  readonly held: BlinkHeld<T> | undefined;
}): T | undefined {
  const { value, key, held } = input;
  if (value !== undefined) return value;
  return key !== undefined && held?.key === key ? held.value : undefined;
}

/** `value`, held through a blink of up to {@link BLINK_GRACE_MS} in scope `key`. */
export function useHeldThroughBlink<T>(
  value: T | undefined,
  key: string | undefined,
  graceMs: number = BLINK_GRACE_MS,
): T | undefined {
  const [held, setHeld] = useState<BlinkHeld<T> | undefined>(undefined);
  if (value !== undefined && key !== undefined && (held?.value !== value || held.key !== key)) {
    setHeld({ key, value });
  }
  const blinking = value === undefined && key !== undefined && held?.key === key;
  useEffect(() => {
    if (!blinking) return;
    const timer = setTimeout(() => {
      setHeld(undefined);
    }, graceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [blinking, graceMs]);
  return shownThroughBlink({ value, key, held });
}
