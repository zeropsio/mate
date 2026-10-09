import {
  connectionCatalogDisplayUrl,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  projectKeyOf,
  ZeropsProjectId,
  type OrganizationRef,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import { mateListingsAtom } from "@t3tools/client-runtime/zerops/environments";
import { placeListing, type HqMates, type HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import type { Known, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import {
  admittedOnly,
  takenBotNames,
  type TakenBotNames,
  heldCandidates,
  type CandidateRow,
} from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId } from "@t3tools/contracts";
import type { HqPeople } from "@t3tools/shared/hqMates";
import * as Option from "effect/Option";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { Atom } from "effect/reactivity";
import {
  inventoryTopology,
  EMPTY_PROJECT_TOPOLOGY_SNAPSHOT,
  type ProjectTopologySnapshot,
  accountReadsAtom,
  inventoryContents,
  inventoryPlacements,
  inventoryPlacementStatus,
  shownHqMatesAtom,
  shownHqNavigationAtom,
  shownHqStatusAtom,
  shownProjectsAtom,
  type HqNavigationRead,
} from "@t3tools/client-runtime/data";

import { sameValue } from "../lib/sameValue";
import type { HqStanding } from "../zerops/accountHq";
import { registeredZeropsOrigins, rowEnvironment } from "../zerops/environmentOrigins";
export { zeropsFeeds } from "../zerops/feeds";
import { findInventoryProjectRef, type InventoryProjection } from "@t3tools/client-runtime/data";
import type {
  ZeropsOrganizationStatus,
  ZeropsSessionStatus,
} from "../zerops/ZeropsSessionProvider";
import { environmentPresentations } from "./presentation";

/**
 * `deriveZeropsThreadModel`, re-exported from thread state alongside the
 * other Zerops derivations this module owns. Not an Effect `Atom` in its
 * own right — the model has no subscription to hold: it is a pure
 * projection of activities (already local component state) and the
 * lifecycle feed (`useZeropsLifecycle`), so the caller memoizes it on
 * reference identity the same way it memoizes every other thread
 * derivation (`useMemo`), rather than this module owning a second copy of
 * that state behind an atom.
 */
export { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";

/**
 * Published session and presentation atoms belong to the account's registry and end with it.
 * Platform facts are read through data-layer projections in the derivations below.
 */
/** The Zerops session as the account's product last saw it, and the organization it shows. */
export interface ZeropsSessionView {
  readonly status: ZeropsSessionStatus;
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly activeOrganization: OrganizationRef | null;
}

/** Published beside the runtime; null before the account's product is mounted. */
export const zeropsSessionAtom = Atom.make<ZeropsSessionView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:session"),
);

/**
 * HQ's navigation of the organization in view (`@t3tools/client-runtime/data` `hqNavigation`): its
 * applications and where HQ places each project, as the account's store holds them.
 */
export const hqNavigationAtom = shownHqNavigationAtom;
export type HqNavigationView = HqNavigationRead & { readonly orgId: string | null };

/** HQ stopped answering what it answered: catching up, refused, or its retries capped. */
export const hqDown = (
  view: Pick<HqNavigationRead, "live" | "reconnecting" | "capped" | "refusal">,
): boolean => !view.live && (view.reconnecting || view.capped || view.refusal !== null);

/**
 * When HQ stopped answering the organization in view, as this tab first saw it (wall ms): said, never
 * decided over. Null while HQ answers, or before it ever did.
 */
export const hqDownSinceAtom = Atom.make((get): number | null => {
  const navigation = get(shownHqNavigationAtom);
  const down = navigation.read === "read" && !navigation.live;
  return down ? (Option.getOrNull(get.self<number | null>()) ?? Date.now()) : null;
}).pipe(Atom.keepAlive, Atom.withLabel("zerops:hq-down-since"));

const HQ_STANDING_UNKNOWN: HqStanding = { kind: "unknown" };

/**
 * Where the organization in view's HQ stands, as its navigation says it (SPEC §4): serving — with
 * the Core it runs and its parts — while it answers, unavailable while it does not; no read of its
 * own, nothing on a timer.
 */
export const hqStandingAtom = Atom.make((get): HqStanding => {
  const navigation = get(shownHqNavigationAtom);
  const since = get(hqDownSinceAtom);
  if (since !== null || navigation.refusal !== null)
    return { kind: "unavailable", since: since ?? Date.now() };
  const organization = navigation.organization;
  const status = get(shownHqStatusAtom);
  if (!navigation.live || organization === null || status === null) return HQ_STANDING_UNKNOWN;
  // HQ that is not the official one, as its own check of Zerops says, stands as unavailable.
  if (status.official !== null && status.official !== "ok" && status.official !== "unknown")
    return { kind: "unavailable", since: since ?? Date.now() };
  return {
    kind: status.official === "unknown" ? "unchecked" : "healthy",
    build: organization.build,
    parts: status.parts,
  };
}).pipe(Atom.withLabel("zerops:hq-standing"));

/**
 * Where HQ places each project of the organization in view, as last known; null while nothing
 * is known of its structure — placement is unread, not ungrouped. A stage's or a production's
 * project HQ holds nowhere is placed by its press's record, unregistered (`placementsOf`).
 */
export const hqPlacementsAtom = Atom.make((get): ReadonlyMap<string, HqPlacement> | null => {
  const account = get(accountReadsAtom);
  return account?.orgId == null
    ? null
    : get(account.data.project(inventoryPlacements, account.orgId));
}).pipe(Atom.withLabel("zerops:hq-placements"));

/** Coverage of HQ placement; an app baseline alone cannot prove an ungrouped row. */
export const hqPlacementStatusAtom = Atom.make((get) => {
  const account = get(accountReadsAtom);
  return account?.orgId == null
    ? { complete: false, live: false, reconnecting: false }
    : get(account.data.project(inventoryPlacementStatus, account.orgId));
}).pipe(Atom.withLabel("zerops:hq-placement-status"));

/**
 * The Mates the reader may observe, as HQ relays them (`hqMates`): each by its project, its
 * presence and its overview's sections.
 */
export interface HqMatesView {
  readonly organizationId: string;
  readonly mates: HqMates;
  /** HQ relays them now; else what was last known of them, and none of them is live. */
  readonly current: boolean;
}

/** The Mates of the organization in view, as HQ last told them; null without one in view. */
export const hqMatesAtom = Atom.make((get): HqMatesView | null => {
  const orgId = get(accountReadsAtom)?.orgId ?? null;
  if (orgId === null) return null;
  const { mates, live } = get(shownHqMatesAtom);
  return { organizationId: orgId, mates: new Map(Object.entries(mates)), current: live };
}).pipe(Atom.withLabel("zerops:hq-mates"));

/** The project whose Mate HQ says serves `environmentId`, in `view`; null where HQ names none. */
export function hqProjectOf(view: HqMatesView | null, environmentId: EnvironmentId): string | null {
  for (const [projectId, mate] of view?.mates ?? []) {
    if (mate.identity?.environmentId === environmentId) return projectId;
  }
  return null;
}

/** `hqProjectOf` for one environment: re-read only when HQ moves the project it names. */
export const hqProjectAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => hqProjectOf(get(hqMatesAtom), environmentId)).pipe(
    Atom.withLabel(`zerops:hq-project:${environmentId}`),
  ),
);

/** The people HQ named for the organization in view, by Zerops user id; null while none are. */
export const hqPeopleAtom = Atom.make((get): HqPeople | null => {
  const navigation = get(shownHqNavigationAtom);
  return navigation.read === "unread" ? null : navigation.people;
}).pipe(Atom.withLabel("zerops:hq-people"));

const NO_PLACEMENTS: ReadonlyMap<string, HqPlacement> = new Map();

/** The inventory projection, read directly from the mounted account's facts. */
export const inventoryReadAtom = Atom.make((get): InventoryProjection | null => {
  const account = get(accountReadsAtom);
  const organization = get(zeropsSessionAtom)?.activeOrganization;
  return account === null || organization == null || account.orgId !== organization.organizationId
    ? null
    : get(account.data.project(inventoryContents, { organization, viewer: account.viewer }));
}).pipe(Atom.withLabel("data:inventory"));

/** One environment this renderer registered, as the connection catalog presents it. */
export interface ZeropsEnvironmentEntry {
  readonly environmentId: EnvironmentId;
  readonly displayUrl: string | null;
  readonly connection: EnvironmentConnectionPresentation;
  /**
   * The Zerops project its own descriptor states (`zerops.projectId`): null for a server that runs
   * outside Zerops, undefined while its server has not answered.
   */
  readonly zeropsProjectId: string | null | undefined;
}

/** Every registered environment: the environments atom the listing, names and Mates join. */
export const zeropsEnvironmentsAtom = Atom.make((get): ReadonlyArray<ZeropsEnvironmentEntry> =>
  [...get(environmentPresentations.presentationsAtom)].map(([environmentId, presentation]) => ({
    environmentId,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    connection: presentation.connection,
    zeropsProjectId:
      presentation.serverConfig === null
        ? undefined
        : (presentation.serverConfig.environment.zerops?.projectId ?? null),
  })),
).pipe(Atom.withLabel("zerops:environments"));

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

/**
 * The active organization's listing as the account reads it (`mateListingsAtom`: its projects as
 * the account's store lists them, their services as the runtime reads them), each project where HQ
 * places it, with the test a row's project must pass to be shown: unread until the account's
 * product has published a signed-in session with an organization chosen, its runtime and its
 * inventory, and withheld whole while the account's access lapses (§3.1). The rows and the names
 * each read it their own way.
 */
const shownListingAtom = Atom.make(
  (
    get,
  ): {
    readonly listing: Shown<ReadonlyArray<CandidateRow>>;
    readonly admits: (row: CandidateRow) => boolean;
  } => {
    const session = get(zeropsSessionAtom);
    const inventory = get(inventoryReadAtom);
    if (
      session === null ||
      inventory === null ||
      session.status !== "signed-in" ||
      session.organizationStatus !== "selected" ||
      session.activeOrganization === null
    ) {
      return { listing: UNREAD, admits: NONE };
    }
    const organization = session.activeOrganization;
    const listed = get(mateListingsAtom).find(
      ({ organizationId }) => organizationId === organization.organizationId,
    );
    const placements = get(hqPlacementsAtom) ?? NO_PLACEMENTS;
    // The project family holds each project's grants; HQ owns its placement.
    return {
      // Each project where HQ places it (ADR 0002): its group, its kind, its Mate's face.
      listing: placeListing(listed?.listing ?? UNREAD, placements),
      admits: (row) => {
        const key = projectKeyOf({
          kind: "project",
          organization,
          projectId: ZeropsProjectId.make(row.project.id),
        });
        return inventory.projectRefs.has(key) && inventory.authority.get(key)?.kind !== "withheld";
      },
    };
  },
).pipe(Atom.withLabel("zerops:shown-listing"));

const NONE = (): boolean => false;

/**
 * The active organization's Mate rows (DESIGN §2.B B4): its listing with only the rows of projects
 * the inventory admits, and withholding applied here, at the read (§3.1, §4.2 G12): without the
 * rows of a project the grant withholds alone, which leaves the listing partial. Derived, so
 * nothing it held outlives the account.
 */
export const mateRowsAtom = Atom.make((get): Shown<ReadonlyArray<CandidateRow>> => {
  const { listing, admits } = get(shownListingAtom);
  return listing.state === "known" ? admittedOnly(listing, admits) : listing;
}).pipe(Atom.withLabel("zerops:mate-rows"));

/**
 * Whether the rows lack anything still on its way for this person: the roster is whole, and every
 * project it lists that has no row is one this person can never see (`projectsNeverSeen`: the
 * grant withholds it, NO_ACCESS, a denial confirmed).
 */
export const candidateListingWholeAtom = Atom.make((get): boolean => {
  const session = get(zeropsSessionAtom);
  const inventory = get(inventoryReadAtom);
  const organization = session?.activeOrganization ?? null;
  if (inventory === null || organization === null) return false;
  const rows = get(mateRowsAtom);
  const roster = get(shownProjectsAtom);
  if (rows.state !== "known" || roster.orgId !== organization.organizationId || !roster.complete)
    return false;
  const shown = new Set(heldCandidates(rows).rows.map((row) => row.project.id));
  const neverSeen = (projectId: string) =>
    inventory.authority.get(
      projectKeyOf({ kind: "project", organization, projectId: ZeropsProjectId.make(projectId) }),
    )?.kind === "withheld";
  return roster.projects.every((project) => shown.has(project.id) || neverSeen(project.id));
}).pipe(Atom.withLabel("zerops:candidate-listing-whole"));

/**
 * The names the active organization's Mates go by (`takenBotNames`), read off its project list
 * where HQ places each: a project the grant has not verified yet, or that this account may not
 * open, still holds its name, and no project's services need reading. Complete only as the list
 * is, with HQ's structure answered (`takenBotNames`), so a name missing from it is never called
 * free while it may still be there; nothing while the account's access lapses.
 */
export const takenBotNamesAtom = Atom.make((get): TakenBotNames =>
  takenBotNames(get(shownListingAtom).listing, {
    structureKnown: get(hqPlacementsAtom) !== null && get(shownHqNavigationAtom).live,
  }),
).pipe(Atom.withLabel("zerops:taken-bot-names"));

/**
 * The derived half of the environment → project index (DESIGN §2.C C3): the project each
 * registered environment's descriptor states, and the one each listing row that reaches an
 * environment belongs to. A registration record is the third source (`environmentProjectRef`).
 */
export interface EnvironmentProjects {
  readonly described: ReadonlyMap<EnvironmentId, string>;
  readonly listed: ReadonlyMap<EnvironmentId, string>;
}

export const environmentProjectsAtom = Atom.make((get): EnvironmentProjects => {
  const environments = get(zeropsEnvironmentsAtom);
  const described = new Map<EnvironmentId, string>();
  for (const environment of environments) {
    if (typeof environment.zeropsProjectId === "string")
      described.set(environment.environmentId, environment.zeropsProjectId);
  }
  const registered = registeredZeropsOrigins(environments);
  const listed = new Map<EnvironmentId, string>();
  for (const row of heldCandidates(get(mateRowsAtom)).rows) {
    const environmentId = rowEnvironment(row, registered);
    if (environmentId !== undefined && !listed.has(environmentId))
      listed.set(environmentId, row.project.id);
  }
  return { described, listed };
}).pipe(
  Atom.withEquality<EnvironmentProjects>(
    (a, b) =>
      sameValue([...a.described], [...b.described]) && sameValue([...a.listed], [...b.listed]),
  ),
  Atom.withLabel("zerops:environment-projects"),
);

/**
 * The project an environment belongs to (C3): its descriptor's word first, then the Mate this tab
 * read serving it, then a listing row that reaches it — each resolved to the inventory's one
 * operable reference. Null while none of them places it in a project the inventory holds.
 */
export function environmentProjectRef(input: {
  readonly environmentId: EnvironmentId;
  readonly mate: { readonly projectId: string; readonly orgId: string | null } | undefined;
  readonly located: EnvironmentProjects;
  readonly inventory: Pick<InventoryProjection, "projectRefs">;
}): ProjectRef | null {
  const described = input.located.described.get(input.environmentId);
  const remembered = input.mate ?? null;
  const listed = input.located.listed.get(input.environmentId);
  return (
    (described === undefined ? null : findInventoryProjectRef(input.inventory, described)) ??
    (remembered === null
      ? null
      : findInventoryProjectRef(
          input.inventory,
          remembered.projectId,
          remembered.orgId ?? undefined,
        )) ??
    (listed === undefined ? null : findInventoryProjectRef(input.inventory, listed))
  );
}

const topologyProjects = new Map<string, ProjectRef>();

const projectTopologies = Atom.family((key: string) =>
  Atom.make((get): ProjectTopologySnapshot => {
    const account = get(accountReadsAtom);
    const project = topologyProjects.get(key)!;
    return account === null
      ? EMPTY_PROJECT_TOPOLOGY_SNAPSHOT
      : get(
          account.data.project(inventoryTopology, {
            orgId: project.organization.organizationId,
            projectId: project.projectId,
            viewer: account.viewer,
          }),
        );
  }).pipe(Atom.withLabel(`zerops:project-topology:${key}`)),
);

/**
 * A project's topology (DESIGN §2.C C11): the project as the account's store lists it, its
 * services as the runtime reads them, and their usage and history as the account's store holds
 * them while the panel demands them, so a pushed facet reaches every reader
 * with nobody copying it. Protected roots read it
 * through `useZeropsTopology`; `useProjectTopology` is where a host demands it.
 */
export function projectTopologyAtom(project: ProjectRef): Atom.Atom<ProjectTopologySnapshot> {
  const key = projectKeyOf(project);
  if (!topologyProjects.has(key)) topologyProjects.set(key, project);
  return projectTopologies(key);
}

export const hqMateVersionsAtom = Atom.make((get) => {
  const hq = get(hqMatesAtom);
  return Object.fromEntries(
    [...(hq?.mates ?? [])].map(([id, mate]) => [id, mate.identity?.serverVersion]),
  );
}).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));
export const hqMainChatsAtom = Atom.make((get) => {
  const hq = get(hqMatesAtom);
  return Object.fromEntries(
    [...(hq?.mates ?? [])].map(([id, mate]) => [
      id,
      {
        read: mate.main !== undefined,
        chat:
          mate.identity === undefined || !mate.main
            ? undefined
            : { environmentId: mate.identity.environmentId, threadId: mate.main.id },
      },
    ]),
  );
}).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));

const projectTopologyViews = Atom.family((key: string) =>
  Atom.make((get) => get(projectTopologies(key)).view).pipe(Atom.withEquality(sameValue)),
);

/** The topology's contents, without subscribing a drawing to source freshness. */
export function projectTopologyViewAtom(project: ProjectRef) {
  projectTopologyAtom(project);
  return projectTopologyViews(projectKeyOf(project));
}
