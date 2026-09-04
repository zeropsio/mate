/**
 * Mounts and reads one environment's service-map watcher.
 *
 * This is the WRITER half of the read/write split
 * `scripts/mate-zone-architecture.test.ts` ("protected roots render only")
 * requires: the watcher needs the mutating Zerops REST client
 * (`@t3tools/client-runtime/zerops`), so this hook — and everything it
 * imports — must never be reachable from a protected root
 * (`ZeropsServiceMap.tsx`, `ZeropsLifecycleStrip.tsx`,
 * `ZeropsOperationCard.tsx`, `ZeropsQuickActions.tsx`). It runs only in
 * non-protected hosts that already render whenever those roots do —
 * `ChatView.tsx`, `ZeropsPanel.tsx` — and publishes into
 * `../state/zerops.ts`'s `projectTopologyViewAtom`, a plain read-only atom
 * `useZeropsFeeds.ts`'s `useZeropsTopology` reads with no import of this
 * file, the watcher, candidate loading, or `api.ts` at all.
 *
 * One {@link ProjectTopologyWatcher} per environment regardless of how many
 * hosts mount this hook — `watcherFor` ref-counts it exactly like
 * `activity/useProjectActivity.ts`'s `pollerFor` — so two hosts open at once
 * (e.g. `ChatView` and `ZeropsPanel`) publish to, and every reader reads
 * from, the very same atom value.
 */
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { PlatformWatchSocket } from "@t3tools/client-runtime/zerops/platformWatch";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentId } from "@t3tools/contracts";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironment } from "../state/environments";
import { projectTopologyViewAtom } from "../state/zerops";
import { ProjectTopologyWatcher, type ProjectTopologySnapshot } from "./projectTopologyWatcher.ts";
import { browserZeropsStorage } from "./storage.ts";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/**
 * Bridges the real, browser `WebSocket` to `PlatformWatchSocket`'s narrower
 * shape: the native `onmessage`/`onclose`/`onerror` properties are writable
 * with a wider signature (`(ev: MessageEvent) => any`, etc.), which a plain
 * `new WebSocket(url)` cannot satisfy structurally as a mutable property —
 * this wraps it in a small forwarding object instead.
 */
function connectPlatformSocket(url: string): PlatformWatchSocket {
  const socket = new WebSocket(url);
  const wrapper: PlatformWatchSocket = {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.onopen = () => wrapper.onopen?.();
  socket.onmessage = (event: MessageEvent) => wrapper.onmessage?.({ data: String(event.data) });
  socket.onclose = () => wrapper.onclose?.();
  socket.onerror = (event) => wrapper.onerror?.(event);
  return wrapper;
}

interface WatcherEntry {
  readonly client: ZeropsApiClient;
  readonly watcher: ProjectTopologyWatcher;
}

const watchersByEnvironment = new Map<string, WatcherEntry>();

/**
 * Keyed on `environmentId` AND the `client` instance, mirroring
 * `activity/useProjectActivity.ts`'s `pollerFor`: a re-login can hand out a
 * new `ZeropsApiClient` for the same environment, and a watcher built
 * against the old client would keep reading with its stale session forever.
 */
export function watcherFor(
  environmentId: EnvironmentId,
  client: ZeropsApiClient,
  displayUrl: string | null,
): ProjectTopologyWatcher {
  const key = String(environmentId);
  const existing = watchersByEnvironment.get(key);
  if (existing !== undefined && existing.client === client) {
    return existing.watcher;
  }
  existing?.watcher.dispose();
  const watcher = new ProjectTopologyWatcher({
    environmentId,
    client,
    storage: browserZeropsStorage,
    displayUrl,
    makeSocket: connectPlatformSocket,
  });
  watchersByEnvironment.set(key, { client, watcher });
  return watcher;
}

const EMPTY_SNAPSHOT: ProjectTopologySnapshot = {
  view: undefined,
  liveness: undefined,
  lastReadAt: undefined,
  error: undefined,
};

const EMPTY_ATOM = Atom.make(EMPTY_SNAPSHOT).pipe(Atom.withLabel("zerops:project-topology-empty"));

/**
 * `environmentId === null`, no Zerops session, or no resolvable environment
 * yet mounts no watcher and reads the atom's untouched empty snapshot.
 */
export function useProjectTopology(environmentId: EnvironmentId | null): ProjectTopologySnapshot {
  const session = useZeropsSessionOptional();
  const environment = useEnvironment(environmentId);
  const client = session?.client ?? null;
  const displayUrl = environment?.displayUrl ?? null;

  useEffect(() => {
    if (environmentId === null || client === null) return;
    const watcher = watcherFor(environmentId, client, displayUrl);
    const atom = projectTopologyViewAtom(environmentId);
    const publish = () => {
      appAtomRegistry.set(atom, watcher.getSnapshot());
    };
    publish();
    return watcher.subscribe(publish);
  }, [environmentId, client, displayUrl]);

  return useAtomValue(environmentId === null ? EMPTY_ATOM : projectTopologyViewAtom(environmentId));
}
