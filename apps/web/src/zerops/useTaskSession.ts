/**
 * A task conversation's session (`taskSession`), read for the Mate living in the conversation's
 * environment — HQ's navigation for its latest task, its activity for whether it works now — and
 * the person's stop of it, sent as the account's operation (`stop-task`).
 */
import type { EnvironmentId, MateTaskSource } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useState } from "react";

import { toastManager } from "~/components/ui/toast";

import { hqPlacementsAtom } from "../state/zerops";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import { useZeropsSession } from "./sessionContext";
import { taskSession, type TaskSession } from "./taskSession.logic";
import { useProjectMateActivity } from "./useZeropsAgentActivity";
import { useKnownMate } from "./useZeropsMates";

export interface TaskSessionView {
  readonly session: TaskSession;
  /** The application the task is of: its change opens there. */
  readonly appId: string | null;
  /** Stops the task; `null` while it cannot be stopped from here. HQ's refusal is a toast. */
  readonly stop: (() => void) | null;
}

export function useTaskSession(
  task: MateTaskSource,
  environmentId: EnvironmentId,
): TaskSessionView {
  const projectId = useKnownMate(environmentId)?.projectId;
  const placements = useAtomValue(hqPlacementsAtom);
  const working = useProjectMateActivity(projectId ?? "")?.kind === "working";
  const operations = useAccountOperationsOptional();
  const orgId = useZeropsSession().activeOrganization?.id ?? null;
  const placement = projectId === undefined ? undefined : placements?.get(projectId);
  // Not known while the Mate, HQ's placements or its record's task (an older HQ) are not read.
  const current =
    projectId === undefined || placements === null ? undefined : placement?.mate?.task;
  const appId = placement?.appId ?? null;
  // The task HQ took a stop of, by its id: it says it is stopping until its Mate says it stopped.
  const [stopAskedOf, setStopAskedOf] = useState<string | null>(null);
  const read = {
    source: task,
    current,
    working,
    // The task's own record on its application's board (`HqAppTasksView`): read where the
    // conversation's task is not its Mate's latest.
    record: undefined,
  };
  const plain = taskSession({ ...read, stopAsked: false });
  const shown =
    plain.taskId !== null && stopAskedOf === plain.taskId
      ? taskSession({ ...read, stopAsked: true })
      : plain;
  const taskId = shown.taskId;
  const stop = useCallback(() => {
    if (operations === null || orgId === null || appId === null || taskId === null) return;
    setStopAskedOf(taskId);
    operations
      .run({ kind: "stop-task", orgId, appId, taskId }, { orgId, unobserved: HQ_UNFOLLOWED })
      .catch((cause: unknown) => {
        setStopAskedOf(null);
        toastManager.add({
          type: "error",
          title: cause instanceof Error ? cause.message : "HQ did not stop the task.",
        });
      });
  }, [appId, operations, orgId, taskId]);
  const canStop = shown.stoppable && operations !== null && orgId !== null && appId !== null;
  return { session: shown, appId, stop: canStop ? stop : null };
}
