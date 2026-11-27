/**
 * A plan the Mate proposed for the application's Board, as its one card in the conversation draws
 * it: where it goes (the project), the Mate's why, then its tasks in the order they go — each its
 * number, its title and brief (editable while it waits) and what it waits for ("After #1") — with
 * one **Put on board** that puts the whole plan, all or nothing, and Not now. Once it is there, the
 * card follows each task it became (`BoardTaskRowView`), and its done line counts where they stand.
 * Props only: `BoardAskCardContainer` reads its sources.
 */
import { BOARD_BRIEF_MAX, BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";

import { AskCard, AskFooter } from "../../ask/AskCard";
import { NOT_NOW, type AskState } from "../../ask/ask.logic";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { Textarea } from "../../ui/textarea";
import { PUT_ON_BOARD } from "./BoardAskCard";
import { BoardTaskRowView } from "./BoardTaskRow";

/** One task of the plan as its card draws it. */
export interface BoardPlanCardTask {
  readonly key: string;
  readonly title: string;
  readonly brief: string;
  /** What it waits for, in the plan's numbers (`planNeedsWords`); `null`: nothing. */
  readonly after: string | null;
  /** The task it became, once on the Board and read (`BoardTaskRowView`'s props). */
  readonly task: Parameters<typeof BoardTaskRowView>[0] | null;
}

export function BoardPlanCardView({
  requestId,
  appName,
  mateName,
  tasks,
  state,
  editable,
  ready,
  onTitle,
  onBrief,
  onPut,
  onNotNow,
  put,
}: {
  readonly requestId: string;
  /** The application whose Board it goes on; `null` while not known. */
  readonly appName: string | null;
  readonly mateName: string;
  readonly tasks: ReadonlyArray<BoardPlanCardTask>;
  readonly state: AskState;
  /** Its titles and briefs stand as fields: it waits, its put is under way (held), or failed. */
  readonly editable: boolean;
  /** Put on board may be pressed: every title and brief is written and the application is known. */
  readonly ready: boolean;
  readonly onTitle: (at: number, title: string) => void;
  readonly onBrief: (at: number, brief: string) => void;
  readonly onPut: () => void;
  readonly onNotNow: () => void;
  /**
   * It is on the Board (its tasks' ids are known): a task the Board has not answered yet stands as
   * its row's shape, so the row lands with no text swapped and no height changed.
   */
  readonly put: boolean;
}) {
  const held = state.kind === "working";
  return (
    <div data-board-request={requestId} data-board-request-face={state.kind}>
      <AskCard
        askId={requestId}
        density="full"
        footer={
          <AskFooter
            action={
              state.kind === "failed" ? (
                // A refusal that a resend will not change has its way out beside Try again.
                <span className="flex items-center gap-2">
                  <Button onClick={onPut} size="md" variant="secondary">
                    Try again
                  </Button>
                  <Button onClick={onNotNow} size="md" variant="ghost">
                    {NOT_NOW}
                  </Button>
                </span>
              ) : undefined
            }
            density="full"
            main={{ label: PUT_ON_BOARD, onPress: onPut, disabled: !ready }}
            note={
              appName === null
                ? "All of it or none. Everyone in the project can read it."
                : `All of it or none. Everyone in ${appName} can read it.`
            }
            onNotNow={onNotNow}
            state={state}
          />
        }
        kind="board"
        state={state.kind}
        title={`Put this plan of ${String(tasks.length)} tasks on the Board`}
        where={{ scope: "project", detail: appName }}
        why={{
          who: mateName,
          words: "Each task goes to whoever takes it, once what it waits for is merged.",
        }}
      >
        <ol className="m-0 grid min-w-0 list-none gap-3 p-0">
          {tasks.map((task, at) => (
            <li
              className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2"
              data-board-plan-task={task.key}
              key={task.key}
            >
              <Text className="pt-1.5 tabular-nums" render={<span />} variant="remark">
                {at + 1}
              </Text>
              <div className="grid min-w-0 gap-1.5">
                {editable ? (
                  <>
                    <Input
                      aria-label={`Title of task ${String(at + 1)}`}
                      disabled={held}
                      maxLength={BOARD_TITLE_MAX}
                      onChange={(event) => onTitle(at, event.target.value)}
                      value={task.title}
                    />
                    <Textarea
                      aria-label={`Brief of task ${String(at + 1)}`}
                      disabled={held}
                      maxLength={BOARD_BRIEF_MAX}
                      onChange={(event) => onBrief(at, event.target.value)}
                      size="sm"
                      value={task.brief}
                    />
                  </>
                ) : task.task !== null ? (
                  <BoardTaskRowView {...task.task} />
                ) : put ? (
                  <span aria-hidden="true" className="flex min-h-7 items-center">
                    <Skeleton className="h-3.5 w-1/2" surface="card" />
                  </span>
                ) : (
                  <Text className="pt-1" render={<p />} truncate variant="heading">
                    {task.title}
                  </Text>
                )}
                {task.after === null ? null : (
                  <Text render={<p />} variant="note">
                    {task.after}
                  </Text>
                )}
              </div>
            </li>
          ))}
        </ol>
      </AskCard>
    </div>
  );
}
