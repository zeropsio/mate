/**
 * A task opened on the Board's page: its head (who has it, wearing its state, and that state in its
 * tone), its title whole, what it waits on the reader for — its Mate's question, answered here
 * where the Board answers it, or a need that broke — then where it came from, who has it, what it
 * needs and what waits on it, its change, its brief in full and its history, and at its foot every
 * press the reader may make, their next act in the primary ink. It reads the Board's row and nothing
 * more: nothing here is fetched or kept.
 */
import { taskStatusTone, type TaskTone } from "~/zerops/taskStatus";
import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode, type Ref } from "react";

import { takeAnswerOnArrival } from "~/zerops/useBoardTasks";
import { cn } from "~/lib/utils";

import { Button, InlineButton } from "../../ui/button";
import { Card } from "../../ui/card";
import { Fact, Facts } from "../../ui/facts";
import { Row } from "../../ui/row";
import { ScrollArea } from "../../ui/scroll-area";
import { Separator } from "../../ui/separator";
import { Text } from "../../ui/text";
import { BoardTaskQuestion } from "../board/BoardTaskRow";
import type { BoardVerbs, BoardView } from "./boardView";
import { faceOfRow, holderName, OpenPress, TaskLead, VerbPress } from "./BoardList";
import type { RowPress } from "./projectAutomation.logic";
import {
  brokenWords,
  refLead,
  rowLead,
  taskStateWords,
  taskVerbs,
  type BoardNeed,
  type BoardRow,
  type BoardTaskRef,
} from "./taskBoard.logic";

const RESTS: RowPress = { kind: "idle" };

/** The ink a state's word stands in, by what it means. */
const TONE_INK: Readonly<Record<TaskTone, string>> = {
  working: "text-status-ok-text",
  needs: "text-status-attention-text",
  review: "text-status-busy-text",
  finished: "text-status-ok-text",
  failed: "text-status-failed-text",
  quiet: "text-muted-foreground",
};

export function TaskPanel({
  row,
  board,
  rows,
  onClose,
  headingRef,
}: {
  readonly row: BoardRow;
  readonly board: BoardView;
  /** Every row of the Board by its task, for the tasks it needs and those waiting on it. */
  readonly rows: ReadonlyMap<string, BoardRow>;
  readonly onClose: () => void;
  /** Its title, which takes the focus as a sheet opens it, so no press lights a ring unasked. */
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  const { verbs } = board;
  const face = faceOfRow(row, board);
  const press = verbs?.pressOf(row.id) ?? RESTS;
  const offer = verbs?.offerOf(row.id);
  const can = taskVerbs({ row, offer, press, stranded: verbs?.strandedOf(row.id) === true });
  const tone = row.broken.length > 0 ? "needs" : taskStatusTone(row.status);
  const asker = holderName(row, face) ?? "Its Mate";
  const answersHere =
    verbs !== undefined && row.answeredHere && row.question !== null && offer?.answer === true;
  return (
    <div
      aria-label={row.title}
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-zerops-surface="board-task-panel"
      role="region"
    >
      <div className="flex min-h-13 shrink-0 items-center gap-2.5 ps-5 pe-3">
        <span className="grid size-5 place-items-center">
          <TaskLead face={face} lead={rowLead(row)} size={20} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-body font-medium", TONE_INK[tone])}>
          {taskStateWords(row)}
        </span>
        <Button aria-label="Close" onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="grid min-w-0 gap-6 px-5 pt-1 pb-6">
          <h2
            className="m-0 text-title leading-7 font-semibold text-balance text-foreground outline-none"
            ref={headingRef}
            tabIndex={-1}
          >
            {row.title}
          </h2>
          {row.question !== null && row.lane === "waiting" ? (
            <Question
              asker={asker}
              board={board}
              row={row}
              verbs={answersHere ? verbs : undefined}
            />
          ) : row.status === "failed" && row.why !== null ? (
            // Why it failed, in its Mate's words; the head already says it failed.
            <Card size="sm" tone="failed" variant="wash">
              <Text className="text-foreground" render={<p />} role="alert" variant="description">
                {row.why}
              </Text>
            </Card>
          ) : row.status === "stopped" && row.why !== null ? (
            <Text render={<p />} variant="description">
              {row.why}
            </Text>
          ) : row.broken.length > 0 ? (
            <Card size="sm" tone="attention" variant="wash">
              <Text render={<p />} variant="description">
                <span className="text-foreground">{`${brokenWords(row.broken)}.`}</span> Drop the
                need and it goes on without it, or stop this task.
              </Text>
            </Card>
          ) : null}
          <Facts>
            <Origin board={board} row={row} />
            {row.holder === null ? null : (
              <Fact label={row.lane === "done" ? "Had it" : "Has it"}>
                <span className="inline-flex max-w-full items-center gap-2 align-top">
                  <span className="grid size-5 shrink-0 place-items-center">
                    <TaskLead
                      face={face}
                      lead={
                        row.holder.kind === "person"
                          ? { kind: "person", name: row.holder.called ?? row.holder.name }
                          : { kind: "mate", projectId: row.holder.projectId, state: "idle" }
                      }
                      size={20}
                    />
                  </span>
                  <span className="min-w-0 tabular-nums">
                    {[
                      holderWords(row, face),
                      row.time,
                      row.worked === null ? null : `worked ${row.worked}`,
                      row.cost,
                    ]
                      .filter((said) => said !== null && said !== "")
                      .join(" · ")}
                  </span>
                </span>
              </Fact>
            )}
            {row.needs.length === 0 ? null : (
              <Fact label="Needs">
                <Refs board={board} refs={row.needs} rows={rows} />
              </Fact>
            )}
            {row.waiters.length === 0 ? null : (
              <Fact label="Waiting on it">
                <Refs board={board} refs={row.waiters} rows={rows} />
              </Fact>
            )}
            {row.change === null ? null : (
              <Fact label="Change">
                <ChangeLink board={board} change={row.change} />
              </Fact>
            )}
          </Facts>
          {row.brief === null ? null : (
            <Part title="Brief">
              <Card size="sm" variant="inset">
                <p className="m-0 text-prose whitespace-pre-wrap text-foreground">{row.brief}</p>
              </Card>
            </Part>
          )}
          {row.history.length === 0 ? null : (
            <Part title="History">
              <ol className="m-0 grid list-none gap-1.5 p-0">
                {row.history.map((event) => (
                  <li
                    className="flex min-w-0 items-baseline justify-between gap-4 text-line leading-5"
                    key={event.kind}
                  >
                    <span className="min-w-0 text-foreground">{event.words}</span>
                    <Text className="shrink-0" render={<span />} variant="meta">
                      {event.at}
                    </Text>
                  </li>
                ))}
              </ol>
            </Part>
          )}
        </div>
      </ScrollArea>
      <Actions board={board} can={can} press={press} row={row} verbs={verbs} />
    </div>
  );
}

/** Who has it, in the panel's words: a pool Mate by name, a person and their Mate. */
function holderWords(row: BoardRow, face: Parameters<typeof holderName>[1]): string | null {
  const { holder } = row;
  if (holder === null) return null;
  if (holder.kind === "pool") return holderName(row, face);
  const whose = holder.name === "you" ? "Your" : `${holder.name}’s`;
  return holder.mate === null ? holder.name : `${whose} ${holder.mate}`;
}

/** A labelled part of the panel: its label 8 px over what it holds. */
function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <Text render={<h3 />} variant="label">
        {title}
      </Text>
      {children}
    </section>
  );
}

/**
 * Where it came from: who put it, from whose chat (back to it where the reader can open that
 * Mate), else its source, linked out; and how long ago.
 */
function Origin({ row, board }: { readonly row: BoardRow; readonly board: BoardView }) {
  const { origin } = row;
  const put = row.history.find((event) => event.kind === "put")?.at;
  const { conversation } = origin;
  const open = board.onOpenConversation;
  return (
    <Fact label={origin.putBy === null ? "Came from" : "Put on board"}>
      {origin.putBy === null ? (
        origin.url === null ? (
          origin.words
        ) : (
          <InlineButton render={<a href={origin.url} rel="noreferrer" target="_blank" />}>
            {origin.words}
            <ArrowUpRightIcon aria-hidden="true" />
          </InlineButton>
        )
      ) : (
        <>
          {origin.putBy === "you" ? "You" : origin.putBy}
          {origin.chat === null ? null : (
            <>
              {", in "}
              {conversation !== null && open !== undefined ? (
                <InlineButton
                  onClick={() => {
                    open(conversation);
                  }}
                >
                  {origin.chat}’s chat
                </InlineButton>
              ) : (
                `${origin.chat}’s chat`
              )}
            </>
          )}
        </>
      )}
      {put === undefined ? null : (
        <span className="text-muted-foreground tabular-nums">{` · ${put}`}</span>
      )}
    </Fact>
  );
}

/** Its change: its pull request on GitHub, out; its change in Mate, in place. */
function ChangeLink({
  change,
  board,
}: {
  readonly change: NonNullable<BoardRow["change"]>;
  readonly board: BoardView;
}) {
  if (change.external)
    return (
      <InlineButton render={<a href={change.href} rel="noreferrer" target="_blank" />}>
        {change.label}
        <ArrowUpRightIcon aria-hidden="true" />
      </InlineButton>
    );
  return (
    <InlineButton
      onClick={() => {
        board.onOpen(change.href);
      }}
    >
      {change.label}
    </InlineButton>
  );
}

/**
 * Tasks named beside this one, each by its mark and title: one the Board holds opens its own panel;
 * one it no longer holds is only named.
 */
function Refs({
  refs,
  rows,
  board,
}: {
  readonly refs: ReadonlyArray<BoardNeed | BoardTaskRef>;
  readonly rows: ReadonlyMap<string, BoardRow>;
  readonly board: BoardView;
}) {
  return (
    <ul className="-mx-1.5 m-0 grid list-none gap-0.5 p-0">
      {refs.map((ref) => {
        const row = rows.get(ref.taskId);
        const pick = board.onPick;
        const title = ref.title ?? "A task that ended";
        const lead = (
          <TaskLead
            face={row === undefined ? undefined : faceOfRow(row, board)}
            lead={refLead("state" in ref ? ref : {}, row)}
            size={20}
          />
        );
        return (
          <li className="min-w-0" key={ref.taskId}>
            {row === undefined || pick === undefined ? (
              <Row lead={lead} size="xs" title={title} />
            ) : (
              <Row
                lead={lead}
                onClick={() => {
                  pick(row.id);
                }}
                pressable
                render={<button type="button" />}
                size="xs"
                title={title}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What its Mate asks, in the attention's wash: with the field that answers it where the Board
 * answers it (a task put on the Board itself, to the person who put it), else the way to its
 * conversation, where it is answered.
 */
function Question({
  row,
  board,
  verbs,
  asker,
}: {
  readonly row: BoardRow;
  readonly board: BoardView;
  /** The reader's presses, where they answer it here; absent: answered in its conversation. */
  readonly verbs: BoardVerbs | undefined;
  readonly asker: string;
}) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (verbs !== undefined && takeAnswerOnArrival(row.id)) field.current?.focus();
  }, [verbs, row.id]);
  if (row.question === null) return null;
  const whom = row.asks === null || row.asks === "you" ? "" : ` ${row.asks}`;
  return (
    <BoardTaskQuestion
      answer={
        verbs === undefined
          ? undefined
          : {
              state: verbs.answerOf(row.id),
              onSend: (text) => {
                verbs.onAnswer(row.id, text);
              },
            }
      }
      asker={`${asker} asks${whom}`}
      fieldRef={field}
      question={row.question}
      wash
    >
      {verbs !== undefined || row.route === null ? null : (
        <div>
          <OpenPress
            href={row.route}
            label="Answer in its conversation"
            onOpen={board.onOpen}
            size="sm"
            variant="secondary"
          />
        </div>
      )}
    </BoardTaskQuestion>
  );
}

/**
 * The panel's foot: Stop on its own at the start (asked first, in place: Keep or Stop), the rest at
 * the end — Release, Done, its conversation — and the reader's next act last, in the primary ink,
 * where the foot holds it (Take, Review, Done, Drop the need, a stranded Take's conversation); where
 * the body holds it (an answer), every press here is secondary. A refusal is said over them in HQ's
 * words; a write under way, in its own.
 */
function Actions({
  row,
  board,
  verbs,
  press,
  can,
}: {
  readonly row: BoardRow;
  readonly board: BoardView;
  readonly verbs: BoardVerbs | undefined;
  readonly press: RowPress;
  readonly can: ReturnType<typeof taskVerbs>;
}) {
  // The answer is the question's own: its field, or its way to the conversation.
  const primary = can.primary === "answer" ? null : can.primary;
  const asking = press.kind === "asking";
  const nothing = primary === null && !can.release && !can.done && !can.stop && !can.conversation;
  if (nothing && press.kind === "idle") return null;
  return (
    <div className="shrink-0">
      <Separator />
      <div className="grid gap-2 px-5 py-3">
        {press.kind === "refused" ? (
          <Text render={<p />} role="alert" variant="error">
            {press.words}
          </Text>
        ) : press.kind === "working" ? (
          <Text render={<p />} variant="note">
            {press.words ?? "…"}
          </Text>
        ) : null}
        {asking && verbs !== undefined ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Text className="me-auto min-w-0" render={<p />} variant="description">
              {stopQuestion(row, holderName(row, faceOfRow(row, board)))}
            </Text>
            <Button onClick={verbs.onKeep} size="sm" variant="ghost">
              Keep
            </Button>
            <Button
              onClick={() => {
                verbs.onStop(row.id);
              }}
              size="sm"
              variant="destructive"
            >
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {verbs !== undefined && can.stop ? (
              <Button
                className="me-auto"
                onClick={() => {
                  verbs.onAsk(row.id);
                }}
                size="sm"
                variant="ghost"
              >
                Stop…
              </Button>
            ) : null}
            {verbs !== undefined && can.release ? (
              <Button
                onClick={() => {
                  verbs.onRelease(row.id);
                }}
                size="sm"
                variant="secondary"
              >
                Release
              </Button>
            ) : null}
            {verbs !== undefined && can.done ? (
              <Button
                onClick={() => {
                  verbs.onDone(row.id);
                }}
                size="sm"
                variant="secondary"
              >
                Done
              </Button>
            ) : null}
            {can.conversation && row.route !== null ? (
              <OpenPress
                href={row.route}
                label="Open its conversation"
                onOpen={board.onOpen}
                size="sm"
                variant="secondary"
              />
            ) : null}
            {verbs === undefined || primary === null ? null : (
              <VerbPress board={board} row={row} variant="primary" verb={primary} verbs={verbs} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** What Stop asks: who stops, and what of it is lost. */
function stopQuestion(row: BoardRow, holder: string | null): string {
  if (row.lane === "queued" || row.status === "held")
    return "Stop this task? Nobody has taken it yet.";
  if (row.holder?.kind === "person") return "Stop this task? It leaves the Board.";
  return `Stop this task? ${holder ?? "Its Mate"} stops where it got to.`;
}
