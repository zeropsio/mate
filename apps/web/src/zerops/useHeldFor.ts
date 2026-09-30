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
