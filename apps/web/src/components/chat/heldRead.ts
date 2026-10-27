import { useEffect, useRef, useState } from "react";

/** How often a held read takes what changed since, at most: a run's words, about once a second. */
export const HELD_READ_EVERY_MS = 1000;

/**
 * A value read live, or held: while `hold`, taken anew at once when `beat`
 * changes, and otherwise at most once every `everyMs` — the last change of a
 * burst always taken, once its wait runs out, so a held value is never more
 * than `everyMs` behind. A list kept out of sight reads its conversation
 * through it (`useWarmTimeline`): a run streaming in a Mate the person left is
 * derived about once a second instead of on every word, and at once as its
 * turn starts or ends; let go, it reads live again at once.
 *
 * `live` is compared by identity: what changes it is what is read again.
 */
export function useHeld<T>(live: T, hold: boolean, beat: string, everyMs: number): T {
  const [held, setHeld] = useState<{ readonly value: T; readonly beat: string } | null>(null);
  const liveRef = useRef(live);
  const takenAtRef = useRef(Number.NEGATIVE_INFINITY);
  const holding = hold && held !== null && held.beat === beat;
  const behind = holding && held.value !== live;
  useEffect(() => {
    liveRef.current = live;
  });
  // Taken anew: its wait starts over.
  useEffect(() => {
    if (held !== null) takenAtRef.current = performance.now();
  }, [held]);
  useEffect(() => {
    if (!behind) return;
    const wait = Math.max(0, takenAtRef.current + everyMs - performance.now());
    const taking = setTimeout(() => setHeld({ value: liveRef.current, beat }), wait);
    return () => clearTimeout(taking);
  }, [behind, beat, everyMs]);
  if (!hold) {
    if (held !== null) setHeld(null);
    return live;
  }
  if (!holding) {
    setHeld({ value: live, beat });
    return live;
  }
  return held.value;
}
