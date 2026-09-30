/**
 * Whether a state, named by `key`, has held for `ms`: false from the render the key changes in,
 * true once it has held that long. State and a timer, never a `Date.now()` read in the render
 * (the React Compiler would keep the first one).
 */
import { useEffect, useState } from "react";

export function useHeldPast(key: string, ms: number): boolean {
  const [held, setHeld] = useState({ key, past: false });
  if (held.key !== key) setHeld({ key, past: false });
  const past = held.key === key && held.past;
  useEffect(() => {
    if (past) return;
    const timer = setTimeout(
      () => setHeld((was) => (was.key === key ? { key, past: true } : was)),
      ms,
    );
    return () => clearTimeout(timer);
  }, [key, ms, past]);
  return past;
}
