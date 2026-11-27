/**
 * Work proposed for the application's Board, as its card in the conversation draws it: where it
 * goes (the project), the Mate's why, then its title and brief, editable while it waits, with
 * **Put on board** and Not now. Once it is there, the card follows the task it became: its row
 * (`BoardTaskRowView`) — who has it, its change, a pool Mate's question with the answer field — and
 * a done line saying where it stands. Props only: `BoardAskCardContainer` reads its sources.
 */
import { BOARD_BRIEF_MAX, BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";

import { AskCard, AskFooter } from "../../ask/AskCard";
import type { AskState } from "../../ask/ask.logic";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Text } from "../../ui/text";
import { Textarea } from "../../ui/textarea";
import { BoardTaskRowView } from "./BoardTaskRow";

/** The card's main press and its title: what it does. */
export const PUT_ON_BOARD = "Put on board";

export function BoardAskCardView({
  requestId,
  appName,
  mateName,
  title,
  brief,
  state,
  editable,
  ready,
  task,
  onTitle,
  onBrief,
  onPut,
  onNotNow,
}: {
  readonly requestId: string;
  /** The application whose Board it goes on; `null` while not known. */
  readonly appName: string | null;
  readonly mateName: string;
  readonly title: string;
  readonly brief: string;
  readonly state: AskState;
  /**
   * Its title and brief stand as fields: it waits, its put is under way (held), or failed before
   * HQ took it.
   */
  readonly editable: boolean;
  /** Put on board may be pressed: both are written and the application is known. */
  readonly ready: boolean;
  /** The task it became, once on the Board and read (`BoardTaskRowView`'s props). */
  readonly task: Parameters<typeof BoardTaskRowView>[0] | null;
  readonly onTitle: (title: string) => void;
  readonly onBrief: (brief: string) => void;
  readonly onPut: () => void;
  readonly onNotNow: () => void;
}) {
  return (
    <div data-board-request={requestId} data-board-request-face={state.kind}>
      <AskCard
        askId={requestId}
        density="full"
        footer={
          <AskFooter
            action={
              state.kind === "failed" ? (
                <Button onClick={onPut} size="md" variant="secondary">
                  Try again
                </Button>
              ) : undefined
            }
            density="full"
            main={{ label: PUT_ON_BOARD, onPress: onPut, disabled: !ready }}
            note={
              appName === null
                ? "Everyone in the project can read it."
                : `Everyone in ${appName} can read it.`
            }
            onNotNow={onNotNow}
            state={state}
          />
        }
        kind="board"
        state={state.kind}
        title="Put this on the Board"
        where={{ scope: "project", detail: appName }}
        why={{ who: mateName, words: "For whoever takes it: what to do, and why." }}
      >
        {editable ? (
          <div className="grid min-w-0 gap-2">
            <Input
              aria-label="Title"
              disabled={state.kind === "working"}
              maxLength={BOARD_TITLE_MAX}
              onChange={(event) => onTitle(event.target.value)}
              value={title}
            />
            <Textarea
              aria-label="Brief"
              disabled={state.kind === "working"}
              maxLength={BOARD_BRIEF_MAX}
              onChange={(event) => onBrief(event.target.value)}
              size="lg"
              value={brief}
            />
          </div>
        ) : task !== null ? (
          <BoardTaskRowView {...task} />
        ) : (
          <Text render={<p />} truncate variant="heading">
            {title}
          </Text>
        )}
      </AskCard>
    </div>
  );
}
