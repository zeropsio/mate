/** Web projection over the active organization's shared project/service records. */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { useCallback, useMemo } from "react";

import {
  derivePublicRouteOffers,
  derivePublicRoutes,
  summarizeEnvironmentServices,
  type ZeropsEnvironmentServices,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { presentCandidates, type CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/unstable/reactivity";

import { candidateRowsAtom, zeropsEnvironmentsAtom, zeropsInventoryAtom } from "../state/zerops";
import { invalidateZerops } from "./accountInvalidations";
import { useZeropsInventory } from "./inventoryContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { useZeropsData } from "./zeropsDataContext";

export interface ZeropsCandidatePresentation extends CandidateRow {
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

/**
 * A ready candidate whose origin a connected environment serves is connected
 * to it. `selectCandidates` mixes no socket phase in; this is the join.
 */
export function withZeropsConnection(
  row: CandidateRow,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): CandidateRow {
  if (row.group !== "ready" || row.containerOrigin === undefined) return row;
  const environmentId = connectedOrigins.get(
    normalizeOrigin(row.containerOrigin) ?? row.containerOrigin,
  );
  return environmentId === undefined ? row : { ...row, group: "connected", environmentId };
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
const NO_SERVICES: ZeropsEnvironmentServices = {
  hostnames: [],
  deployedAt: undefined,
  deployable: [],
};

/**
 * The active organization's candidates as knowledge (DESIGN §3): the rows
 * (`candidateRowsAtom`), each ready one joined with the environment connected
 * at its origin, and presented with its routes and services off the account's
 * inventory; withheld as the rows are. Derived, with no writer: it reads the
 * account's registry, which starts over when the account closes.
 */
export const candidateListingAtom = Atom.make(
  (get): Shown<ReadonlyArray<ZeropsCandidatePresentation>> => {
    const rows = get(candidateRowsAtom);
    const inventory = get(zeropsInventoryAtom);
    const environments = get(zeropsEnvironmentsAtom);
    const connectedOrigins = authenticatedZeropsOrigins(environments);
    const connectionsByOrigin = zeropsConnectionsByOrigin(environments);
    return presentCandidates(rows, (row): ZeropsCandidatePresentation => {
      const candidate = withZeropsConnection(row, connectedOrigins);
      const project = inventory?.projects.find((entry) => entry.id === candidate.project.id);
      const outcome = inventory?.services.get(candidate.project.id);
      const resolved = outcome?.status === "resolved" ? outcome.services : null;
      const routes =
        project === undefined || resolved === null
          ? undefined
          : derivePublicRoutes(project, resolved);
      const routeOffers = resolved === null ? undefined : derivePublicRouteOffers(resolved);
      const held = resolved === null ? undefined : summarizeEnvironmentServices(resolved);
      const origin = candidate.containerOrigin ? normalizeOrigin(candidate.containerOrigin) : null;
      const connection = origin === null ? undefined : connectionsByOrigin.get(origin);
      return {
        ...candidate,
        ...(candidate.project.status === "ACTIVE"
          ? routes === undefined || held === undefined
            ? {}
            : { routes, routeOffers: routeOffers ?? [], services: held }
          : { routes: [], services: NO_SERVICES }),
        ...(connection === undefined ? {} : { connection }),
      };
    });
  },
).pipe(Atom.withLabel("zerops:candidate-listing"));

export function useZeropsCandidates(): {
  /**
   * The active organization's candidates as knowledge (DESIGN §3), and the
   * only way they are handed out: a surface reads it through the
   * `projections` selectors (`heldCandidates`, `findCandidate`,
   * `takenBotNames`, `candidatesNotice`), so "no projects" is only ever read
   * off a known, complete listing. A re-read keeps the list already read up
   * while the fresh baseline lands.
   */
  readonly listing: Shown<ReadonlyArray<ZeropsCandidatePresentation>>;
  /** A read is in flight: the header's spinner, never a reason to paint less. */
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const inventory = useZeropsInventory();
  const listing = useAtomValue(candidateListingAtom);
  const canLoad = status === "signed-in" && organizationStatus === "selected";
  const isLoading = inventory.isLoading || !canLoad;
  const activeOrganizationRef = useMemo(
    () => (activeOrganization === null ? null : organizationRef(activeOrganization.id)),
    [activeOrganization, organizationRef],
  );

  // The header's reload: the active organization's inventory is read again (DESIGN §6.2).
  const refresh = useCallback(() => {
    if (activeOrganizationRef === null) return;
    invalidateZerops({ topic: "inventory", organization: activeOrganizationRef });
  }, [activeOrganizationRef]);

  return { listing, isLoading, error: inventory.error, refresh };
}
