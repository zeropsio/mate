/**
 * The processes of several projects at once — running ones and the newest history — read while
 * this is drawn and the grant admits each project (DESIGN §4.2 G12): what a surface listing many
 * Mates follows each one's own process by, never a clock.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ProjectActivityRead, ProjectRef } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";

import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "../inventoryContext";
import {
  useZeropsAtomSelections,
  useZeropsData,
  type ZeropsAtomSelection,
} from "../zeropsDataContext";
import { projectActivitySnapshotFromRead } from "./useProjectActivity";

/** Each project's processes by id; none for a project not read yet, or one the grant withholds. */
export function useProjectsProcesses(
  projectIds: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<ActivityProcess> | undefined> {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const projects = useMemo(() => {
    const refs = new Map<string, ProjectRef>();
    for (const projectId of projectIds) {
      if (projectAuthority(inventory, projectId).kind === "withheld") continue;
      const ref = findInventoryProjectRef(inventory, projectId);
      if (ref !== null) refs.set(projectId, ref);
    }
    return refs;
  }, [inventory, projectIds]);
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
      new Map(
        [...reads].map(([projectId, read]) => [
          projectId,
          projectActivitySnapshotFromRead(read).processes,
        ]),
      ),
    [reads],
  );
}
