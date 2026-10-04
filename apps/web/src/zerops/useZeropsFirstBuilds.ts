/**
 * Every listed Mate's first build, as its project's processes say it (`firstBuildState`).
 *
 * A container waiting for its first build (`READY_TO_DEPLOY`) looks the same from its status
 * whether the build is queued, slow or failed: only the build's own process tells. Its project's
 * activity and process history are read while such a container is listed, and no longer — the
 * verdict is the process's, never a clock's.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ProjectActivityRead, ProjectRef } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";

import { projectActivitySnapshotFromRead } from "./activity/useProjectActivity";
import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "./inventoryContext";
import { firstBuildState, type FirstBuildState } from "./mateComing";
import {
  useZeropsAtomSelections,
  useZeropsData,
  type ZeropsAtomSelection,
} from "./zeropsDataContext";

/** A candidate whose container waits for its first build, and where its build's process is read. */
export interface FirstBuildTarget {
  readonly key: string;
  readonly projectId: string;
  readonly serviceId: string;
}

/** The candidates whose container waits for its first build. */
export function firstBuildTargets(
  candidates: ReadonlyArray<Pick<ZeropsCandidate, "key" | "project" | "service">>,
): ReadonlyArray<FirstBuildTarget> {
  return candidates.flatMap((candidate) =>
    candidate.service?.status === "READY_TO_DEPLOY"
      ? [{ key: candidate.key, projectId: candidate.project.id, serviceId: candidate.service.id }]
      : [],
  );
}

/** Each target's first build, by candidate key, from its project's processes as read. */
export function firstBuildsOf(
  targets: ReadonlyArray<FirstBuildTarget>,
  processesOf: (projectId: string) => Parameters<typeof firstBuildState>[0],
): ReadonlyMap<string, FirstBuildState> {
  const builds = new Map<string, FirstBuildState>();
  for (const target of targets) {
    const state = firstBuildState(processesOf(target.projectId), target.serviceId);
    if (state !== undefined) builds.set(target.key, state);
  }
  return builds;
}

export function useZeropsFirstBuilds(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, FirstBuildState> {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const targets = useMemo(() => firstBuildTargets(candidates), [candidates]);
  // Read only where the grant admits the project (DESIGN §4.2 G12).
  const projects = useMemo(() => {
    const refs = new Map<string, ProjectRef>();
    for (const { projectId } of targets) {
      if (projectAuthority(inventory, projectId).kind === "withheld") continue;
      const ref = findInventoryProjectRef(inventory, projectId);
      if (ref !== null) refs.set(projectId, ref);
    }
    return refs;
  }, [inventory, targets]);
  // The projects' ids say what is demanded: a new map of the same ones demands nothing new.
  const identity = [...projects.keys()].sort().join(",");
  useEffect(() => {
    if (projects.size === 0) return;
    const controller = new AbortController();
    for (const project of projects.values()) {
      for (const descriptor of [
        { kind: "project-activity", project } as const,
        { kind: "project-process-history", project, before: null, limit: 100 } as const,
      ]) {
        void Effect.runPromise(
          Effect.scoped(runtime.acquire(descriptor).pipe(Effect.andThen(Effect.never))),
          { signal: controller.signal },
        ).catch(() => undefined);
      }
    }
    return () => {
      controller.abort();
    };
  }, [runtime, identity]);

  const entries = useMemo(
    (): ReadonlyArray<ZeropsAtomSelection<ProjectActivityRead>> =>
      [...projects].map(([projectId, project]) => [projectId, runtime.reads.activity(project)]),
    [projects, runtime],
  );
  const reads = useZeropsAtomSelections(entries);
  return useMemo(
    () =>
      firstBuildsOf(targets, (projectId) => {
        const read = reads.get(projectId);
        return read === undefined ? undefined : projectActivitySnapshotFromRead(read).processes;
      }),
    [reads, targets],
  );
}
