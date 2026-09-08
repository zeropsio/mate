import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { projectZeropsCandidates } from "@t3tools/client-runtime/zerops/candidateLoading";
import {
  OrganizationRef,
  projectKeyOf,
  type InterestLease,
  type ProjectRef,
  ZeropsOrganizationId,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useEnvironments } from "../../state/environments";
import { candidateAfterHealthProbe, probeCandidateHealthBatch } from "./candidate-loading";
import { connectedZeropsOrigins } from "./candidate-origins";
import { useZeropsData } from "./ZeropsDataProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

export function useZeropsCandidates(): {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { status, organizations } = useZeropsSession();
  const { binding, error: runtimeError } = useZeropsData();
  const { environments } = useEnvironments();
  const [candidates, setCandidates] = useState<ReadonlyArray<ZeropsCandidate>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const organizationIdsKey = organizations.map((organization) => organization.id).join(",");
  const connectedOrigins = useMemo(() => connectedZeropsOrigins(environments), [environments]);

  useEffect(() => {
    if (status !== "signed-in" || binding === null) {
      setCandidates([]);
      setIsLoading(false);
      setError(runtimeError?.message ?? null);
      return;
    }

    let cancelled = false;
    let scope: Scope.Closeable | null = null;
    let scopeClosed = false;
    let healthGeneration = 0;
    let lastHealthOriginsKey: string | null = null;
    const lastHealthByKey = new Map<string, ZeropsContainerHealth>();
    const inventoryLeases = new Map<string, InterestLease>();
    const pendingInventory = new Map<string, Promise<InterestLease>>();
    const projectUnsubscribes: Array<() => void> = [];
    const serviceUnsubscribes = new Map<string, () => void>();
    let desiredInventory = new Map<string, ProjectRef>();
    const organizationRefs = organizations.map((organization): OrganizationRef => ({
      kind: "organization",
      account: binding.account.account,
      organizationId: ZeropsOrganizationId.make(organization.id),
    }));

    // Scope creation is asynchronous. Cleanup can win that race, so closing is
    // centralized and guarded before this hook starts any demand acquisition.
    const closeScope = (target: Scope.Closeable) => {
      if (scopeClosed) return;
      scopeClosed = true;
      void Effect.runPromise(Scope.close(target, Exit.void));
    };

    const unsubscribeAll = () => {
      for (const unsubscribe of projectUnsubscribes) unsubscribe();
      projectUnsubscribes.length = 0;
      for (const unsubscribe of serviceUnsubscribes.values()) unsubscribe();
      serviceUnsubscribes.clear();
    };

    const reconcileInventoryDemand = () => {
      for (const [key, lease] of inventoryLeases) {
        if (desiredInventory.has(key)) continue;
        inventoryLeases.delete(key);
        void Effect.runPromise(lease.release);
      }
      if (scope === null) return;
      for (const [key, project] of desiredInventory) {
        if (inventoryLeases.has(key) || pendingInventory.has(key)) continue;
        const pending = Effect.runPromise(
          binding.runtime
            .acquire({ kind: "project-inventory", project })
            .pipe(Scope.provide(scope)),
        );
        pendingInventory.set(key, pending);
        void pending.then(
          (lease) => {
            pendingInventory.delete(key);
            if (cancelled || !desiredInventory.has(key)) {
              void Effect.runPromise(lease.release);
              return;
            }
            inventoryLeases.set(key, lease);
            setError(null);
            publish();
          },
          (cause: unknown) => {
            pendingInventory.delete(key);
            if (cancelled) return;
            setError(cause instanceof Error ? cause.message : "Could not load Zerops projects.");
            setIsLoading(false);
          },
        );
      }
    };

    const synchronizeServiceSubscriptions = () => {
      for (const [key, unsubscribe] of serviceUnsubscribes) {
        if (desiredInventory.has(key)) continue;
        unsubscribe();
        serviceUnsubscribes.delete(key);
      }
      for (const [key, project] of desiredInventory) {
        if (serviceUnsubscribes.has(key)) continue;
        serviceUnsubscribes.set(
          key,
          binding.registry.subscribe(binding.runtime.reads.servicesOf(project), publish, {
            immediate: false,
          }),
        );
      }
    };

    const publish = () => {
      if (cancelled) return;
      const projections = organizationRefs.map((organization) =>
        projectZeropsCandidates(
          binding.registry.get(binding.runtime.reads.projectsOf(organization)),
          (project) => {
            const services = binding.registry.get(binding.runtime.reads.servicesOf(project.ref));
            // A service collection only becomes a candidate inventory once this
            // view owns its project inventory interest. The organization baseline alone
            // cannot establish existing service membership.
            return inventoryLeases.has(projectKeyOf(project.ref))
              ? services
              : ({
                  ...services,
                  query: { ...services.query, status: "unresolved" },
                } as typeof services);
          },
          connectedOrigins,
        ),
      );
      desiredInventory = new Map(
        projections.flatMap((projection) =>
          projection.projects.value.flatMap((project) =>
            project.knowledge === "observed" &&
            project.record.lifecycle.knowledge === "observed" &&
            project.record.lifecycle.fields.status === "ACTIVE"
              ? [[projectKeyOf(project.record.ref), project.record.ref] as const]
              : [],
          ),
        ),
      );
      synchronizeServiceSubscriptions();
      reconcileInventoryDemand();
      const platformCandidates = projections.flatMap((projection) => projection.candidates);
      setCandidates(
        platformCandidates.map((candidate) =>
          candidateAfterHealthProbe(candidate, lastHealthByKey.get(candidate.key)),
        ),
      );
      setIsLoading(
        projections.some(
          (projection) =>
            projection.projects.query.status !== "observed" ||
            projection.unresolvedProjects.length > 0 ||
            projection.unresolvedServiceProjects.length > 0,
        ),
      );
      const ready = platformCandidates.filter(
        (candidate): candidate is ZeropsCandidate & { readonly containerOrigin: string } =>
          candidate.group === "ready" && candidate.containerOrigin !== undefined,
      );
      const readyOriginsKey = ready
        .map((candidate) => candidate.containerOrigin)
        .sort()
        .join(",");
      // Re-probing on every publish re-hits containers whose reachability has not
      // changed; only the ready-origin set moving is a reason to ask again.
      if (readyOriginsKey === lastHealthOriginsKey) return;
      lastHealthOriginsKey = readyOriginsKey;
      const generation = ++healthGeneration;
      void probeCandidateHealthBatch(ready).then((results) => {
        if (cancelled || generation !== healthGeneration) return;
        const healthByKey = new Map(results.map((result) => [result.candidate.key, result]));
        for (const [key, result] of healthByKey) lastHealthByKey.set(key, result.health);
        setCandidates((current) =>
          current.map((candidate) => {
            const result = healthByKey.get(candidate.key);
            return result === undefined
              ? candidate
              : candidateAfterHealthProbe(result.candidate, result.health);
          }),
        );
      });
    };

    // Inventory ownership remains in the shared runtime. These leases only
    // state the candidate view's interest; this hook performs no platform I/O.
    setIsLoading(true);
    setError(null);
    setCandidates([]);

    void Effect.runPromise(Scope.make()).then(async (nextScope) => {
      scope = nextScope;
      if (cancelled) {
        closeScope(nextScope);
        return;
      }
      try {
        await Promise.all(
          organizationRefs.map((organization) =>
            Effect.runPromise(
              binding.runtime
                .acquire({ kind: "organization-inventory", organization })
                .pipe(Scope.provide(nextScope)),
            ),
          ),
        );
        if (cancelled) return;
        projectUnsubscribes.push(
          ...organizationRefs.map((organization) =>
            binding.registry.subscribe(binding.runtime.reads.projectsOf(organization), publish, {
              immediate: false,
            }),
          ),
        );
        publish();
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load Zerops projects.");
          setIsLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAll();
      desiredInventory = new Map();
      for (const lease of inventoryLeases.values()) void Effect.runPromise(lease.release);
      inventoryLeases.clear();
      if (scope !== null) closeScope(scope);
    };
  }, [binding, connectedOrigins, organizationIdsKey, reloadCount, runtimeError, status]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);
  return { candidates, isLoading, error, refresh };
}
