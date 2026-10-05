import { useAtomValue } from "@effect/atom-react";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import {
  type InterestState,
  processRecordToActivityProcess,
  type ProcessHistoryRead,
  type ProjectActivityRead,
  type RuntimeInterestDescriptor,
} from "@t3tools/client-runtime/zerops/data";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "../inventoryContext";
import { useZeropsData, useZeropsDataInterest } from "../zeropsDataContext";

export interface ProjectActivitySnapshot {
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  /** When the newest of the records was observed — a quiet process changes nothing for minutes. */
  readonly atMs: number | undefined;
  /**
   * Every interest the read requires is observing: the feed pushes each
   * change as it happens, so what the snapshot holds is current now,
   * however long ago a record last changed.
   */
  readonly live: boolean;
  readonly unavailableReason?: string | undefined;
  /**
   * A read failed and the runtime retries it — the socket's routine reconnect,
   * or an outage while it lasts: not the feed's error, and not live.
   */
  readonly reconnecting?: true;
  /** Where the project's newest process history read stands; `unread` when not said. */
  readonly processHistory?: ProcessHistoryRead;
}

export const EMPTY_PROJECT_ACTIVITY_SNAPSHOT: ProjectActivitySnapshot = {
  processes: undefined,
  atMs: undefined,
  live: false,
};

const EMPTY_PROJECT_ACTIVITY_READ_ATOM = Atom.make<ProjectActivityRead | null>(null).pipe(
  Atom.withLabel("zerops:project-activity-read-empty"),
);

export function projectActivitySnapshotFromRead(
  read: ProjectActivityRead,
): ProjectActivitySnapshot {
  // A failure the runtime retries — the socket's routine reconnect — is no
  // error of the feed: the read is just not live, and ages as one that stopped
  // observing does. Only one it gives up on makes the read unavailable.
  const failed = read.observation.required.find(
    (interest): interest is Extract<InterestState, { readonly status: "failed" }> =>
      interest.status === "failed" && !interest.retryable,
  );
  const access = read.observation.access;
  const unavailableReason =
    access.status === "expired"
      ? "expired-session"
      : access.status === "denied"
        ? access.scope.kind === "project"
          ? "forbidden"
          : "expired-session"
        : failed?.reason;
  const reconnecting =
    unavailableReason === undefined &&
    read.observation.required.some(
      (interest) => interest.status === "failed" && interest.retryable,
    );
  const knowledge = [...read.running.value, ...read.retainedHistory];
  const processes = knowledge.flatMap((entry) => {
    if (entry.knowledge !== "observed") return [];
    const process = processRecordToActivityProcess(entry.record);
    return process === null ? [] : [process];
  });
  const deduped = [...new Map(processes.map((process) => [process.id, process])).values()];
  const observedAt = knowledge.flatMap((entry) => {
    if (entry.knowledge !== "observed") return [];
    const stamps = [];
    if (entry.record.identity.knowledge === "observed")
      stamps.push(entry.record.identity.stamp.observedAtMs);
    if (entry.record.lifecycle.knowledge === "observed")
      stamps.push(entry.record.lifecycle.stamp.observedAtMs);
    if (entry.record.pipeline.knowledge === "observed")
      stamps.push(entry.record.pipeline.stamp.observedAtMs);
    return stamps;
  });
  if (read.running.query.status === "observed")
    observedAt.push(read.running.query.stamp.observedAtMs);
  const atMs = observedAt.length === 0 ? undefined : Math.max(...observedAt);
  if (read.running.query.status !== "observed" && deduped.length === 0) {
    return {
      ...EMPTY_PROJECT_ACTIVITY_SNAPSHOT,
      processHistory: read.processHistory,
      ...(unavailableReason ? { unavailableReason } : {}),
      ...(reconnecting ? { reconnecting: true as const } : {}),
    };
  }
  const required = read.observation.required;
  return {
    processes: deduped,
    atMs,
    live: required.length > 0 && required.every((interest) => interest.status === "observing"),
    processHistory: read.processHistory,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(reconnecting ? { reconnecting: true as const } : {}),
  };
}

/** Demand-scoped activity/history projection: the store reads it while this is drawn. */
export function useProjectActivity(projectId: string | null): ProjectActivitySnapshot {
  useProjectActivityDemand(projectId);
  return useProjectActivityRead(projectId);
}

function useProjectRef(projectId: string | null) {
  const inventory = useZeropsInventory();
  return {
    inventory,
    project: projectId === null ? null : findInventoryProjectRef(inventory, projectId),
  };
}

/**
 * Asks the account store to read a project's activity and its process history
 * (the newest 100) while it is drawn: what is running, streamed, and what ran,
 * held by id.
 */
export function useProjectActivityDemand(projectId: string | null): void {
  const { project } = useProjectRef(projectId);
  const activityDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () => (project === null ? null : { kind: "project-activity", project }),
    [project],
  );
  const historyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null
        ? null
        : { kind: "project-process-history", project, before: null, limit: 100 },
    [project],
  );
  useZeropsDataInterest(activityDescriptor);
  useZeropsDataInterest(historyDescriptor);
}

/**
 * What the account store holds of a project's activity, whoever asked it to
 * read: it reads nothing of its own.
 */
export function useProjectActivityRead(projectId: string | null): ProjectActivitySnapshot {
  const { runtime } = useZeropsData();
  const { inventory, project } = useProjectRef(projectId);
  const activityAtom = useMemo(
    () => (project === null ? EMPTY_PROJECT_ACTIVITY_READ_ATOM : runtime.reads.activity(project)),
    [project, runtime],
  );
  const read = useAtomValue(activityAtom);
  // Withheld at the read while the grant withholds the project (DESIGN §4.2 G12); its demand stays.
  const withheld = projectId !== null && projectAuthority(inventory, projectId).kind === "withheld";
  return useMemo(
    () =>
      read === null || withheld
        ? EMPTY_PROJECT_ACTIVITY_SNAPSHOT
        : projectActivitySnapshotFromRead(read),
    [read, withheld],
  );
}
