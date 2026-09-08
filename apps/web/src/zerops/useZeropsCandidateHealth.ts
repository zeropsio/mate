import { useZeropsCandidatesVersion } from "./candidatesRefresh";
/**
 * Probes each reachable candidate's container so the picker can say, per row,
 * whether Zerops Mate is actually there — rather than making the user click
 * Connect to find out.
 *
 * Capped and incremental: an account with a dozen containers gets four
 * requests in flight and rows that settle as answers arrive.
 */

import { useEffect, useMemo, useState } from "react";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { onAccountLifetimeClose } from "./accountLifetime";

const PROBE_CONCURRENCY = 4;

async function readCandidateHealth(origin: string) {
  let serverVersion: string | undefined;
  const health = await probeZeropsContainerHealth(origin, undefined, (version) => {
    serverVersion = version;
  });
  return { health, ...(serverVersion === undefined ? {} : { serverVersion }) };
}

// The sidebar and project picker inspect the same containers. Keep both pending
// and completed probes for this account's explicit inventory refresh cycle.
const probes = new Map<string, ReturnType<typeof readCandidateHealth>>();
let probeVersion: number | undefined;
onAccountLifetimeClose(() => {
  probes.clear();
  probeVersion = undefined;
});

export function probeCandidateHealth(origin: string, refreshVersion: number, targetKey = origin) {
  if (probeVersion !== refreshVersion) {
    probes.clear();
    probeVersion = refreshVersion;
  }
  const normalizedOrigin = origin.replace(/\/+$/, "");
  const key = JSON.stringify([targetKey.replace(/\/+$/, ""), normalizedOrigin]);
  const existing = probes.get(key);
  if (existing !== undefined) return existing;
  const result = readCandidateHealth(normalizedOrigin);
  probes.set(key, result);
  return result;
}

export function useZeropsCandidateHealth(candidates: ReadonlyArray<ZeropsCandidate>): {
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  readonly serverVersions: ReadonlyMap<string, string>;
} {
  const refreshVersion = useZeropsCandidatesVersion();
  const [snapshot, setSnapshot] = useState<{
    health: ReadonlyMap<string, ZeropsContainerHealth>;
    serverVersions: ReadonlyMap<string, string>;
  }>({ health: new Map(), serverVersions: new Map() });

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
    setSnapshot({ health: new Map(), serverVersions: new Map() });
    if (targets.length === 0) return;
    let cancelled = false;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (cancelled) return;
        const target = targets[cursor];
        cursor += 1;
        if (!target) return;
        const { health: verdict, serverVersion } = await probeCandidateHealth(
          target.origin,
          refreshVersion,
          target.key,
        );
        if (cancelled) return;
        setSnapshot((current) => ({
          health: new Map(current.health).set(target.key, verdict),
          serverVersions:
            serverVersion === undefined
              ? current.serverVersions
              : new Map(current.serverVersions).set(target.key, serverVersion),
        }));
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
  }, [targetKey, refreshVersion]);

  return snapshot;
}
