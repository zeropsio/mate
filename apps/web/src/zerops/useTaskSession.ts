/**
 * A task's session (`taskSession`), read for the Mate living in the conversation's environment and
 * the task it is of (`sessionTaskId`: its brief's, else the one an older conversation's id names,
 * else the one its Mate is on): HQ's navigation for its Mate's
 * latest task, its activity for whether it works now, its application's board (`hqAppTasks`,
 * read again as navigation says its tasks moved) for the task's own record — and the person's
 * stop of it, the same write and the same record the board's Stop has (`appTaskStops`).
 */
import type { EnvironmentId, MateTaskSource } from "@t3tools/contracts";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";

import { hqPlacementsAtom } from "../state/zerops";
import { recordOf, sessionTaskId, taskSession, type TaskSession } from "./taskSession.logic";
import { useAppTaskSource, useAppTaskStops } from "./useTaskSourceSettings";
import { useProjectMateActivity } from "./useZeropsAgentActivity";
import { useKnownMate } from "./useZeropsMates";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface TaskSessionView {
  readonly session: TaskSession;
  /** The application the task is of: its change opens there. */
  readonly appId: string | null;
  /** Stops the task, once confirmed; `null` while it cannot be stopped from here. */
  readonly stop: (() => void) | null;
}

export function useTaskSession(
  task: MateTaskSource,
  environmentId: EnvironmentId,
  conversationId: string,
  /** HQ's id of the task its brief carries; `null` where it carries none (an older server's). */
  brief: string | null,
): TaskSessionView {
  const projectId = useKnownMate(environmentId)?.projectId;
  const placements = useAtomValue(hqPlacementsAtom);
  const { activeOrganization } = useZeropsSession();
  // HQ takes a task's stop from whoever keeps where its tasks come from: an Owner or Admin.
  const canStop = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  const working = useProjectMateActivity(projectId ?? "")?.kind === "working";
  const placement = projectId === undefined ? undefined : placements?.get(projectId);
  // Not known while the Mate, HQ's placements or its record's task (an older HQ) are not read.
  const current =
    projectId === undefined || placements === null ? undefined : placement?.mate?.task;
  const taskId = sessionTaskId({ brief, conversationId, current });
  const appId = placement?.appId ?? null;
  const board = useAppTaskSource("hqAppTasks", appId);
  const setting = board.read.setting;
  const record = recordOf(taskId, setting.state === "known" ? setting.held : null);
  const stops = useAppTaskStops(appId, taskId === null ? [] : [taskId]);
  const stop = taskId === null ? undefined : stops.stops[taskId];
  const session = taskSession({
    source: task,
    taskId,
    current,
    working,
    record,
    canStop: canStop && appId !== null,
    stop,
  });
  // HQ's refusal of this stop, said once as it lands: one that stood before this view is not news.
  const said = useRef(stop);
  useEffect(() => {
    if (stop === said.current) return;
    said.current = stop;
    if (stop?.kind === "failed" || stop?.kind === "unresolved")
      toastManager.add({ type: "error", title: stop.words });
  }, [stop]);
  return {
    session,
    appId,
    stop: session.stoppable && taskId !== null ? () => stops.stop(taskId) : null,
  };
}
