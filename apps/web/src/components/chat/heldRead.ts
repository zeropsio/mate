import { useState } from "react";

/**
 * A value read live, or held: while `hold`, the value as it stood when the
 * hold began, taken anew only when `beat` changes. A list kept out of sight
 * reads its conversation through it (`useWarmTimeline`): a run streaming in
 * a Mate the person left is not derived again on every word, only as its
 * turn starts or ends; let go, it reads live again at once.
 */
export function useHeld<T>(live: T, hold: boolean, beat: string): T {
  const [held, setHeld] = useState<{ readonly value: T; readonly beat: string } | null>(null);
  if (!hold) {
    if (held !== null) setHeld(null);
    return live;
  }
  if (held === null || held.beat !== beat) {
    setHeld({ value: live, beat });
    return live;
  }
  return held.value;
}
