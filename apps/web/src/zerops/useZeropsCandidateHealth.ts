/**
 * Probes each reachable candidate's container so the picker can say, per row,
 * whether Zerops Code is actually there — rather than making the user click
 * Connect to find out.
 *
 * Capped and incremental: an account with a dozen containers gets four
 * requests in flight and rows that settle as answers arrive.
 */

import { useEffect, useMemo, useState } from "react";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";

const PROBE_CONCURRENCY = 4;

export function useZeropsCandidateHealth(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, ZeropsContainerHealth> {
  const [health, setHealth] = useState<ReadonlyMap<string, ZeropsContainerHealth>>(new Map());

  // Only the rows that have an origin to probe, keyed so the effect re-runs
  // when the set changes rather than on every re-render.
  const targets = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.containerOrigin)
        .map((candidate) => ({ key: candidate.key, origin: candidate.containerOrigin ?? "" })),
    [candidates],
  );
  const targetKey = targets.map((target) => `${target.key}=${target.origin}`).join(",");

  useEffect(() => {
    if (targets.length === 0) return;
    let cancelled = false;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (cancelled) return;
        const target = targets[cursor];
        cursor += 1;
        if (!target) return;
        const verdict = await probeZeropsContainerHealth(target.origin);
        if (cancelled) return;
        setHealth((current) => new Map(current).set(target.key, verdict));
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, targets.length) }, () => worker()),
    );
    return () => {
      cancelled = true;
    };
    // `targetKey` is the identity of `targets`; depending on the array itself
    // would restart every probe on each incremental render.
  }, [targetKey]);

  return health;
}
