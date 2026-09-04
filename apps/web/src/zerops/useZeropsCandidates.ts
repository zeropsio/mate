/**
 * Web wiring around the shared `loadZeropsCandidates` fetch shell: reads the
 * active clientUser scope, feeds it in as the single organization to load
 * across, and re-renders as each project's services arrive.
 */

import type { EnvironmentId } from "@t3tools/contracts";
import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ZeropsProject } from "@t3tools/client-runtime/zerops";

import { useEnvironments } from "../state/environments";
import {
  deriveZeropsCandidates,
  normalizeOrigin,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import {
  loadZeropsCandidates,
  type ZeropsCandidateServiceOutcome,
} from "@t3tools/client-runtime/zerops/candidateLoading";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface ZeropsCandidatePresentation extends ZeropsCandidate {
  readonly connection?: EnvironmentConnectionPresentation;
}

/** Authenticated environments keyed by origin, so a derived container origin can be matched. */
export function authenticatedZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
    readonly connection: { readonly phase: EnvironmentConnectionPhase };
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (environment.connection.phase !== "connected" || !environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return byOrigin;
}

function zeropsConnectionsByOrigin(
  environments: ReadonlyArray<{
    readonly displayUrl: string | null;
    readonly connection: EnvironmentConnectionPresentation;
  }>,
): ReadonlyMap<string, EnvironmentConnectionPresentation> {
  const byOrigin = new Map<string, EnvironmentConnectionPresentation>();
  for (const environment of environments) {
    if (!environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.connection);
  }
  return byOrigin;
}

// The fetch shell derives its own final candidate list too, but this hook
// keeps its own progressive derivation (below) so a project can render the
// moment its services arrive rather than waiting for the whole load — the
// shell is given a stable empty map here since that derivation is unused.
const NO_CONNECTED_ORIGINS = new Map<string, EnvironmentId>();

export function useZeropsCandidates(): {
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { activeOrganization, client, organizationStatus, status } = useZeropsSession();
  const { environments } = useEnvironments();
  const [projects, setProjects] = useState<ReadonlyArray<ZeropsProject>>([]);
  const [services, setServices] = useState<ReadonlyMap<string, ZeropsCandidateServiceOutcome>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Bumped per load so a superseded run's callbacks become no-ops.
  const generationRef = useRef(0);
  const organizationId = activeOrganization?.id ?? null;

  useEffect(() => {
    if (status !== "signed-in" || organizationStatus !== "selected" || !organizationId) {
      setProjects([]);
      setServices(new Map());
      setIsLoading(false);
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const isCancelled = () => generationRef.current !== generation;

    setIsLoading(true);
    setError(null);
    setProjects([]);
    setServices(new Map());

    loadZeropsCandidates(client, {
      organizationIds: [organizationId],
      connectedOrigins: NO_CONNECTED_ORIGINS,
      isCancelled,
      onProjectsLoaded: (loaded) => {
        if (isCancelled()) return;
        setProjects(loaded);
      },
      onServiceOutcome: (project, outcome) => {
        if (isCancelled()) return;
        setServices((current) => new Map(current).set(project.id, outcome));
      },
    })
      .then((result) => {
        if (isCancelled()) return;
        const failure = result.failures[0];
        if (failure) setError(zeropsErrorMessage(failure.cause));
        setIsLoading(false);
      })
      .catch((cause: unknown) => {
        if (isCancelled()) return;
        setError(zeropsErrorMessage(cause));
        setIsLoading(false);
      });

    return () => {
      generationRef.current += 1;
    };
  }, [client, status, organizationStatus, organizationId, reloadCount]);

  const connectedOrigins = useMemo(() => authenticatedZeropsOrigins(environments), [environments]);
  const connectionsByOrigin = useMemo(
    () => zeropsConnectionsByOrigin(environments),
    [environments],
  );

  const candidates = useMemo(() => {
    const derived: ZeropsCandidate[] = [];
    for (const project of projects) {
      if (project.status !== "ACTIVE") {
        // The derivation short-circuits on the project's own status; a
        // non-active project's services are never fetched or read.
        derived.push(...deriveZeropsCandidates(project, null, connectedOrigins));
        continue;
      }
      const outcome = services.get(project.id);
      // Still resolving: omitted while `isLoading` is true, so the list grows
      // rather than showing a per-row spinner.
      if (!outcome) continue;
      derived.push(
        ...deriveZeropsCandidates(
          project,
          outcome.status === "resolved" ? outcome.services : null,
          connectedOrigins,
        ),
      );
    }
    return derived.map((candidate): ZeropsCandidatePresentation => {
      const origin = candidate.containerOrigin ? normalizeOrigin(candidate.containerOrigin) : null;
      const connection = origin === null ? undefined : connectionsByOrigin.get(origin);
      return connection === undefined ? candidate : { ...candidate, connection };
    });
  }, [projects, services, connectedOrigins, connectionsByOrigin]);

  const refresh = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  return { candidates, isLoading, error, refresh };
}
