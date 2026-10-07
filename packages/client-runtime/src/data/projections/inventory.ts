/** The inventory's presentation join: platform access, HQ placement and Mate labels. */
import type { ZeropsOrganization, ZeropsProject } from "../../zerops/api.ts";
import {
  projectKeyOf,
  ZeropsProjectId,
  type OrganizationRef,
  type ProjectRef,
  type ScopeAuthority,
} from "../../zerops/data/index.ts";
import { deriveZeropsCandidates, type ZeropsCandidate } from "../../zerops/candidates.ts";
import { placeProjects, placementsOf, type HqPlacements } from "../../zerops/hq/placement.ts";
import type { Projection } from "../store.ts";
import { platformInventory, type PlatformInventory } from "./platformInventory.ts";
import { hqMenuNavigation } from "./hqNavigation.ts";
import { hqMateLogins, hqMateReady } from "./hqMates.ts";
import { projectServices } from "./services.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { scopeFreshness, type ScopeFreshness } from "./freshness.ts";
import { sameValue } from "./equal.ts";

export interface InventoryKey {
  readonly organization: OrganizationRef;
  readonly viewer: ZeropsOrganization | undefined;
}
export interface InventoryRead extends Omit<PlatformInventory, "projects"> {
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly projectRefs: ReadonlyMap<string, ProjectRef>;
  readonly authority: ReadonlyMap<string, ScopeAuthority>;
  readonly lost: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly error: string | null;
}

/** Placement coverage is separate from the app listing and from retained placement values. */
export const inventoryPlacementStatus: Projection<string, ScopeFreshness> = {
  name: "inventoryPlacementStatus",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => scopeFreshness(read, placementsScope(orgId)),
  equals: sameValue,
};

/** HQ's placement facts, with only the labels its Mate overview supplied. */
export const inventoryPlacements: Projection<string, HqPlacements | null> = {
  name: "inventoryPlacements",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const navigation = hqMenuNavigation.derive(read, orgId);
    if (navigation.structure === null) return null;
    const ids = read.members(placementsScope(orgId)).ids;
    return placementsOf(
      navigation.structure,
      new Map(
        ids.flatMap((projectId) => {
          const logins = hqMateLogins.derive(read, { orgId, projectId });
          return logins === undefined ? [] : [[projectId, logins] as const];
        }),
      ),
      new Map(
        ids.flatMap((projectId) => {
          const ready = hqMateReady.derive(read, { orgId, projectId });
          return ready === undefined ? [] : [[projectId, ready] as const];
        }),
      ),
      navigation.presses,
    );
  },
  equals: (a, b) =>
    a === b ||
    (a !== null &&
      b !== null &&
      sameValue([...a], [...b]) &&
      sameValue([...(a.tools ?? [])], [...(b.tools ?? [])])),
};

export const inventory: Projection<InventoryKey, InventoryRead> = {
  name: "inventory",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, { organization, viewer }) => {
    const orgId = organization.organizationId;
    const platform = platformInventory.derive(read, { orgId, viewer });
    const placements = inventoryPlacements.derive(read, orgId);
    const projects =
      placements === null ? platform.projects : placeProjects(platform.projects, placements);
    const projectRefs = new Map<string, ProjectRef>();
    const authority = new Map<string, ScopeAuthority>();
    for (const id of [...projects.map(({ id }) => id), ...platform.denied]) {
      const ref: ProjectRef = {
        kind: "project",
        organization,
        projectId: ZeropsProjectId.make(id),
      };
      const key = projectKeyOf(ref);
      projectRefs.set(key, ref);
      authority.set(
        key,
        platform.denied.includes(id)
          ? { kind: "withheld", reason: "access-denied", cause: null }
          : { kind: "authorized" },
      );
    }
    return {
      ...platform,
      projects,
      projectRefs,
      authority,
      lost: new Set(platform.denied),
      isLoading: platform.read !== "read",
      error: platform.failure,
    };
  },
  equals: (a, b) =>
    sameValue(
      { ...a, projectRefs: [...a.projectRefs], authority: [...a.authority], lost: [...a.lost] },
      { ...b, projectRefs: [...b.projectRefs], authority: [...b.authority], lost: [...b.lost] },
    ),
};

/** Content and access drawn by inventory consumers, independent of transport status. */
export type InventoryContents = Pick<
  InventoryRead,
  "projects" | "projectRefs" | "authority" | "lost" | "isLoading" | "error"
>;
export const inventoryContents: Projection<InventoryKey, InventoryContents> = {
  name: "inventoryContents",
  keyOf: inventory.keyOf,
  derive: (read, key) => {
    const { projects, projectRefs, authority, lost, isLoading, error } = inventory.derive(
      read,
      key,
    );
    return { projects, projectRefs, authority, lost, isLoading, error };
  },
  equals: (a, b) =>
    sameValue(
      { ...a, projectRefs: [...a.projectRefs], authority: [...a.authority], lost: [...a.lost] },
      { ...b, projectRefs: [...b.projectRefs], authority: [...b.authority], lost: [...b.lost] },
    ),
};

/** The candidates needed by a connection host; service pushes do not rerender the inventory. */
export const inventoryCandidates: Projection<InventoryKey, ReadonlyArray<ZeropsCandidate>> = {
  name: "inventoryCandidates",
  keyOf: inventory.keyOf,
  derive: (read, key) =>
    inventory.derive(read, key).projects.flatMap((project) =>
      deriveZeropsCandidates(
        project,
        projectServices.derive(read, {
          orgId: key.organization.organizationId,
          projectId: project.id,
        }).services ?? null,
        new Map(),
      ),
    ),
  equals: sameValue,
};
export const NOT_READ_INVENTORY: InventoryRead = {
  projects: [],
  denied: [],
  projectRefs: new Map(),
  authority: new Map(),
  lost: new Set(),
  read: "unread",
  live: false,
  failure: null,
  trouble: null,
  isLoading: true,
  error: null,
};
