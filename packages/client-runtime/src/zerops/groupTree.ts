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

export function buildZeropsGroupTree<T extends ZeropsProjectCarrier>(
  items: ReadonlyArray<T>,
  options: DeriveZeropsGroupsOptions = {},
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

  const ungrouped = tree.ungrouped.flatMap((project) => {
    const item = byProjectId.get(project.id);
    return item === undefined ? [] : [item];
  });

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
