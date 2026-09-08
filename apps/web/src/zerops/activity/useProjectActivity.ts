import { useAtomValue } from "@effect/atom-react";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import {
  processRecordToActivityProcess,
  type ProjectActivityRead,
  type RuntimeInterestDescriptor,
} from "@t3tools/client-runtime/zerops/data";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { findInventoryProjectRef, useZeropsInventory } from "../inventoryContext";
import { useZeropsData, useZeropsDataInterest } from "../zeropsDataContext";

export interface ProjectActivitySnapshot {
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  readonly atMs: number | undefined;
  readonly unavailableReason?: string | undefined;
}

export const EMPTY_PROJECT_ACTIVITY_SNAPSHOT: ProjectActivitySnapshot = {
  processes: undefined,
  atMs: undefined,
};

const EMPTY_PROJECT_ACTIVITY_READ_ATOM = Atom.make<ProjectActivityRead | null>(null).pipe(
  Atom.withLabel("zerops:project-activity-read-empty"),
);

export function projectActivitySnapshotFromRead(
  read: ProjectActivityRead,
): ProjectActivitySnapshot {
  const failed = read.observation.required.find((interest) => interest.status === "failed");
  const access = read.observation.access;
  const unavailableReason =
    access.status === "expired"
      ? "expired-session"
      : access.status === "denied"
        ? access.scope.kind === "project"
          ? "forbidden"
          : "expired-session"
        : failed?.reason;
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
      ...(unavailableReason ? { unavailableReason } : {}),
    };
  }
  return {
    processes: deduped,
    atMs,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

/** Demand-scoped activity/history projection. */
export function useProjectActivity(projectId: string | null): ProjectActivitySnapshot {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const project = projectId === null ? null : findInventoryProjectRef(inventory, projectId);
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
  const activityAtom = useMemo(
    () => (project === null ? EMPTY_PROJECT_ACTIVITY_READ_ATOM : runtime.reads.activity(project)),
    [project, runtime],
  );
  const read = useAtomValue(activityAtom);
  return useMemo(
    () => (read === null ? EMPTY_PROJECT_ACTIVITY_SNAPSHOT : projectActivitySnapshotFromRead(read)),
    [read],
  );
}
