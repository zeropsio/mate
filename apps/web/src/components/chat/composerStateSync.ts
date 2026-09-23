import { type DependencyList, useEffect } from "react";

/**
 * After a commit in which one of `deps` changed, moves a piece of composer state to `target`,
 * computed from that commit's render. It calls the setter only for a different value: a
 * same-value update still schedules a render while the fiber has work pending, and one left
 * pending by every commit of a burst of store writes (a reconnect after a lapse) makes React
 * count each commit as nested until it throws "Maximum update depth exceeded".
 */
export function useSyncStateOnChange<T>(
  value: T,
  setValue: (next: T) => void,
  target: T,
  deps: DependencyList,
): void {
  useEffect(() => {
    if (!Object.is(value, target)) setValue(target);
  }, deps);
}
