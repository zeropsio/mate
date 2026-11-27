/**
 * Every project read by its id that navigation needs, held by the account for the organization
 * shown, never by a screen: from the roster's first answer, for as long as HQ's navigation names
 * it — a placement, an environment's project, an open birth's project or a press.
 *
 * - A project navigation names that the roster does not name: a Mate just placed, a birth's
 *   project just made, drawn with its facts once read (`projections/menuTree.ts`). The roster's
 *   `/project/search` read (`families/project.ts`, `adapters/zerops.ts`) trails a project just
 *   made and the grants given to it, while HQ sends a Mate to the people who may read it as soon
 *   as it is placed: its own row is Zerops' word that this viewer reads it, and the roster lists
 *   it from that row (`projections/projects.ts`) until the search names it too.
 * - A placed Mate whose listing does not decide a No-access viewer's access: its listing row names
 *   no grant of theirs, so only its own row says whether they read or open it
 *   (`projections/projects.ts`, `ownRowWanted`).
 *
 * A Mate Zerops is verifying gone, or has refused, is never read here: that verification is its
 * one read.
 *
 * @module data/placedRows
 */
import type { DetailDemand } from "./demand.ts";
import { hqAppsScope, hqBirthsScope, placementsScope } from "./families/hqNavigation.ts";
import { projectsScope } from "./families/project.ts";
import { platformMembership } from "./projections/platformCapabilities.ts";
import { organizationProjects, ownRowWanted } from "./projections/projects.ts";
import { readsOfState, type AccountStore, type ProjectionReads } from "./store.ts";

/**
 * The projects HQ's navigation names in the organization: each it places, each of its
 * applications' environments' and open births' projects, and each birth's in no application. A
 * project the person's token does not reach (`hiddenEnvironments`) is not read.
 */
function namedProjects(read: ProjectionReads, orgId: string): ReadonlyArray<string> {
  const named = new Set(read.members(placementsScope(orgId)).ids);
  for (const id of read.members(hqBirthsScope(orgId)).ids) {
    const birth = read.fact("hqBirth", id);
    if (birth.kind === "known" && birth.value.projectId != null) named.add(birth.value.projectId);
  }
  for (const id of read.members(hqAppsScope(orgId)).ids) {
    const app = read.fact("hqApp", id);
    if (app.kind !== "known") continue;
    for (const birth of app.value.births ?? [])
      if (birth.projectId != null) named.add(birth.projectId);
    for (const environment of app.value.environments ?? [])
      if (environment.target.kind === "zerops") named.add(environment.target.projectId);
  }
  return [...named];
}

/**
 * The projects navigation names whose own row is wanted: those the roster, once answered, does not name —
 * listed, still leaving, or refused — and those it lists whose listing leaves a No-access
 * viewer's access unsaid. That listing is judged only while the roster is not being read again:
 * a re-read may be the one that drops the Mate, and Zerops verifying it gone is then its read.
 */
function placedRowsWanted(read: ProjectionReads, orgId: string): ReadonlyArray<string> {
  if (organizationProjects.derive(read, orgId).read !== "read") return [];
  const { ids, unverified, excluded, reading } = read.members(projectsScope(orgId));
  const listed = new Set(ids);
  const named = new Set([...ids, ...unverified, ...excluded]);
  const viewerRole = platformMembership.derive(read, orgId).viewer?.roleCode;
  return namedProjects(read, orgId).filter((id) => {
    if (!named.has(id)) return true;
    if (!listed.has(id) || reading) return false;
    // A listed row not read yet is already being read by the roster; its listing is judged once read.
    const row = read.fact("project", id);
    return row.kind === "known" && ownRowWanted(viewerRole, row.value);
  });
}

/** Holds each wanted project's own row while navigation names it; the result lets every hold go. */
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
    const named = new Set(namedProjects(read, orgId));
    // Kept once the search names it too: letting the own row go would forget a value the roster
    // still draws from until the listing's row replaces it.
    for (const [projectId, release] of held)
      if (!named.has(projectId)) {
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
