import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { BuildLogLine, BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import {
  buildLogSessionKeyOf,
  type BuildLogLease,
  type BuildLogRegistry,
  type BuildLogSnapshot,
  type BuildLogStatus,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";

import { findInventoryProjectRef, useZeropsInventory } from "../inventoryContext";
import { useZeropsData } from "../zeropsDataContext";

export interface UseBuildLogInput {
  readonly projectId: string | null;
  readonly query: BuildLogQuery | null;
  readonly live: boolean;
}

export interface UseBuildLogResult {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly status: BuildLogStatus;
}

const IDLE_SNAPSHOT: BuildLogSnapshot = {
  lines: [],
  bytes: 0,
  status: "idle",
  loadingOlder: false,
  cursor: { oldestLineId: null, newestLineId: null },
  gaps: { older: false, newer: false },
  truncation: { lines: 0, bytes: 0 },
  error: null,
};

const ERROR_SNAPSHOT: BuildLogSnapshot = { ...IDLE_SNAPSHOT, status: "error", error: "account" };

interface ActiveLog {
  readonly key: string;
  readonly project: ProjectRef;
  readonly query: BuildLogQuery;
}

interface BoundLog {
  readonly owner: object;
  readonly key: string;
  readonly lease: BuildLogLease | null;
  unsubscribe: () => void;
}

/** Hook-local bridge from effect-owned leases to React's external-store contract. */
class BuildLogBindingStore {
  readonly #listeners = new Set<() => void>();
  #bound: BoundLog | null = null;
  #snapshot: BuildLogSnapshot = IDLE_SNAPSHOT;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot(owner: object, key: string | null): BuildLogSnapshot {
    return key !== null && this.#bound?.owner === owner && this.#bound.key === key
      ? this.#snapshot
      : IDLE_SNAPSHOT;
  }

  bind(owner: object, logs: BuildLogRegistry, active: ActiveLog): () => void {
    let lease: BuildLogLease;
    try {
      lease = logs.acquire(active.project, active.query, { follow: false });
    } catch {
      const failed: BoundLog = {
        owner,
        key: active.key,
        lease: null,
        unsubscribe: () => undefined,
      };
      this.#bound = failed;
      this.#snapshot = ERROR_SNAPSHOT;
      this.#notify();
      return () => this.#clear(failed);
    }

    const bound: BoundLog = { owner, key: active.key, lease, unsubscribe: () => undefined };
    this.#bound = bound;
    bound.unsubscribe = lease.session.subscribe(() => {
      if (this.#bound !== bound) return;
      this.#snapshot = lease.session.getSnapshot();
      this.#notify();
    });
    this.#snapshot = lease.session.getSnapshot();
    this.#notify();
    return () => this.#clear(bound);
  }

  setFollow(owner: object, key: string, follow: boolean): void {
    if (this.#bound?.owner === owner && this.#bound.key === key) {
      this.#bound.lease?.setFollow(follow);
    }
  }

  #clear(bound: BoundLog): void {
    if (this.#bound !== bound) return;
    bound.unsubscribe();
    bound.lease?.release();
    this.#bound = null;
    this.#snapshot = IDLE_SNAPSHOT;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** Demand-scoped projection over the account runtime's shared build-log registry. */
export function useBuildLog(input: UseBuildLogInput): UseBuildLogResult {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const project =
    input.projectId === null ? null : findInventoryProjectRef(inventory, input.projectId);
  const buildServiceStackId = input.query?.buildServiceStackId;
  const appVersionId = input.query?.appVersionId;
  const fromIso = input.query?.fromIso;
  const active = useMemo<ActiveLog | null>(() => {
    if (project === null || buildServiceStackId === undefined || appVersionId === undefined) {
      return null;
    }
    const query: BuildLogQuery = {
      buildServiceStackId,
      appVersionId,
      ...(fromIso === undefined ? {} : { fromIso }),
    };
    return { key: buildLogSessionKeyOf(project, query), project, query };
  }, [appVersionId, buildServiceStackId, fromIso, project]);
  const store = useMemo(() => new BuildLogBindingStore(), []);

  useEffect(() => {
    if (active === null) return;
    return store.bind(runtime, runtime.logs, active);
  }, [active, runtime, store]);

  useEffect(() => {
    if (active !== null) store.setFollow(runtime, active.key, input.live);
  }, [active, input.live, runtime, store]);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot(runtime, active?.key ?? null),
    () => IDLE_SNAPSHOT,
  );
  return { lines: snapshot.lines, status: snapshot.status };
}
