/**
 * The React-facing read of one project's platform activity — a thin
 * `useSyncExternalStore` wrapper over a per-project singleton
 * {@link ProjectActivityPoller}, so every pending card in a thread shares one
 * poll instead of racing its own (§6 "one request per project per tick").
 */
import { useCallback, useSyncExternalStore } from "react";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";

import { ProjectActivityPoller, type ProjectActivitySnapshot } from "./projectActivityPoller.ts";

interface PollerEntry {
  readonly client: ZeropsApiClient;
  readonly poller: ProjectActivityPoller;
}

const pollersByProject = new Map<string, PollerEntry>();

/**
 * Keyed on `projectId` AND the `client` instance: a re-login (or a
 * `ZeropsSessionProvider` remount) can hand out a NEW `ZeropsApiClient` for
 * the same project id, and a poller built against the old client would keep
 * polling with its stale session forever. When the client for a project
 * changes, the stale poller is disposed (stops its timer, drops its
 * listeners) before a fresh one takes its place.
 */
export function pollerFor(projectId: string, client: ZeropsApiClient): ProjectActivityPoller {
  const existing = pollersByProject.get(projectId);
  if (existing !== undefined && existing.client === client) {
    return existing.poller;
  }
  existing?.poller.dispose();
  const poller = new ProjectActivityPoller({ client, projectId });
  pollersByProject.set(projectId, { client, poller });
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
  // Memoized on the identities that actually matter (`projectId`, `client`)
  // rather than a fresh closure every render: `ProjectActivityPoller.subscribe`
  // resets the backoff and fires an immediate poll on a 0→1 listener
  // transition, so an unmemoized subscribe function — which `useSyncExternalStore`
  // re-subscribes to whenever its identity changes — would unsubscribe and
  // resubscribe (and therefore restart the poll) on every single render of
  // every caller, however unrelated to this feed. Under a fast, dependency-free
  // fake client this compounds into a tight render→poll→publish→render loop.
  const subscribe = useCallback(
    (listener: () => void) =>
      projectId === null || client === null
        ? () => undefined
        : pollerFor(projectId, client).subscribe(listener),
    [projectId, client],
  );
  const getSnapshot = useCallback(
    () =>
      projectId === null || client === null
        ? EMPTY_SNAPSHOT
        : pollerFor(projectId, client).getSnapshot(),
    [projectId, client],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    // Server-rendered (e.g. `renderToStaticMarkup` in tests): there is no poll
    // yet, so the overlay starts as "no observation", identical to the client's
    // first render before any poll has landed.
    () => EMPTY_SNAPSHOT,
  );
}
