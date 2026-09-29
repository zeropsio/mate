import { useState } from "react";

/**
 * Whether a value has changed since the component first drew it. What a
 * surface opened onto is simply there — a reload, a mount — and only a change
 * the person watches may move, so a line's new words can rise into place
 * without every line rising in on every paint. A value that only stood in
 * until the real one was read (`known` false: words a browser remembered, a
 * cached copy) gives way to it without counting as a change.
 */
export function useChangedSinceShown<T>(value: T, known = true): boolean {
  const [seen, setSeen] = useState<{
    readonly value: T;
    readonly known: boolean;
    readonly changed: boolean;
  }>({ value, known, changed: false });
  if (Object.is(seen.value, value) && seen.known === known) return seen.changed;
  const changed = Object.is(seen.value, value)
    ? seen.changed
    : seen.changed || (seen.known && known);
  setSeen({ value, known, changed });
  return changed;
}
