/**
 * Linking a taken task's change to its task: a change a conversation opens is the task in hand's,
 * the task a person took from the Board into it last, so HQ ends the task when it merges.
 *
 * @module engine/domain/decide.taskChange
 */
import type { StepBuilder } from "./decide.step.ts";
import { taskInHand } from "./state.ts";

/** What a `task.change` effect asks HQ: this Mate's change `repo#number` linked to `taskId`. */
export interface TaskChangePayload {
  readonly taskId: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * A change the conversation opened, linked to the task in hand; a conversation no task was taken
 * into links nothing. zcp answers the change open on a branch to every open of it, and
 * each answer asks the link again: HQ takes a link it already holds as done.
 */
export const askTaskChangeLink = (
  b: StepBuilder,
  change: { readonly repo: string; readonly number: number },
): void => {
  const taskId = taskInHand(b.state);
  if (taskId === undefined) return;
  b.effect("task.change", `${b.state.conversationId}/task-change`, b.state.headSeq, null, {
    taskId,
    repo: change.repo,
    number: change.number,
  } satisfies TaskChangePayload);
};
