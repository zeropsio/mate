/**
 * A task's session (`taskSession`), read for the Mate living in the conversation's environment and
 * the task it is of (`sessionTaskId`: its brief's, else the one an older conversation's id names,
 * else the one its Mate is on): HQ's navigation for its Mate's
 * latest task, its activity for whether it works now, its application's board (`hqAppTasks`,
 * read again as navigation says its tasks moved) for the task's own record — and the person's
 * stop of it, offered by the Board's one Stop rule (`boardOffers`), the same write and the same
 * record the Board's Stop has (`appTaskWrites`).
 */
import type { EnvironmentId, MateTaskSource } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { toastManager } from "~/lib/toasts";

import { hqPlacementsAtom } from "../state/zerops";
import { recordOf, sessionTaskId, taskSession, type TaskSession } from "./taskSession.logic";
import { useBoardOffers } from "./useBoardTasks";
import { useAppTaskSource, useAppTaskStops, useBoardTaskWrites } from "./useTaskSourceSettings";
import { useProjectMateActivity } from "./useZeropsAgentActivity";
import { useKnownMate } from "./useZeropsMates";

interface TaskSessionView {
  readonly session: TaskSession;
  /** The application the task is of: its change opens there. */
  readonly appId: string | null;
  /** Stops the task, once confirmed; `null` while it cannot be stopped from here. */
  readonly stop: (() => void) | null;
  /** A taken task's Done, for its taker; `null` where it is not offered. */
  readonly done: (() => void) | null;
  /** A taken task given back to the queue, by its taker or an owner or admin; `null`: not offered. */
  readonly release: (() => void) | null;
}

/** HQ's placements, and the project of the Mate living in the environment. */
function useMatePlacement(environmentId: EnvironmentId) {
  return {
    projectId: useKnownMate(environmentId)?.projectId,
    placements: useAtomValue(hqPlacementsAtom),
  };
}

/** The application the Mate living in the environment is of; `null` while not known, or none. */
export function useMateAppId(environmentId: EnvironmentId): string | null {
  const { projectId, placements } = useMatePlacement(environmentId);
  return (projectId === undefined ? undefined : placements?.get(projectId))?.appId ?? null;
}

export function useTaskSession(
  task: MateTaskSource,
  environmentId: EnvironmentId,
  conversationId: string,
  /** HQ's id of the task its brief carries; `null` where it carries none (an older server's). */
  brief: string | null,
  /**
   * This reader says HQ's refusal of the stop: the one surface that stands for the task whatever
   * scrolled (its bar's host), so a refusal is said once however many surfaces read the session.
   */
  announce = false,
): TaskSessionView {
  const { projectId, placements } = useMatePlacement(environmentId);
  const working = useProjectMateActivity(projectId ?? "")?.kind === "working";
  const placement = projectId === undefined ? undefined : placements?.get(projectId);
  // Not known while the Mate, HQ's placements or its record's task (an older HQ) are not read.
  const current =
    projectId === undefined || placements === null ? undefined : placement?.mate?.task;
  const taskId = sessionTaskId({ brief, conversationId, current });
  const appId = placement?.appId ?? null;
  const board = useAppTaskSource("hqAppTasks", appId);
  // The one Stop rule (`stopTaskPermission`): an owner or admin, its putter, or its taker.
  const offers = useBoardOffers(appId);
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
    canStop: taskId !== null && offers?.tasks?.[taskId]?.stop === true,
    stop,
  });
  // HQ's refusal of this stop, said once as it lands: one that stood before this view is not news.
  const said = useRef(stop);
  useEffect(() => {
    if (stop === said.current) return;
    said.current = stop;
    if (announce && (stop?.kind === "failed" || stop?.kind === "unresolved"))
      toastManager.add({ type: "error", title: stop.words });
  }, [announce, stop]);
  const offer = taskId === null ? undefined : offers?.tasks?.[taskId];
  const writes = useBoardTaskWrites(appId);
  // A taken task's chat offers Done and Release; its Stop stays on the Board.
  const taken = offer?.done === true || offer?.release === true;
  return {
    session,
    appId,
    stop: session.stoppable && taskId !== null && !taken ? () => stops.stop(taskId) : null,
    done:
      offer?.done === true && taskId !== null && writes !== null
        ? () => void writes.done(taskId)
        : null,
    release:
      offer?.release === true && taskId !== null && writes !== null
        ? () => void writes.release(taskId)
        : null,
  };
}
