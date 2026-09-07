import { useZeropsInventory } from "./ZeropsInventoryProvider";
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
import { useCallback, useEffect, useMemo } from "react";

import {
  derivePublicRouteOffers,
  derivePublicRoutes,
  summarizeEnvironmentServices,
  type ZeropsEnvironmentServices,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";

import { useEnvironments } from "../state/environments";
import {
  deriveZeropsCandidates,
  normalizeOrigin,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { zeropsEnvironmentNamesAtom, zeropsMatesAtom } from "../state/zerops";
import { writeCachedZeropsMates } from "./mateIdentitiesCache";
import { refreshZeropsCandidates } from "./candidatesRefresh";
import { zeropsEnvironmentNames } from "./environmentNames";
import { zeropsMateIdentities } from "./mateIdentities";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface ZeropsCandidatePresentation extends ZeropsCandidate {
  readonly connection?: EnvironmentConnectionPresentation;
  /**
   * Where the environment is reachable from outside, read off the same
   * service list the candidate came from. Absent while that list is unread
   * (a project whose services failed to load), so a row can tell "unknown"
   * from "none".
   */
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  /** Services that serve HTTP with their subdomain off (`publicRoutes.ts`). */
  readonly routeOffers?: ReadonlyArray<ZeropsRouteOffer>;
  /**
   * What the environment holds — the developer's services and when its code
   * last landed — read off the same list. Absent while it is unread, like
   * `routes`.
   */
  readonly services?: ZeropsEnvironmentServices;
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

/** Every registered environment keyed by origin, socket up or not — who lives where is known before it connects. */
function registeredZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (!environment.displayUrl) continue;
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

/** A project that is not up holds nothing anyone deployed. */
const NO_SERVICES: ZeropsEnvironmentServices = { hostnames: [], deployedAt: undefined };

export function useZeropsCandidates(): {
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  const { environments } = useEnvironments();
  const inventory = useZeropsInventory();
  const projects = useMemo(
    () => inventory.projects.filter((project) => project.clientId === activeOrganization?.id),
    [inventory.projects, activeOrganization?.id],
  );
  const { services, error } = inventory;
  const canLoad = status === "signed-in" && organizationStatus === "selected";
  const isLoading = inventory.isLoading || !canLoad;

  const connectedOrigins = useMemo(() => authenticatedZeropsOrigins(environments), [environments]);
  const connectionsByOrigin = useMemo(
    () => zeropsConnectionsByOrigin(environments),
    [environments],
  );
  const registeredOrigins = useMemo(() => registeredZeropsOrigins(environments), [environments]);

  const candidates = useMemo(() => {
    const derived: ZeropsCandidatePresentation[] = [];
    for (const project of projects) {
      if (project.status !== "ACTIVE") {
        // The derivation short-circuits on the project's own status; a
        // non-active project's services are never fetched or read, and a
        // project that is not up has no route yet.
        derived.push(
          ...deriveZeropsCandidates(project, null, connectedOrigins).map((candidate) => ({
            ...candidate,
            routes: [],
            services: NO_SERVICES,
          })),
        );
        continue;
      }
      const outcome = services.get(project.id);
      // Still resolving: omitted while `isLoading` is true, so the list grows
      // rather than showing a per-row spinner.
      if (!outcome) continue;
      const resolved = outcome.status === "resolved" ? outcome.services : null;
      const routes = resolved === null ? undefined : derivePublicRoutes(project, resolved);
      const routeOffers = resolved === null ? undefined : derivePublicRouteOffers(resolved);
      const held = resolved === null ? undefined : summarizeEnvironmentServices(resolved);
      derived.push(
        ...deriveZeropsCandidates(project, resolved, connectedOrigins).map((candidate) =>
          routes === undefined || held === undefined
            ? candidate
            : { ...candidate, routes, routeOffers: routeOffers ?? [], services: held },
        ),
      );
    }
    return derived.map((candidate): ZeropsCandidatePresentation => {
      const origin = candidate.containerOrigin ? normalizeOrigin(candidate.containerOrigin) : null;
      const connection = origin === null ? undefined : connectionsByOrigin.get(origin);
      return connection === undefined ? candidate : { ...candidate, connection };
    });
  }, [projects, services, connectedOrigins, connectionsByOrigin]);

  // Publish the environments' names, and who lives in each, for readers that
  // never load candidates (`useZeropsEnvironmentNames`, `useZeropsMates`). A
  // reload starts from an empty list; what they had stays up until the new
  // list carries some. Nothing is published while the session is still being
  // checked or the organisation picked: an empty answer then would be a
  // guess, and the surfaces that wait on `zeropsMatesAtom` would paint their
  // other look for the first second of every reload.
  useEffect(() => {
    if (status === "loading" || status === "totp-required") return;
    if (status === "signed-in" && !canLoad) return;
    const names = zeropsEnvironmentNames(candidates);
    if (isLoading && names.size === 0) return;
    const mates = zeropsMateIdentities(candidates, registeredOrigins);
    appAtomRegistry.set(zeropsEnvironmentNamesAtom, names);
    appAtomRegistry.set(zeropsMatesAtom, mates);
    // Remembered across reloads, so the next one knows who lives where from
    // its first frame (`zeropsMatesAtom` starts from this).
    writeCachedZeropsMates(mates);
  }, [candidates, canLoad, isLoading, registeredOrigins, status]);

  const refresh = useCallback(() => {
    refreshZeropsCandidates();
  }, []);

  return { candidates, isLoading, error, refresh };
}
