/**
 * A task, as its conversation shows it: the conversation opening with the task, the way an issue
 * page opens — where it came from, its title, what its asker wrote, how long it worked, what it
 * cost, the change and pull request it made, and at its foot where it stands on the Board with the
 * reader's presses (`MateTaskCard`, `TaskStanding`); the same over the column while the card is
 * scrolled away (`MateTaskBar`); an
 * automated Mate's question as the Mate asking (`TaskQuestionView`). The words the agent got with
 * it are its brief, never the person's, so they are never drawn; what people say about the task
 * afterwards, told to its Mate, is drawn as theirs, said where (`MateTaskMessageRow`).
 */
import {
  mateTaskSourceAuthor,
  mateTaskSourceLabel,
  mateTaskSourceLink,
  type EnvironmentId,
  type MateTaskMessage,
  type MateTaskSource,
} from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  HashIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  SquareKanbanIcon,
  TimerIcon,
  WebhookIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode, type Ref } from "react";

import {
  pullRequestName,
  taskAskBeyondTitle,
  type ConversationTask,
} from "~/zerops/automatedMate.logic";
import { spentWords, type TaskSession } from "~/zerops/taskSession.logic";
import { type TaskTone, workedWords } from "~/zerops/taskStatus";
import { useMateAppId, useTaskSession } from "~/zerops/useTaskSession";
import { useOpenTaskConversation } from "~/zerops/useBoardTasks";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useHqPersonNames, useViewerCalled } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { projectNameInApp, zeropsAccountDisplay } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import {
  laneOf,
  laneState,
  putOrigin,
  TAKEN_TASK_PRESSES,
} from "./projectAutomation/taskBoard.logic";
import { taskCardKey, useTaskCardSight, useWatchTaskCard } from "./taskCardSight";
import {
  taskMessageOrigin,
  taskMessageWords,
  type TaskMessageOrigin,
} from "./mateTaskMessage.logic";

import { cn } from "~/lib/utils";

import { GitHubIcon } from "../Icons";
import { Badge, type BadgeTone } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Separator } from "../ui/separator";
import { Card } from "~/components/ui/card";
import { Text } from "~/components/ui/text";

/** "acme/tea-shop#12 · opened by nova-dev": where the task came from, and whose it is. */
function mateTaskCardSource(task: MateTaskSource): string {
  const where = mateTaskSourceLabel(task);
  const author = mateTaskSourceAuthor(task);
  return author === null ? where : `${where} · opened by ${author}`;
}

/** A status's dot: finished and quiet are both neutral, the words beside it tell them apart. */
const TASK_DOT: Readonly<Record<TaskTone, BadgeTone>> = {
  working: "success",
  needs: "warning",
  review: "info",
  finished: "neutral",
  failed: "danger",
  quiet: "neutral",
};

const NOT_KNOWN: TaskSession = {
  status: null,
  taskId: null,
  stoppable: false,
  workedMs: null,
  spentUsd: null,
  change: null,
  pullRequest: null,
};

/**
 * Where a task came from, as a mark: GitHub's, a Slack channel's, a Discord thread, a webhook, a
 * schedule, a conversation, the Board itself.
 */
function SourceMark({ source }: { readonly source: MateTaskSource }) {
  const className = "size-3.5 shrink-0";
  switch (source.kind) {
    case "github-issue":
      return <GitHubIcon aria-hidden="true" className={className} />;
    case "slack-thread":
      return <HashIcon aria-hidden="true" className={className} />;
    case "discord-thread":
      return <MessagesSquareIcon aria-hidden="true" className={className} />;
    case "webhook":
      return <WebhookIcon aria-hidden="true" className={className} />;
    case "schedule":
      return <CalendarClockIcon aria-hidden="true" className={className} />;
    case "conversation":
      return <MessageSquareIcon aria-hidden="true" className={className} />;
    case "board":
      return <SquareKanbanIcon aria-hidden="true" className={className} />;
  }
}

/** Where a task stands on its application's Board: its panel opens there (`?task=`). */
interface TaskOnBoard {
  readonly groupId: string;
  readonly taskId: string;
}

/** What the reader may do with a task from its conversation; each absent where it is not offered. */
export interface TaskActs {
  /** Where its panel opens on the Board; `null` while not known: nothing to press. */
  readonly board: TaskOnBoard | null;
  /** Stops it, asked first: an automated Mate's task, for an Owner or Admin while it can stop. */
  readonly onStop?: (() => void) | undefined;
  /** A task the person took: marks it done (its taker), or puts it back on the Board's queue. */
  readonly onDone?: (() => void) | undefined;
  readonly onRelease?: (() => void) | undefined;
}

const NO_ACTS: TaskActs = { board: null };

/** A task's session and its presses, as its card and its bar read them (`useTaskSession`). */
function useTaskActs(
  task: ConversationTask,
  environmentId: EnvironmentId,
  conversationId: string,
  announce = false,
): { readonly session: TaskSession; readonly appId: string | null; readonly acts: TaskActs } {
  const { session, appId, stop, done, release } = useTaskSession(
    task.source,
    environmentId,
    conversationId,
    task.taskId,
    announce,
  );
  return {
    session,
    appId,
    acts: {
      board:
        appId === null || session.taskId === null
          ? null
          : { groupId: appId, taskId: session.taskId },
      onStop: stop ?? undefined,
      onDone: done ?? undefined,
      onRelease: release ?? undefined,
    },
  };
}

/**
 * Where a task stands, in the word of the lane its Board stands it in and that lane's tone
 * (`laneState`), and the reader's presses on it: Stop, asked first in place; for a task a person
 * took, Mark done and Put back; and Open on the Board. One for the card's foot and the bar's end,
 * so both say the same words. Until where it stands is read, the word keeps its room unseen.
 */
export function TaskStanding({
  session,
  acts,
}: {
  readonly session: TaskSession;
  readonly acts: TaskActs;
}) {
  const { status } = session;
  const state = status === null ? null : laneState(laneOf(status), status);
  const [asking, setAsking] = useState(false);
  const { board, onStop, onDone, onRelease } = acts;
  const confirming = asking && onStop !== undefined;
  return (
    <>
      <span
        className={cn("flex shrink-0", state === null && "invisible")}
        data-zerops-surface="mate-task-status"
      >
        {/* Its blue is a change to look at, not work under way: it does not breathe. */}
        <Badge dot pulse={false} tone={state === null ? "neutral" : TASK_DOT[state.tone]}>
          <span data-zerops-surface="mate-task-status-words">
            {state === null ? " " : state.words}
          </span>
        </Badge>
      </span>
      {confirming ? (
        <span
          className="ms-auto flex min-w-0 items-center gap-1"
          data-zerops-surface="mate-task-stop-ask"
        >
          <span className="min-w-0 truncate text-muted-foreground">
            Stop this task? Its Mate stops where it got to.
          </span>
          <Button
            onClick={() => {
              setAsking(false);
            }}
            size="sm"
            variant="ghost"
          >
            Keep
          </Button>
          <Button
            onClick={() => {
              setAsking(false);
              onStop?.();
            }}
            size="sm"
            variant="destructive"
          >
            Stop
          </Button>
        </span>
      ) : (
        <span className="ms-auto flex shrink-0 items-center gap-1">
          {onStop === undefined ? null : (
            <Button
              onClick={() => {
                setAsking(true);
              }}
              size="sm"
              variant="secondary"
            >
              Stop
            </Button>
          )}
          {onDone === undefined ? null : (
            <Button onClick={onDone} size="sm" variant="secondary">
              {TAKEN_TASK_PRESSES.done}
            </Button>
          )}
          {onRelease === undefined ? null : (
            <Button
              aria-label={TAKEN_TASK_PRESSES.releaseName}
              onClick={onRelease}
              size="sm"
              variant="ghost"
            >
              {TAKEN_TASK_PRESSES.release}
            </Button>
          )}
          {board === null ? null : (
            <Button
              render={
                <Link
                  params={{ groupId: board.groupId }}
                  search={{ task: board.taskId }}
                  to="/group/$groupId/board"
                />
              }
              size="sm"
              variant="ghost"
            >
              Open on the Board
            </Button>
          )}
        </span>
      )}
    </>
  );
}

/**
 * A conversation's tasks over the top of its column: the live ones (any not Done) whose card is out
 * of sight (`taskCardSight`), the newest drawn whole — where it came from as a mark, its title,
 * where it stands and its presses, the card's own (`TaskStanding`) — and how many more stand
 * behind it. It overlays the timeline on the page's ground and moves nothing in it; it fades and
 * rises in, and is gone again once the card is back. A refusal of a task's stop is said here,
 * once: the bar's watch stands for every task of the conversation, its card mounted or not.
 */
export function MateTaskBar({
  tasks,
  environmentId,
  conversationId,
}: {
  /** Every task the conversation carried, oldest first (`conversationTasks`). */
  readonly tasks: ReadonlyArray<ConversationTask>;
  readonly environmentId: EnvironmentId;
  readonly conversationId: string;
}) {
  // Which tasks' bars stand, by their card's key, as each task's watch says it.
  const [standing, setStanding] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const report = useCallback((key: string, stands: boolean) => {
    setStanding((before) =>
      (before.get(key) ?? false) === stands ? before : new Map(before).set(key, stands),
    );
  }, []);
  const keys = tasks.map((task) => taskCardKey({ environmentId, conversationId, ...task }));
  const stand = keys.filter((key) => standing.get(key) === true);
  const lead = stand.at(-1);
  return tasks.map((task, index) => (
    <TaskBarWatch
      acts={{ environmentId, conversationId, task }}
      cardKey={keys[index]!}
      key={keys[index]}
      lead={keys[index] === lead}
      more={stand.length - 1}
      onStands={report}
    />
  ));
}

/** One task's watch: whether its bar stands, and the bar itself while it leads. */
function TaskBarWatch({
  acts: { task, environmentId, conversationId },
  cardKey,
  lead,
  more,
  onStands,
}: {
  readonly acts: {
    readonly task: ConversationTask;
    readonly environmentId: EnvironmentId;
    readonly conversationId: string;
  };
  readonly cardKey: string;
  readonly lead: boolean;
  readonly more: number;
  readonly onStands: (key: string, stands: boolean) => void;
}) {
  const { session, acts } = useTaskActs(task, environmentId, conversationId, true);
  const shown = useTaskBarShown(cardKey);
  const { status } = session;
  const stands = shown && status !== null && laneOf(status) !== "done";
  // Said before paint, so the lead changes in the same frame as what it leads.
  useLayoutEffect(() => {
    onStands(cardKey, stands);
  }, [cardKey, onStands, stands]);
  useLayoutEffect(() => () => onStands(cardKey, false), [cardKey, onStands]);
  if (!lead || !stands) return null;
  return <MateTaskBarView acts={acts} more={more} session={session} task={task.source} />;
}

/**
 * Whether the bar of the task card `key` stands: while the card is out of sight, and while no card
 * of it is mounted once the list had its first frame (the list let it go, scrolled far away).
 */
export function useTaskBarShown(key: string): boolean {
  const inSight = useTaskCardSight(key);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(key));
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return inSight === false || (inSight === undefined && settled === key);
}

/** The bar itself, over the top of the conversation's column, on the cards' edges. */
export function MateTaskBarView({
  task,
  session = NOT_KNOWN,
  acts = NO_ACTS,
  more = 0,
}: {
  readonly task: MateTaskSource;
  readonly session?: TaskSession;
  readonly acts?: TaskActs;
  /** How many more live tasks' cards are out of sight behind it. */
  readonly more?: number;
}) {
  return (
    // The timeline's own gutters, so the bar stands on the cards' edges.
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 sm:px-5">
      <div
        className="pointer-events-auto mx-auto w-full max-w-3xl bg-background pt-2 pb-1.5 motion-safe:animate-task-bar-in"
        data-zerops-surface="mate-task-bar"
      >
        <Card>
          <div className="flex min-h-11 min-w-0 items-center gap-2 py-1.5 ps-3.75 pe-2 text-line max-sm:ps-2.75">
            <SourceMark source={task} />
            <span className="min-w-0 truncate font-medium text-foreground">{task.title}</span>
            {more > 0 ? (
              <Text
                aria-label={`and ${String(more)} more ${more === 1 ? "task" : "tasks"}`}
                className="shrink-0 tabular-nums"
                render={<span />}
                variant="meta"
              >
                +{more}
              </Text>
            ) : null}
            <TaskStanding acts={acts} session={session} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * A task at the start of its turn, the way an issue page opens: where it came from with a way out
 * to it, its title, what its asker wrote, then how long it worked, what it cost and the change and
 * pull request it made — its own task's, by its id: live while its Mate is on it, settled after.
 */
export function MateTaskCard({
  task,
  taskId,
  text,
  environmentId,
  conversationId,
  onOpenChange,
}: {
  readonly task: MateTaskSource;
  /** HQ's id of the task, as its brief says; `null`: the one the conversation's id names. */
  readonly taskId: string | null;
  /** What its asker wrote; the card shows what it says beyond the title (`taskAskBeyondTitle`). */
  readonly text: string;
  readonly environmentId: EnvironmentId;
  readonly conversationId: string;
  readonly onOpenChange?: (change: {
    readonly appId: string;
    readonly repo: string;
    readonly number: number;
  }) => void;
}) {
  const { session, appId, acts } = useTaskActs(
    { source: task, taskId },
    environmentId,
    conversationId,
  );
  const origin = usePutOrigin(task);
  // Watched while mounted: its bar stands in for it once it scrolled away (`MateTaskBar`).
  const watch = useWatchTaskCard(
    taskCardKey({ environmentId, conversationId, taskId, source: task }),
  );
  const openChange =
    onOpenChange === undefined || appId === null || session.change === null
      ? undefined
      : () => onOpenChange({ appId, ...session.change! });
  return (
    <MateTaskCardView
      acts={acts}
      cardRef={watch}
      origin={origin}
      session={session}
      task={task}
      text={text}
      {...(openChange === undefined ? {} : { onOpenChange: openChange })}
    />
  );
}

/**
 * Where a task a person put on the Board came from, in the reader's words: who put it, and for one
 * put from a chat whose chat it was, with the way back to that chat where the reader's list holds
 * its Mate; a New task put on the Board itself has none. `undefined` for every other source, which
 * names itself.
 */
function usePutOrigin(task: MateTaskSource): TaskCardOrigin | undefined {
  const session = useZeropsSessionOptional();
  const personName = useHqPersonNames(session?.activeOrganization?.id);
  const { listing } = useZeropsCandidates();
  const openConversation = useOpenTaskConversation();
  if (task.kind !== "conversation" && task.kind !== "board") return undefined;
  const mate =
    task.kind === "board"
      ? undefined
      : heldCandidates(listing).rows.find((row) => row.project.id === task.mateProjectId)?.project;
  const origin = putOrigin(task, {
    viewerId: session?.user?.id,
    personName,
    mateName: () => (mate === undefined ? undefined : projectNameInApp(mate)),
  });
  const { conversation } = origin;
  return {
    words: origin.full,
    ...(conversation === null ? {} : { onOpen: () => openConversation(conversation) }),
  };
}

/** Where a task came from, said by the reader's client where its source names nobody it knows. */
interface TaskCardOrigin {
  readonly words: string;
  /** Opens the chat it was put from. */
  readonly onOpen?: () => void;
}

export function MateTaskCardView({
  task,
  origin,
  text = "",
  session = NOT_KNOWN,
  acts = NO_ACTS,
  cardRef,
  onOpenChange,
}: {
  readonly task: MateTaskSource;
  /** Its presses, at its foot beside where it stands (`TaskStanding`). */
  readonly acts?: TaskActs;
  readonly cardRef?: Ref<HTMLDivElement> | undefined;
  /** Where it came from in the reader's words, a Put on board's (`usePutOrigin`); else its source's. */
  readonly origin?: TaskCardOrigin | undefined;
  readonly text?: string;
  /** Where it stands now (`taskSession`); not known: its facts' line holds its room, empty. */
  readonly session?: TaskSession;
  readonly onOpenChange?: () => void;
}) {
  const link = mateTaskSourceLink(task);
  const { pullRequest, change } = session;
  const said = taskAskBeyondTitle(task.title, text);
  // A long ask stands cut at six lines, as measured before it paints, and opens in place.
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const watch = useCallback((element: HTMLParagraphElement | null) => {
    if (element === null) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <Card data-zerops-surface="mate-task-card" ref={cardRef} render={<article />}>
      {/* Its words 16 px inside its edge, on the run card's inset. */}
      <div className="flex flex-col gap-1.5 px-3.75 pt-3.5 pb-3 max-sm:px-2.75">
        <Text className="flex min-w-0 items-center gap-2" render={<div />} variant="remark">
          <SourceMark source={task} />
          <span className="min-w-0 truncate">{origin?.words ?? mateTaskCardSource(task)}</span>
          {origin?.onOpen === undefined ? null : (
            <span className="ms-auto shrink-0">
              <InlineButton onClick={origin.onOpen}>Open the chat</InlineButton>
            </span>
          )}
          {link === null ? null : (
            <span className="ms-auto shrink-0">
              <InlineButton render={<a href={link.url} rel="noreferrer" target="_blank" />}>
                {link.words}
                <ArrowUpRightIcon aria-hidden="true" className="ms-0.5" />
              </InlineButton>
            </span>
          )}
        </Text>
        <Text render={<h3 />} variant="headline">
          {task.title}
        </Text>
        {said === "" ? null : (
          <div className="flex flex-col items-start gap-1">
            <p
              ref={open ? undefined : watch}
              className={cn(
                "w-full min-w-0 text-prose break-words whitespace-pre-wrap text-foreground",
                !open && "line-clamp-6",
              )}
            >
              {said}
            </p>
            {open || cut ? (
              <InlineButton onClick={() => setOpen((value) => !value)}>
                {open ? "Show less" : "Show all"}
              </InlineButton>
            ) : null}
          </div>
        )}
        {/* Its facts' line holds its room from the first frame: what lands moves nothing. */}
        <Text
          className="mt-1 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1"
          render={<div />}
          variant="remark"
          data-zerops-surface="mate-task-facts"
        >
          {session.workedMs === null ? null : (
            <span className="flex items-center gap-1 tabular-nums">
              <TimerIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Worked </span>
              {workedWords(session.workedMs)}
            </span>
          )}
          {session.spentUsd === null ? null : (
            <span className="text-foreground tabular-nums">
              <span className="sr-only">Cost so far </span>
              {spentWords(session.spentUsd)}
            </span>
          )}
          <span className="ms-auto flex items-center gap-x-3">
            {change === null || onOpenChange === undefined ? null : (
              <InlineButton onClick={onOpenChange}>Change #{change.number}</InlineButton>
            )}
            {pullRequest === null ? null : (
              <span className="flex items-center gap-1.5">
                <InlineButton
                  render={<a href={pullRequest.url} rel="noreferrer" target="_blank" />}
                >
                  {pullRequestName(pullRequest)}
                  <ArrowUpRightIcon aria-hidden="true" className="ms-0.5" />
                </InlineButton>
                {pullRequest.state === "open" && pullRequest.checks !== undefined ? (
                  <span>checks {pullRequest.checks}</span>
                ) : null}
              </span>
            )}
          </span>
        </Text>
      </div>
      <Separator />
      {/* Its foot: where it stands on the Board, and the reader's presses on it. */}
      <div
        className="flex min-h-11 min-w-0 items-center gap-2 py-1.5 ps-3.75 pe-2 text-line max-sm:ps-2.75"
        data-zerops-surface="mate-task-foot"
      >
        <TaskStanding acts={acts} session={session} />
      </div>
    </Card>
  );
}

/**
 * An automated Mate's question to a person, its agent's last `QUESTION:` line (`taskQuestionOf`):
 * the Mate asking, in the wash of what waits on a person, and while the task still waits on it
 * the way to answer it (`answer`, `TaskQuestionAnswer`).
 */
export function TaskQuestionView({
  mateName,
  question,
  answer = null,
}: {
  readonly mateName: string;
  readonly question: string;
  readonly answer?: ReactNode;
}) {
  return (
    <Card
      data-zerops-surface="mate-task-question"
      render={<section />}
      tone="attention"
      variant="wash"
    >
      <div className="flex flex-col items-start gap-1 px-3.75 py-3 max-sm:px-2.75">
        <Text render={<h3 />} variant="heading">
          {mateName} asks
        </Text>
        <p className="min-w-0 text-prose break-words whitespace-pre-wrap text-foreground">
          {question}
        </p>
        {answer === null ? null : <div className="mt-2">{answer}</div>}
      </div>
    </Card>
  );
}

/**
 * Answer on the Board, for the question of the task the conversation works now, while that task
 * waits on it: its room held while where it stands is read, gone once it is known not to wait.
 */
export function TaskQuestionAnswer({
  task,
  taskId,
  environmentId,
  conversationId,
}: {
  readonly task: MateTaskSource;
  readonly taskId: string | null;
  readonly environmentId: EnvironmentId;
  readonly conversationId: string;
}) {
  const { session, appId } = useTaskSession(task, environmentId, conversationId, taskId);
  const reading = session.status === null;
  if (!reading && session.status !== "waiting") return null;
  const taskOnBoard = session.taskId;
  if (reading || appId === null || taskOnBoard === null)
    return (
      <span aria-hidden="true" className="invisible" inert>
        <Button render={<span />} size="sm" variant="secondary">
          Answer on the Board
        </Button>
      </span>
    );
  return (
    <Button
      render={
        <Link
          params={{ groupId: appId }}
          search={{ task: taskOnBoard }}
          to="/group/$groupId/board"
        />
      }
      size="sm"
      variant="secondary"
    >
      Answer on the Board
    </Button>
  );
}

/**
 * Something said about a task after its Mate took it, told to it in the task's conversation: who
 * said it — "You" for the reader — and where, that place a link (`taskMessageOrigin`); never drawn
 * as the viewer's own message.
 */
export function MateTaskMessageRow({
  message,
  source,
  taskId,
  environmentId,
}: {
  readonly message: MateTaskMessage;
  /** The task it is of, as its brief brought it; `null` where the conversation does not hold it. */
  readonly source: MateTaskSource | null;
  readonly taskId: string | null;
  readonly environmentId: EnvironmentId;
}) {
  const session = useZeropsSessionOptional();
  const called = useViewerCalled();
  const fullName = session?.user == null ? null : zeropsAccountDisplay(session.user).fullName;
  const viewer = [called, fullName].filter((name): name is string => name != null);
  const appId = useMateAppId(environmentId);
  return (
    <MateTaskMessageRowView
      board={appId === null || taskId === null ? null : { groupId: appId, taskId }}
      message={message}
      origin={taskMessageOrigin(message, source, viewer)}
    />
  );
}

export function MateTaskMessageRowView({
  message,
  origin,
  board = null,
}: {
  readonly message: MateTaskMessage;
  readonly origin: TaskMessageOrigin;
  /** Where the task's panel opens on the Board, for an answer given there; `null`: not known. */
  readonly board?: TaskOnBoard | null;
}) {
  const { lead, place } = taskMessageWords(origin);
  const { to } = origin;
  return (
    <Card data-zerops-surface="mate-task-message">
      <div className="flex flex-col gap-1 px-3.75 py-2.5 max-sm:px-2.75">
        <Text className="min-w-0" render={<p />} truncate variant="remark">
          {lead}{" "}
          {to.kind === "url" ? (
            <InlineButton render={<a href={to.url} rel="noreferrer" target="_blank" />}>
              {place}
              <ArrowUpRightIcon aria-hidden="true" className="ms-0.5" />
            </InlineButton>
          ) : to.kind === "board" && board !== null ? (
            <InlineButton
              render={
                <Link
                  params={{ groupId: board.groupId }}
                  search={{ task: board.taskId }}
                  to="/group/$groupId/board"
                />
              }
            >
              {place}
            </InlineButton>
          ) : (
            place
          )}
        </Text>
        <p className="max-h-60 min-w-0 overflow-y-auto text-prose break-words whitespace-pre-wrap text-foreground">
          {message.text}
        </p>
      </div>
    </Card>
  );
}
