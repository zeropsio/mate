/**
 * A Mate HQ places that Zerops' search does not list yet is read by its id. The search trails a
 * project just made and the grants given to it (`zerops/api.ts`, `readAccessibleClientProjects`),
 * while HQ sends a Mate to the people who may read it as soon as it is placed: its own row, read
 * by its id, is Zerops' word that this viewer reads it, and the roster lists it from that row
 * (`projections/projects.ts`) until the search names it too.
 *
 * Navigation demand, held by the account for the organization shown, never by a screen: from the
 * roster's first answer, for as long as HQ places the Mate.
 *
 * @module data/placedRows
 */
import type { DetailDemand } from "./demand.ts";
import { placementsScope, type PlacementValue } from "./families/hqNavigation.ts";
import { projectsScope } from "./families/project.ts";
import { organizationProjects } from "./projections/projects.ts";
import { readsOfState, type AccountStore, type ProjectionReads } from "./store.ts";

/** The projects HQ places as Mates in the organization. */
export function placedMates(read: ProjectionReads, orgId: string): ReadonlyArray<string> {
  return read.members(placementsScope(orgId)).ids.filter((id) => {
    const fact = read.fact("placement", id);
    return fact.kind === "known" && (fact.value as PlacementValue).mate != null;
  });
}

/**
 * The Mates HQ places whose own row is wanted: those the roster, once answered, does not name —
 * listed, still leaving, or refused.
 */
export function placedRowsWanted(read: ProjectionReads, orgId: string): ReadonlyArray<string> {
  if (organizationProjects.derive(read, orgId).read !== "read") return [];
  const { ids, unverified, excluded } = read.members(projectsScope(orgId));
  const named = new Set([...ids, ...unverified, ...excluded]);
  return placedMates(read, orgId).filter((id) => !named.has(id));
}

/** Holds each wanted Mate's own row while HQ places it; the result lets every hold go. */
export function holdPlacedProjectRows(options: {
  readonly store: AccountStore;
  readonly orgId: string;
  readonly demandDetail: (demand: DetailDemand) => () => void;
}): () => void {
  const { store, orgId } = options;
  const held = new Map<string, () => void>();

  // A hold moves the store, which calls back here: that call only asks for one more pass.
  let running = false;
  let again = false;
  const reconcile = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        pass();
      } while (again);
    } finally {
      running = false;
    }
  };

  const pass = () => {
    const read = readsOfState(store.state());
    const placed = new Set(placedMates(read, orgId));
    // Kept once the search names it too: letting the own row go would forget a value the roster
    // still draws from until the listing's row replaces it.
    for (const [projectId, release] of held)
      if (!placed.has(projectId)) {
        held.delete(projectId);
        release();
      }
    for (const projectId of placedRowsWanted(read, orgId))
      if (!held.has(projectId))
        held.set(
          projectId,
          options.demandDetail({ family: "project", listing: "project", ownerId: projectId }),
        );
  };

  const stopListening = store.subscribe(reconcile);
  reconcile();
  return () => {
    stopListening();
    for (const release of held.values()) release();
    held.clear();
  };
}
