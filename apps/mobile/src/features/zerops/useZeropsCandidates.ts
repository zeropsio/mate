import {
  deriveZeropsCandidates,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEnvironments } from "../../state/environments";
import {
  candidateAfterHealthProbe,
  loadOrganizationProjects,
  probeCandidateHealth,
} from "./candidate-loading";
import { connectedZeropsOrigins } from "./candidate-origins";
import { zeropsErrorMessage } from "./errors";
import { useZeropsSession } from "./ZeropsSessionProvider";

const RESOLUTION_CONCURRENCY = 4;

type ServicesOutcome =
  | { readonly status: "resolved"; readonly services: ReadonlyArray<ZeropsService> }
  | { readonly status: "failed" };

async function resolveWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  isCancelled: () => boolean,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) return;
      const item = items[cursor];
      cursor += 1;
      if (item === undefined) return;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

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
  const organizationIds = organizations.map((organization) => organization.id).join(",");
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
        const ids = organizationIds.split(",").filter(Boolean);
        const loaded = await loadOrganizationProjects(ids, (organizationId) =>
          client.listClientProjects(organizationId),
        );
        if (isCancelled()) return;
        if (loaded.failures.length > 0) {
          setError(
            loaded.failures.length === ids.length
              ? zeropsErrorMessage(loaded.failures[0]?.cause)
              : "Some Zerops organizations could not be loaded.",
          );
        }

        const services = new Map<string, ServicesOutcome>();
        await resolveWithConcurrency(
          loaded.projects.filter((project) => project.status === "ACTIVE"),
          RESOLUTION_CONCURRENCY,
          isCancelled,
          async (project) => {
            const outcome: ServicesOutcome = await client
              .listProjectServices(project.id)
              .then((resolved) => ({ status: "resolved" as const, services: resolved }))
              .catch(() => ({ status: "failed" as const }));
            if (isCancelled()) return;
            services.set(project.id, outcome);
          },
        );
        if (isCancelled()) return;

        const platformCandidates: ZeropsCandidate[] = [];
        for (const project of loaded.projects) {
          const outcome = services.get(project.id);
          platformCandidates.push(
            ...deriveZeropsCandidates(
              project,
              project.status === "ACTIVE" && outcome?.status === "resolved"
                ? outcome.services
                : null,
              connectedOrigins,
            ),
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
  }, [client, connectedOrigins, status, organizationIds, reloadCount]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);
  return { candidates, isLoading, error, refresh };
}
