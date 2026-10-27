import { useEffect, useState } from "react";

/**
 * Whether `active` has held for `ms` without a break: false the moment it drops, and false again
 * until a new stretch has lasted as long. One timer per stretch, no clock read in the render.
 */
export function useHeldFor(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setHeld(true), ms);
    return () => {
      clearTimeout(timer);
      setHeld(false);
    };
  }, [active, ms]);
  return active && held;
}

/**
 * Whether the same `key` has stood for `ms` without a break: a different key starts its own
 * stretch at once — a wait of one organization is never carried into another's — and `null`
 * holds nothing.
 */
export function useHeldForKey(key: string | null, ms: number): boolean {
  const [heldKey, setHeldKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setHeldKey(key), ms);
    return () => {
      clearTimeout(timer);
      setHeldKey(null);
    };
  }, [key, ms]);
  return key !== null && heldKey === key;
}
