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
import {
  presentCandidates,
  heldCandidates,
  type CandidateRow,
  type TakenBotNames,
} from "@t3tools/client-runtime/zerops/projections";
import { projectServicesAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";

import {
  mateRowsAtom,
  candidateListingWholeAtom,
  takenBotNamesAtom,
  zeropsEnvironmentsAtom,
} from "../state/zerops";
import { sameValue } from "../lib/sameValue";
import { invalidateZerops } from "./accountInvalidations";
import { useAccountDataOptional } from "./ZeropsAccountData";
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

/**
 * Connected environments, keyed the two ways a candidate row can meet one: by the Zerops project
 * its own descriptor names (one Mate per project), and by origin for one whose descriptor is not
 * read yet.
 */
export interface ZeropsConnections {
  /** Projects exactly one connected environment names; two naming one leave it to the origin. */
  readonly byProject: ReadonlyMap<string, EnvironmentId>;
  /** Origins of connected environments whose descriptor names no project, or one claimed twice. */
  readonly byOrigin: ReadonlyMap<string, EnvironmentId>;
}

/** Authenticated environments by project and by origin, so a candidate row can be matched. */
export function authenticatedZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
    readonly zeropsProjectId?: string | null | undefined;
    readonly connection: { readonly phase: EnvironmentConnectionPhase };
  }>,
): ZeropsConnections {
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const claims = new Map<string, number>();
  for (const { zeropsProjectId } of connected)
    if (typeof zeropsProjectId === "string")
      claims.set(zeropsProjectId, (claims.get(zeropsProjectId) ?? 0) + 1);
  const byProject = new Map<string, EnvironmentId>();
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of connected) {
    // The project its descriptor names is the match, unless two claim it: then its origin decides.
    const projectId = environment.zeropsProjectId;
    if (typeof projectId === "string" && claims.get(projectId) === 1) {
      byProject.set(projectId, environment.environmentId);
      continue;
    }
    const origin = environment.displayUrl ? normalizeOrigin(environment.displayUrl) : null;
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return { byProject, byOrigin };
}

/**
 * A ready candidate a connected environment serves is connected to it: the one whose descriptor
 * names its project, else the one at its container's origin while no descriptor says. Milo's
 * conversation found it by its environment while /zerops, matching by origin alone, called it
 * unconnected (2026-10-10). `selectCandidates` mixes no socket phase in; this is the join.
 */
export function withZeropsConnection(
  row: CandidateRow,
  connections: ZeropsConnections,
): CandidateRow {
  if (row.group !== "ready") return row;
  const origin =
    row.containerOrigin === undefined
      ? undefined
      : (normalizeOrigin(row.containerOrigin) ?? row.containerOrigin);
  const environmentId =
    connections.byProject.get(row.project.id) ??
    (origin === undefined ? undefined : connections.byOrigin.get(origin));
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
  statuses: [],
};

/**
 * The active organization's candidates as knowledge (DESIGN §3): the rows
 * (`mateRowsAtom`), each ready one joined with the environment connected
 * at its origin, and presented with its routes and services off the organization's
 * services listing; withheld as the rows are. Derived, with no writer: it reads the
 * account's registry, which starts over when the account closes.
 */
export const candidateListingAtom = Atom.make(
  (get): Shown<ReadonlyArray<ZeropsCandidatePresentation>> => {
    const rows = get(mateRowsAtom);
    const environments = get(zeropsEnvironmentsAtom);
    const connectedOrigins = authenticatedZeropsOrigins(environments);
    const connectionsByOrigin = zeropsConnectionsByOrigin(environments);
    return presentCandidates(rows, (row): ZeropsCandidatePresentation => {
      const candidate = withZeropsConnection(row, connectedOrigins);
      const resolved = get(projectServicesAtom(candidate.project.id)).services ?? null;
      const routes =
        resolved === null ? undefined : derivePublicRoutes(candidate.project, resolved);
      const routeOffers = resolved === null ? undefined : derivePublicRouteOffers(resolved);
      const held = resolved === null ? undefined : summarizeEnvironmentServices(resolved);
      const origin = candidate.containerOrigin ? normalizeOrigin(candidate.containerOrigin) : null;
      // The environment it is connected to speaks for its connection; else the one at its origin.
      const connection =
        (candidate.environmentId === undefined
          ? undefined
          : environments.find((entry) => entry.environmentId === candidate.environmentId)
              ?.connection) ?? (origin === null ? undefined : connectionsByOrigin.get(origin));
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

export const heldCandidateRowsAtom = Atom.make(
  (get) => heldCandidates(get(candidateListingAtom)).rows,
).pipe(Atom.withEquality(sameValue));

/** Held rows for readers that draw content, without claiming the listing is fresh or complete. */
export function useHeldZeropsCandidates() {
  return useAtomValue(heldCandidateRowsAtom);
}

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
  /** Every project this person can see is accounted for, even while containers are unread. */
  readonly wholeForPerson: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const inventory = useZeropsInventory();
  const listing = useAtomValue(candidateListingAtom);
  const wholeForPerson = useAtomValue(candidateListingWholeAtom);
  const canLoad = status === "signed-in" && organizationStatus === "selected";
  const isLoading = inventory.isLoading || !canLoad;
  const activeOrganizationRef = useMemo(
    () => (activeOrganization === null ? null : organizationRef(activeOrganization.id)),
    [activeOrganization, organizationRef],
  );

  // The header's reload, and a refused listing's Try again: the account's store asks again — a
  // refusal it holds revives only so — and the active organization's inventory is read again
  // (DESIGN §6.2).
  const retryAccount = useAccountDataOptional()?.retry;
  const refresh = useCallback(() => {
    retryAccount?.();
    if (activeOrganizationRef === null) return;
    invalidateZerops({ topic: "inventory", organization: activeOrganizationRef });
  }, [activeOrganizationRef, retryAccount]);

  return { listing, wholeForPerson, isLoading, error: inventory.error, refresh };
}

/**
 * The names the active organization's Mates go by, and whether its project list is read whole
 * (`takenBotNamesAtom`): judged as soon as that list is known, never waiting on any project's
 * services or its admission.
 */
export function useTakenBotNames(): TakenBotNames {
  return useAtomValue(takenBotNamesAtom);
}
