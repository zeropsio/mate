/**
 * A task conversation's session (`taskSession`), read for the Mate living in the conversation's
 * environment — HQ's navigation for its latest task, its activity for whether it works now, its
 * application's board (`hqAppTasks`) for a task before it — and the person's stop of it, the same
 * write the board's Stop sends (`task-stop`).
 */
import type { EnvironmentId, MateTaskSource } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";

import { hqPlacementsAtom } from "../state/zerops";
import { recordOf, taskSession, type TaskSession } from "./taskSession.logic";
import { useAppTaskSource } from "./useTaskSourceSettings";
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
  const placement = projectId === undefined ? undefined : placements?.get(projectId);
  // Not known while the Mate, HQ's placements or its record's task (an older HQ) are not read.
  const current =
    projectId === undefined || placements === null ? undefined : placement?.mate?.task;
  const appId = placement?.appId ?? null;
  const board = useAppTaskSource("hqAppTasks", appId);
  const setting = board.read.setting;
  const record =
    projectId === undefined
      ? undefined
      : recordOf(task, projectId, setting.state === "known" ? setting.held : null);
  // The task HQ was asked to stop, by its id: it says it is stopping until its Mate says it stopped.
  const [stopAskedOf, setStopAskedOf] = useState<string | null>(null);
  const read = { source: task, current, working, record };
  const plain = taskSession({ ...read, stopAsked: false });
  const shown =
    plain.taskId !== null && stopAskedOf === plain.taskId
      ? taskSession({ ...read, stopAsked: true })
      : plain;
  const taskId = shown.taskId;
  const { action } = board.read;
  // Where the board's writes stood at the press: a refusal shown before it is not this stop's.
  const before = useRef(action);
  useEffect(() => {
    if (stopAskedOf === null || action === before.current) return;
    if (action.kind !== "failed" && action.kind !== "unresolved") return;
    setStopAskedOf(null);
    toastManager.add({ type: "error", title: action.words });
  }, [action, stopAskedOf]);
  const stop = () => {
    if (taskId === null) return;
    before.current = action;
    setStopAskedOf(taskId);
    board.write({ kind: "task-stop", taskId });
  };
  const canStop = shown.stoppable && appId !== null;
  return { session: shown, appId, stop: canStop ? stop : null };
}
