/**
 * Leases on the account's data runtime for the interests a view draws, held while it draws them
 * (R7: a drawn stop owns its demand). Diffed by each interest's key: a change in what is drawn takes
 * only the new interests and lets go only those no longer drawn, so the others are never read again
 * for it. Every lease goes with the view, or with the runtime it was taken from.
 */
import { interestKeyOf, type RuntimeInterestDescriptor } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useEffect, useRef } from "react";

import { useZeropsData } from "./zeropsDataContext";

export function useInterestLeases(descriptors: ReadonlyArray<RuntimeInterestDescriptor>): void {
  const { runtime } = useZeropsData();
  const held = useRef({ runtime, leases: new Map<string, AbortController>() });
  useEffect(() => {
    const { leases } = held.current;
    if (held.current.runtime !== runtime) {
      for (const lease of leases.values()) lease.abort();
      leases.clear();
      held.current.runtime = runtime;
    }
    const wanted = new Map<string, RuntimeInterestDescriptor>(
      descriptors.map((descriptor) => [interestKeyOf(descriptor), descriptor]),
    );
    for (const [key, lease] of leases) {
      if (wanted.has(key)) continue;
      lease.abort();
      leases.delete(key);
    }
    for (const [key, descriptor] of wanted) {
      if (leases.has(key)) continue;
      const lease = new AbortController();
      leases.set(key, lease);
      void Effect.runPromise(
        Effect.scoped(runtime.acquire(descriptor).pipe(Effect.andThen(Effect.never))),
        { signal: lease.signal },
      ).catch(() => {
        // A refused lease is asked for again when what is drawn next changes.
        if (leases.get(key) === lease) leases.delete(key);
      });
    }
  }, [descriptors, runtime]);
  useEffect(() => {
    const { leases } = held.current;
    return () => {
      for (const lease of leases.values()) lease.abort();
      leases.clear();
    };
  }, []);
}
