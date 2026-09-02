/**
 * The React-facing read of one project's platform activity — a thin
 * `useSyncExternalStore` wrapper over a per-project singleton
 * {@link ProjectActivityPoller}, so every pending card in a thread shares one
 * poll instead of racing its own (§6 "one request per project per tick").
 */
import { useSyncExternalStore } from "react";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";

import { ProjectActivityPoller, type ProjectActivitySnapshot } from "./projectActivityPoller.ts";

const pollersByProject = new Map<string, ProjectActivityPoller>();

function pollerFor(projectId: string, client: ZeropsApiClient): ProjectActivityPoller {
  const existing = pollersByProject.get(projectId);
  if (existing !== undefined) {
    return existing;
  }
  const poller = new ProjectActivityPoller({ client, projectId });
  pollersByProject.set(projectId, poller);
  return poller;
}

const EMPTY_SNAPSHOT: ProjectActivitySnapshot = { processes: undefined, atMs: undefined };

/**
 * Subscribes to `projectId`'s platform-activity poll. Returns the last good
 * snapshot (undefined `processes` until the first successful read) and starts
 * polling on mount, stopping when the last subscriber for that project unmounts.
 *
 * `projectId === null` or `client === null` renders nothing and subscribes to
 * nothing — the caller uses this when there is no Zerops session or no
 * resolvable project yet.
 */
export function useProjectActivity(
  projectId: string | null,
  client: ZeropsApiClient | null,
): ProjectActivitySnapshot {
  const active = projectId !== null && client !== null ? { projectId, client } : null;
  return useSyncExternalStore(
    (listener) =>
      active === null
        ? () => undefined
        : pollerFor(active.projectId, active.client).subscribe(listener),
    () =>
      active === null ? EMPTY_SNAPSHOT : pollerFor(active.projectId, active.client).getSnapshot(),
    // Server-rendered (e.g. `renderToStaticMarkup` in tests): there is no poll
    // yet, so the overlay starts as "no observation", identical to the client's
    // first render before any poll has landed.
    () => EMPTY_SNAPSHOT,
  );
}
