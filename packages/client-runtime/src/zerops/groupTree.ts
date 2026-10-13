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
  canonicalEnvironmentsOf,
  type HqEnvironment,
  type CanonicalHqEnvironment,
} from "./hq/environments.ts";
import {
  deriveCanonicalGroups,
  type CanonicalGroupsOptions,
  zeropsGroup,
  type CanonicalGroup,
  type CanonicalGroupEnvironment,
  type DeriveZeropsGroupsOptions,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
} from "./groups.ts";
import { partitionZeropsToolProjects, type ZeropsToolKind } from "./tools.ts";

/** Anything the client holds that knows which project it is about. */
export interface ZeropsProjectCarrier {
  readonly project: ZeropsProject;
}

export type CanonicalGroupTreeEnvironment<T> = CanonicalGroupEnvironment & {
  readonly item: T | undefined;
};
export interface CanonicalGroupTreeView<T> extends Omit<ZeropsGroupTreeView<T>, "groups"> {
  readonly groups: ReadonlyArray<{
    readonly group: CanonicalGroup;
    readonly environments: ReadonlyArray<CanonicalGroupTreeEnvironment<T>>;
  }>;
}

export interface ZeropsGroupTreeEnvironment<T> {
  readonly role: ZeropsEnvironmentRole | undefined;
  readonly item: T;
}

export interface ZeropsGroupTreeGroup<T> {
  /** Its members still being created are `group.pending`: the client holds no carrier for them. */
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

export interface BuildZeropsGroupTreeOptions<T> extends Omit<DeriveZeropsGroupsOptions, "apps"> {
  readonly apps?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly environments?:
      | ReadonlyArray<HqEnvironment | CanonicalHqEnvironment>
      | { readonly refused: string }
      | undefined;
  }>;
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

/** The existing project-carrier API opts into the same codec as the HQ boundary. */
function canonicalGroupsOptions<T>(
  options: BuildZeropsGroupTreeOptions<T>,
): CanonicalGroupsOptions {
  const { apps, ...restOptions } = options;
  return {
    ...restOptions,
    ...(apps === undefined
      ? {}
      : {
          apps: apps.map((app) => {
            const { environments, ...rest } = app;
            return {
              ...rest,
              ...(Object.hasOwn(app, "environments")
                ? {
                    environments:
                      environments !== undefined && "refused" in environments
                        ? environments
                        : canonicalEnvironmentsOf(environments),
                  }
                : {}),
            };
          }),
        }),
  };
}

export interface BuildCanonicalGroupTreeOptions<T> extends CanonicalGroupsOptions {
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
  const { tools, rest } = partitionZeropsToolProjects(
    [...byProjectId.values()].map((item) => item.project),
  );
  const tree = deriveCanonicalGroups(rest, options);

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

/** @deprecated Project-carrier DTO for unmigrated clients. */
export function buildZeropsGroupTree<T extends ZeropsProjectCarrier>(
  items: ReadonlyArray<T>,
  options: BuildZeropsGroupTreeOptions<T>,
): ZeropsGroupTreeView<T> {
  return zeropsGroupTree(
    buildCanonicalGroupTree(items, {
      ...canonicalGroupsOptions(options),
      ...(options.rank === undefined ? {} : { rank: options.rank }),
    }),
  );
}

/** One compatibility projection for all project-carrier consumers. */
export function zeropsGroupTree<T>(tree: CanonicalGroupTreeView<T>): ZeropsGroupTreeView<T> {
  return {
    ...tree,
    groups: tree.groups.map(({ group, environments }) => ({
      group: zeropsGroup(group),
      environments: environments.flatMap(({ role, item }) =>
        item === undefined ? [] : [{ role, item }],
      ),
    })),
  };
}
