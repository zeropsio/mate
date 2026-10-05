/**
 * The processes of several projects at once — running ones and the newest history — read while
 * this is drawn and the grant admits each project (DESIGN §4.2 G12): what a surface listing many
 * Mates follows each one's own process by, never a clock.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ProjectActivityRead, ProjectRef } from "@t3tools/client-runtime/zerops/data";
import { useMemo } from "react";

import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "../inventoryContext";
import { useInterestLeases } from "../useInterestLeases";
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
  useInterestLeases(
    useMemo(
      () =>
        [...projects.values()].flatMap((project) => [
          { kind: "project-activity", project } as const,
          { kind: "project-process-history", project, before: null, limit: 100 } as const,
        ]),
      [projects],
    ),
  );

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
