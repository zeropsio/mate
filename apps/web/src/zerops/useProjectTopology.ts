/**
 * The React-facing read of one environment's service map — a thin
 * `useSyncExternalStore` wrapper over a per-environment singleton
 * {@link ProjectTopologyWatcher}, so every consumer in a thread (the panel,
 * the strip, quick actions) shares one platform-websocket connection and one
 * REST reader instead of racing its own.
 */
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { PlatformWatchSocket } from "@t3tools/client-runtime/zerops/platformWatch";
import { useCallback, useSyncExternalStore } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironment } from "../state/environments";
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

/**
 * `environmentId === null`, no Zerops session, or no resolvable environment
 * yet renders nothing and subscribes to nothing.
 */
export function useProjectTopology(environmentId: EnvironmentId | null): ProjectTopologySnapshot {
  const session = useZeropsSessionOptional();
  const environment = useEnvironment(environmentId);
  const client = session?.client ?? null;
  const displayUrl = environment?.displayUrl ?? null;

  const subscribe = useCallback(
    (listener: () => void) =>
      environmentId === null || client === null
        ? () => undefined
        : watcherFor(environmentId, client, displayUrl).subscribe(listener),
    [environmentId, client, displayUrl],
  );
  const getSnapshot = useCallback(
    () =>
      environmentId === null || client === null
        ? EMPTY_SNAPSHOT
        : watcherFor(environmentId, client, displayUrl).getSnapshot(),
    [environmentId, client, displayUrl],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
}
