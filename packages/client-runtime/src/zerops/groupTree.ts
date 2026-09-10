/**
 * The left menu's view model: whatever the client already holds per project —
 * a picker candidate, a connection state, a health probe — re-hung on the
 * group tree.
 *
 * `deriveZeropsGroups` answers "what groups exist"; this answers "and what do I
 * already know about each member". It is generic over the carrier so web's
 * candidate presentation, mobile's row and a bare project all work without
 * this module knowing any of them — and so the tree is built once, not once
 * per client.
 *
 * Ordering, naming and the tools/groups split are entirely
 * `deriveZeropsGroups` and `partitionZeropsToolProjects`; nothing is decided
 * twice here.
 *
 * @module groupTree
 */

import type { ZeropsProject } from "./api.ts";
import {
  deriveZeropsGroups,
  type DeriveZeropsGroupsOptions,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
} from "./groups.ts";
import { partitionZeropsToolProjects, type ZeropsToolKind } from "./tools.ts";

/** Anything the client holds that knows which project it is about. */
export interface ZeropsProjectCarrier {
  readonly project: ZeropsProject;
}

export interface ZeropsGroupTreeEnvironment<T> {
  readonly role: ZeropsEnvironmentRole | undefined;
  readonly item: T;
}

export interface ZeropsGroupTreeGroup<T> {
  readonly group: ZeropsGroup;
  readonly environments: ReadonlyArray<ZeropsGroupTreeEnvironment<T>>;
}

export interface ZeropsGroupTreeTool<T> {
  readonly kind: ZeropsToolKind;
  readonly item: T;
}

export interface ZeropsGroupTreeView<T> {
  readonly groups: ReadonlyArray<ZeropsGroupTreeGroup<T>>;
  /** Projects with no group tag — every project that predates this feature. */
  readonly ungrouped: ReadonlyArray<T>;
  /** Account-level tools, kept out of every group (`tools.ts`). */
  readonly tools: ReadonlyArray<ZeropsGroupTreeTool<T>>;
  /** True when there is nothing but ungrouped projects — the "make your first group" state. */
  readonly empty: boolean;
}

export interface BuildZeropsGroupTreeOptions<T> extends DeriveZeropsGroupsOptions {
  /**
   * A primary sort key applied to the ungrouped list ahead of the name —
   * lower ranks first. Groups are untouched: a group's own membership
   * already orders by role, and reshuffling groups by an item's rank would
   * fight that. See `listingOrder.ts`'s `rankZeropsCandidateForListing` for
   * the project picker's tiers and why they only move on the user's own
   * action.
   */
  readonly rank?: (item: T) => number;
}

export function buildZeropsGroupTree<T extends ZeropsProjectCarrier>(
  items: ReadonlyArray<T>,
  options: BuildZeropsGroupTreeOptions<T> = {},
): ZeropsGroupTreeView<T> {
  // Last carrier wins for a duplicated project id: two candidates for one
  // project means the newer read, not two rows for the same environment.
  const byProjectId = new Map<string, T>();
  for (const item of items) byProjectId.set(item.project.id, item);

  // Derive from the deduplicated set, not from `items`: two carriers for one
  // project would otherwise become two environments in the same group.
  const { tools, rest } = partitionZeropsToolProjects(
    [...byProjectId.values()].map((item) => item.project),
  );
  const tree = deriveZeropsGroups(rest, options);

  const groups = tree.groups.map((group) => ({
    group,
    environments: group.environments.flatMap((environment) => {
      const item = byProjectId.get(environment.project.id);
      return item === undefined ? [] : [{ role: environment.role, item }];
    }),
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

  const toolItems = tools.flatMap((tool) => {
    const item = byProjectId.get(tool.project.id);
    return item === undefined ? [] : [{ kind: tool.kind, item }];
  });

  return {
    groups,
    ungrouped,
    tools: toolItems,
    empty: groups.length === 0 && toolItems.length === 0,
  };
}
