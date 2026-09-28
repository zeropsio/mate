import { useState } from "react";

/**
 * Whether a value has changed since the component first drew it. What a
 * surface opened onto is simply there — a reload, a mount — and only a change
 * the person watches may move, so a line's new words can rise into place
 * without every line rising in on every paint.
 */
export function useChangedSinceShown<T>(value: T): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && !Object.is(value, first)) setChanged(true);
  return changed || !Object.is(value, first);
}
