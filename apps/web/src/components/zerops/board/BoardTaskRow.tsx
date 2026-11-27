/**
 * A task put on the Board from this conversation, as its put card holds it once it is there: its
 * title, who has it (a pool Mate's face, or a person's face and their Mate), the change it made and,
 * while a pool Mate asks the person who put it, the question with a field to answer it. Where the
 * task stands is the card's done line (`boardTaskStateWords`). Props only: the card reads its
 * sources.
 */
import { ArrowUpRightIcon } from "lucide-react";
import { useState } from "react";

import type { BoardFace } from "~/zerops/useBoardTasks";

import type { BoardRow } from "../projectAutomation/taskBoard.logic";
import { Button, InlineButton } from "../../ui/button";
import { Card } from "../../ui/card";
import { Text } from "../../ui/text";
import { Textarea } from "../../ui/textarea";
import { MateFace, PersonAvatar } from "../primitives";

/** Where its putter's answer stands: sent, on its way, or refused in HQ's words. */
export type BoardAnswerState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent" }
  | { readonly kind: "refused"; readonly words: string };

export function BoardTaskRowView({
  row,
  face,
  question,
  answer,
  onOpenChange,
}: {
  readonly row: BoardRow;
  /** The face of the Mate that has it, where the reader's list holds it. */
  readonly face: BoardFace | undefined;
  /** What its pool Mate asks, while it waits on an answer; `null`: it asks nothing. */
  readonly question: string | null;
  /** The answer field, offered to its putter while a pool Mate holds it (`answerTaskPermission`). */
  readonly answer?:
    | { readonly state: BoardAnswerState; readonly onSend: (text: string) => void }
    | undefined;
  readonly onOpenChange?: ((href: string) => void) | undefined;
}) {
  const holder = row.holder;
  const who =
    holder === null
      ? null
      : holder.kind === "pool"
        ? (face?.name ?? holder.name)
        : holder.mate === null
          ? `Taken by ${holder.name}`
          : `${holder.name === "you" ? "Your" : `${holder.name}’s`} ${holder.mate}`;
  return (
    <div className="grid min-w-0 gap-2" data-board-task={row.id} data-board-task-lane={row.lane}>
      <div className="flex min-h-7 min-w-0 items-center gap-2.5">
        {holder?.kind === "person" ? (
          <PersonAvatar name={holder.called ?? holder.name} size={20} />
        ) : face === undefined ? null : (
          <MateFace
            shape={face.shape}
            size={20}
            state={row.lane === "progress" ? "working" : row.lane === "waiting" ? "needs" : "idle"}
            tint={face.tint}
          />
        )}
        <Text className="min-w-0 flex-1" truncate variant="heading">
          {row.title}
        </Text>
        {/* Who has it and its change, in the line's quieter step. */}
        <Text className="flex shrink-0 items-center gap-3" render={<span />} variant="remark">
          {who === null ? null : <span>{who}</span>}
          {row.change === null ? null : row.change.external ? (
            <InlineButton render={<a href={row.change.href} rel="noreferrer" target="_blank" />}>
              {row.change.label}
              <ArrowUpRightIcon aria-hidden="true" className="ms-0.5" />
            </InlineButton>
          ) : onOpenChange === undefined ? null : (
            <InlineButton
              onClick={() => {
                if (row.change !== null) onOpenChange(row.change.href);
              }}
            >
              {row.change.label}
            </InlineButton>
          )}
        </Text>
      </div>
      {question === null ? null : (
        <BoardTaskQuestion answer={answer} asker={who ?? "Its Mate"} question={question} />
      )}
    </div>
  );
}

/** What a pool Mate asks its task's putter, and, for them, the field that answers it. */
function BoardTaskQuestion({
  asker,
  question,
  answer,
}: {
  readonly asker: string;
  readonly question: string;
  readonly answer: Parameters<typeof BoardTaskRowView>[0]["answer"];
}) {
  const [text, setText] = useState("");
  const sending = answer?.state.kind === "sending";
  const send = () => {
    if (answer === undefined || text.trim() === "") return;
    answer.onSend(text.trim());
    setText("");
  };
  return (
    <Card size="sm" variant="inset">
      <Text render={<p />} variant="description">
        <span className="font-medium text-foreground">{asker} asks:</span> {question}
      </Text>
      {answer === undefined ? null : (
        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 items-end gap-2">
            <Textarea
              aria-label="Your answer"
              disabled={sending}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Answer it here"
              size="sm"
              value={text}
            />
            <Button
              disabled={sending || text.trim() === ""}
              onClick={send}
              size="sm"
              variant="secondary"
            >
              Send
            </Button>
          </div>
          {answer.state.kind === "sent" ? (
            <Text render={<p />} variant="note">
              Sent. It goes on from your answer.
            </Text>
          ) : answer.state.kind === "refused" ? (
            <Text render={<p />} role="alert" variant="error">
              {answer.state.words}
            </Text>
          ) : null}
        </div>
      )}
    </Card>
  );
}
