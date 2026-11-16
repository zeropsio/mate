/**
 * The left menu's view model: whatever the client already holds per project —
 * a picker candidate, a connection state, a health probe — re-hung on the
 * group tree.
 *
 * `deriveCanonicalGroups` answers "what groups exist"; this answers "and what do I
 * already know about each member". It is generic over the carrier so web's
 * candidate presentation, mobile's row and a bare project all work without
 * this module knowing any of them — and so the tree is built once, not once
 * per client.
 *
 * Ordering and naming are entirely `deriveCanonicalGroups`; nothing is decided
 * twice here.
 *
 * @module groupTree
 */

import type { ZeropsProject } from "./api.ts";
import {
  deriveCanonicalGroups,
  type CanonicalGroupsOptions,
  type CanonicalGroup,
  type CanonicalGroupEnvironment,
} from "./groups.ts";

/** Anything the client holds that knows which project it is about. */
export interface ZeropsProjectCarrier {
  readonly project: ZeropsProject;
}

export type CanonicalGroupTreeEnvironment<T> = CanonicalGroupEnvironment & {
  readonly item: T | undefined;
};

export interface CanonicalGroupTreeView<T> {
  readonly groups: ReadonlyArray<{
    /** Its members still being created are `group.pending`: the client holds no carrier for them. */
    readonly group: CanonicalGroup;
    readonly environments: ReadonlyArray<CanonicalGroupTreeEnvironment<T>>;
  }>;
  /** Projects with no group tag — every project that predates this feature. */
  readonly ungrouped: ReadonlyArray<T>;
  /** True when there is nothing but ungrouped projects — the "make your first group" state. */
  readonly empty: boolean;
}

export interface BuildCanonicalGroupTreeOptions<T> extends CanonicalGroupsOptions {
  /**
   * A primary sort key applied to the ungrouped list ahead of the name —
   * lower ranks first. Groups are untouched: a group's own membership
   * already orders by role, and reshuffling groups by an item's rank would
   * fight that. See `listingOrder.ts`'s `rankZeropsCandidateForListing` for
   * the project picker's tiers and why they only move on the user's own
   * action.
   */
  readonly rank?: ((item: T) => number) | undefined;
}

export function buildCanonicalGroupTree<T extends ZeropsProjectCarrier>(
  items: ReadonlyArray<T>,
  options: BuildCanonicalGroupTreeOptions<T>,
): CanonicalGroupTreeView<T> {
  // Last carrier wins for a duplicated project id: two candidates for one
  // project means the newer read, not two rows for the same environment.
  const byProjectId = new Map<string, T>();
  for (const item of items) byProjectId.set(item.project.id, item);

  // Derive from the deduplicated set, not from `items`: two carriers for one
  // project would otherwise become two environments in the same group.
  const tree = deriveCanonicalGroups(
    [...byProjectId.values()].map((item) => item.project),
    options,
  );

  const groups = tree.groups.map((group) => ({
    group,
    environments: group.environments.map((environment) => ({
      ...environment,
      item:
        environment.kind === "managed"
          ? environment.target.kind === "zerops"
            ? byProjectId.get(environment.target.projectId)
            : undefined
          : byProjectId.get(environment.project.id),
    })),
  }));

  const ungroupedItems = tree.ungrouped.flatMap((project) => {
    const item = byProjectId.get(project.id);
    return item === undefined ? [] : [item];
  });
  // `tree.ungrouped` already arrives name-sorted; a `rank` only inserts a
  // primary key ahead of that name order, via a stable sort so ties keep it.
  const ungrouped =
    options.rank === undefined
      ? ungroupedItems
      : [...ungroupedItems].sort((left, right) => options.rank!(left) - options.rank!(right));

  return { groups, ungrouped, empty: groups.length === 0 };
}
