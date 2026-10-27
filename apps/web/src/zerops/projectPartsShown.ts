import { useSyncExternalStore } from "react";

import type { ProjectReviewTags } from "~/components/zerops/SidebarProjectReview";
import type { ProjectSitesInput } from "~/components/zerops/SidebarProjectSites";

/** What a project's row hands its Review tag (`ProjectReviewTags`). */
export type ProjectReviewInput = Parameters<typeof ProjectReviewTags>[0];

/** One project as the menu drew it: its places, what waits on a review, and its Mates. */
export interface ProjectParts {
  readonly mateIds: ReadonlyArray<string>;
  readonly sites: ProjectSitesInput | undefined;
  readonly review: ProjectReviewInput | undefined;
}

/**
 * Each project's parts as the menu drew them, by every one of its Mates' Zerops project: the
 * conversation's header opens the same Sites panel as its row's globe and the same Review as its
 * row's tag, without reading anything again.
 */
let byMate: ReadonlyMap<string, ProjectParts> = new Map();
/** The same parts by their application (`sites.groupId`), for a surface opened on a place. */
let byGroup: ReadonlyMap<string, ProjectSitesInput> = new Map();
const listeners = new Set<() => void>();

export function showProjectParts(drawn: Iterable<ProjectParts>): void {
  const next = new Map<string, ProjectParts>();
  const groups = new Map<string, ProjectSitesInput>();
  for (const parts of drawn) {
    for (const mateId of parts.mateIds) next.set(mateId, parts);
    if (parts.sites !== undefined) groups.set(parts.sites.groupId, parts.sites);
  }
  if (
    next.size === byMate.size &&
    [...next].every(([id, parts]) => {
      const was = byMate.get(id);
      return was !== undefined && was.sites === parts.sites && was.review === parts.review;
    }) &&
    groups.size === byGroup.size &&
    [...groups].every(([id, sites]) => byGroup.get(id) === sites)
  ) {
    return;
  }
  byMate = next;
  byGroup = groups;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useProjectSitesOf(
  mateProjectId: string | undefined,
): ProjectSitesInput | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (mateProjectId === undefined ? undefined : byMate.get(mateProjectId)?.sites),
    () => undefined,
  );
}

/** An application's places as the menu drew them; `undefined` while its row is not drawn. */
export function useProjectSitesOfGroup(groupId: string | undefined): ProjectSitesInput | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (groupId === undefined ? undefined : byGroup.get(groupId)),
    () => undefined,
  );
}

export function useProjectReviewOf(
  mateProjectId: string | undefined,
): ProjectReviewInput | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (mateProjectId === undefined ? undefined : byMate.get(mateProjectId)?.review),
    () => undefined,
  );
}
