import { createContext, useContext } from "react";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";
export const ZeropsSessionContext = createContext<ZeropsSessionValue | null>(null);

export function useZeropsSession(): ZeropsSessionValue {
  const value = useContext(ZeropsSessionContext);
  if (!value) {
    throw new Error("useZeropsSession must be used inside a ZeropsSessionProvider.");
  }
  return value;
}

/**
 * `useZeropsSession`, without the throw. For a component that renders in
 * contexts outside `AppRoot`'s provider tree (a render test in isolation) and
 * has to treat "no session available" as its own `idle`/off state rather than
 * crash — e.g. the operation card's `useOperationObservation`.
 */
export function useZeropsSessionOptional(): ZeropsSessionValue | null {
  return useContext(ZeropsSessionContext);
}
