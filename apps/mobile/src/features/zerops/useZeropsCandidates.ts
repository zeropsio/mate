import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  loadZeropsCandidates,
  resolveWithConcurrency,
} from "@t3tools/client-runtime/zerops/candidateLoading";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEnvironments } from "../../state/environments";
import { candidateAfterHealthProbe, probeCandidateHealth } from "./candidate-loading";
import { connectedZeropsOrigins } from "./candidate-origins";
import { useZeropsSession } from "./ZeropsSessionProvider";

const RESOLUTION_CONCURRENCY = 4;

export function useZeropsCandidates(): {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { client, status, organizations } = useZeropsSession();
  const { environments } = useEnvironments();
  const [candidates, setCandidates] = useState<ReadonlyArray<ZeropsCandidate>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const generationRef = useRef(0);
  // Joined to a stable primitive so the effect below does not re-run on a
  // fresh array reference alone.
  const organizationIdsKey = organizations.map((organization) => organization.id).join(",");
  const connectedOrigins = useMemo(() => connectedZeropsOrigins(environments), [environments]);

  useEffect(() => {
    if (status !== "signed-in") {
      setCandidates([]);
      setIsLoading(false);
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const isCancelled = () => generationRef.current !== generation;
    setIsLoading(true);
    setError(null);
    setCandidates([]);

    void (async () => {
      try {
        const organizationIds = organizationIdsKey.split(",").filter(Boolean);
        const { candidates: platformCandidates, failures } = await loadZeropsCandidates(client, {
          organizationIds,
          connectedOrigins,
          concurrency: RESOLUTION_CONCURRENCY,
          isCancelled,
        });
        if (isCancelled()) return;
        if (failures.length > 0) {
          setError(
            failures.length === organizationIds.length
              ? zeropsErrorMessage(failures[0]?.cause)
              : "Some Zerops organizations could not be loaded.",
          );
        }

        setCandidates(
          platformCandidates.map((candidate) => candidateAfterHealthProbe(candidate, undefined)),
        );

        await resolveWithConcurrency(
          platformCandidates.filter(
            (candidate): candidate is ZeropsCandidate & { readonly containerOrigin: string } =>
              candidate.group === "ready" && candidate.containerOrigin !== undefined,
          ),
          RESOLUTION_CONCURRENCY,
          isCancelled,
          async (candidate) => {
            const health = await probeCandidateHealth(candidate.containerOrigin);
            if (isCancelled()) return;
            setCandidates((current) =>
              current.map((entry) =>
                entry.key === candidate.key ? candidateAfterHealthProbe(candidate, health) : entry,
              ),
            );
          },
        );
        if (!isCancelled()) setIsLoading(false);
      } catch (cause) {
        if (isCancelled()) return;
        setError(zeropsErrorMessage(cause));
        setIsLoading(false);
      }
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [client, connectedOrigins, status, organizationIdsKey, reloadCount]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);
  return { candidates, isLoading, error, refresh };
}
