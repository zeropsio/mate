import { useSyncExternalStore } from "react";

import type { ProjectSitesInput } from "~/components/zerops/SidebarProjectSites";

/**
 * Each project's places as the menu drew them (`ProjectSites`), by every one of its Mates' Zerops
 * project: the conversation's header opens the same panel as its row's globe, without reading
 * anything again.
 */
let byMate: ReadonlyMap<string, ProjectSitesInput> = new Map();
const listeners = new Set<() => void>();

export function showProjectSites(drawn: Iterable<ProjectSitesInput | undefined>): void {
  const next = new Map<string, ProjectSitesInput>();
  for (const sites of drawn) {
    if (sites === undefined) continue;
    for (const mate of sites.mates) next.set(mate.candidate.project.id, sites);
  }
  if (next.size === byMate.size && [...next].every(([id, sites]) => byMate.get(id) === sites)) {
    return;
  }
  byMate = next;
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
    () => (mateProjectId === undefined ? undefined : byMate.get(mateProjectId)),
    () => undefined,
  );
}
