/**
 * Where a task's conversation stands now (`taskChain`): the task its Mate is on, as HQ's
 * navigation places it, and whether the Mate is at work — read for the Mate living in the
 * conversation's environment.
 */
import type { EnvironmentId, MateTaskSource } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";

import { hqPlacementsAtom } from "../state/zerops";
import { taskChain, type TaskChain } from "./automatedMate.logic";
import { useProjectMateActivity } from "./useZeropsAgentActivity";
import { useKnownMate } from "./useZeropsMates";

export function useTaskChain(task: MateTaskSource, environmentId: EnvironmentId): TaskChain {
  const projectId = useKnownMate(environmentId)?.projectId;
  const placements = useAtomValue(hqPlacementsAtom);
  const working = useProjectMateActivity(projectId ?? "")?.kind === "working";
  // Not known while the Mate, HQ's placements or its record's task (an older HQ) are not read.
  const current =
    projectId === undefined || placements === null
      ? undefined
      : placements.get(projectId)?.mate?.task;
  return taskChain(task, current, working);
}
