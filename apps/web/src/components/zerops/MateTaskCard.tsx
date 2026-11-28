/**
 * A task on an automated Mate, as its conversation shows it: where it stands beside the Mate in the
 * header, with Stop for an Owner or Admin, asked first (`MateTaskStatus`); and the conversation
 * opening with the task, the way an issue page opens — where it came from, its title, what its
 * asker wrote, how long it worked, what it cost, and the change and pull request it made
 * (`MateTaskCard`). The words the agent got with it are its brief, never the person's, so they are
 * never drawn; what people say about the task afterwards, told to its Mate, is drawn as theirs
 * (`MateTaskMessageRow`).
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
import { useCallback, useState } from "react";

import { pullRequestName, taskAskBeyondTitle } from "~/zerops/automatedMate.logic";
import { spentWords, taskPillStatus, type TaskSession } from "~/zerops/taskSession.logic";
import { TASK_STATUS_WORDS, type TaskTone, taskStatusTone, workedWords } from "~/zerops/taskStatus";
import { useTaskSession } from "~/zerops/useTaskSession";
import { useOpenTaskConversation } from "~/zerops/useBoardTasks";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { projectNameInApp } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { putOrigin } from "./projectAutomation/taskBoard.logic";

import { cn } from "~/lib/utils";

import { GitHubIcon } from "../Icons";
import { Badge, type BadgeTone } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HeaderReviewDoor } from "./SidebarProjectReview";
import { taskReviewItems } from "./SidebarProjectReview.logic";
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

/** The app bar's Review, as a Mate's conversation header holds it (`HeaderReviewDoor`). */
type TaskReviewDoor = Parameters<typeof HeaderReviewDoor>[0];

/** Where a task stands on its application's Board: its panel opens there (`?task=`). */
interface TaskOnBoard {
  readonly groupId: string;
  readonly taskId: string;
}

/**
 * The conversation's task, beside its Mate in the header — in sight however far the conversation
 * scrolls: what it is (where it came from, its title, where it stands), one press from its panel on
 * the Board; Stop, for an Owner or Admin while it can be stopped, asked first; for a task a person
 * took, Mark done and Put back. The app bar's Review its Mate's changes wait on comes after it, set
 * apart, so it never reads as the task's next state.
 */
export function MateTaskStatus({
  task,
  taskId,
  environmentId,
  conversationId,
  review = null,
}: {
  /** The conversation's current task (`conversationTask`): its latest brief's. */
  readonly task: MateTaskSource;
  /** HQ's id of it, as its brief says; `null`: the one the conversation's id names (`sessionTaskId`). */
  readonly taskId: string | null;
  readonly environmentId: EnvironmentId;
  readonly conversationId: string;
  /** Its Mate's app-bar Review (`headerReviewItems`); `null` while nothing waits there. */
  readonly review?: TaskReviewDoor | null;
}) {
  const { session, appId, stop, done, release } = useTaskSession(
    task,
    environmentId,
    conversationId,
    taskId,
  );
  return (
    <MateTaskStatusView
      board={
        appId === null || session.taskId === null
          ? null
          : { groupId: appId, taskId: session.taskId }
      }
      onDone={done ?? undefined}
      onRelease={release ?? undefined}
      onStop={stop ?? undefined}
      review={review}
      session={session}
      task={task}
    />
  );
}

export function MateTaskStatusView({
  task,
  board = null,
  session = NOT_KNOWN,
  onStop,
  onDone,
  onRelease,
  review = null,
}: {
  readonly task: MateTaskSource;
  /** Where its panel opens on the Board; `null` while not known: the same room, nothing to press. */
  readonly board?: TaskOnBoard | null;
  /** Where it stands now (`taskSession`); not known: its room held, nothing said. */
  readonly session?: TaskSession;
  /** Stops the task, confirmed first; absent while it cannot be stopped from here. */
  readonly onStop?: (() => void) | undefined;
  /** A task the person took: marks it done (its taker), or puts it back on the Board's queue. */
  readonly onDone?: (() => void) | undefined;
  readonly onRelease?: (() => void) | undefined;
  /**
   * Its Mate's app-bar Review, led by this task's change (`taskReviewItems`); where it asks, the
   * task does not say it is up for review again (`taskPillStatus`).
   */
  readonly review?: TaskReviewDoor | null;
}) {
  const items = review === null ? [] : taskReviewItems(review.review.items, session.change);
  const status = taskPillStatus(session.status, items.length > 0);
  const [asking, setAsking] = useState(false);
  const confirming = asking && onStop !== undefined;
  const words = (
    <>
      <SourceMark source={task} />
      <span className="max-w-[28ch] min-w-0 truncate max-sm:max-w-[12ch]">{task.title}</span>
      {status === undefined ? null : (
        // Until its status is read, the label keeps its room unseen: nothing moves when it comes.
        <span
          className={cn("flex shrink-0", status === null && "invisible")}
          data-zerops-surface="mate-task-status"
        >
          {/* Its blue is a change to look at, not work under way: it does not breathe. */}
          <Badge
            dot
            pulse={false}
            tone={status === null ? "neutral" : TASK_DOT[taskStatusTone(status)]}
          >
            <span data-zerops-surface="mate-task-status-words">
              {status === null ? "\u00a0" : TASK_STATUS_WORDS[status]}
            </span>
          </Badge>
        </span>
      )}
    </>
  );
  return (
    <>
      <span
        className="flex min-w-0 items-center gap-2 text-line"
        data-zerops-surface="mate-task-session"
      >
        {board === null ? (
          <Button data-zerops-surface="mate-task-unit" render={<span />} size="sm" variant="ghost">
            {words}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-zerops-surface="mate-task-unit"
                  render={
                    <Link
                      params={{ groupId: board.groupId }}
                      search={{ task: board.taskId }}
                      to="/group/$groupId/board"
                    />
                  }
                  size="sm"
                  variant="ghost"
                />
              }
            >
              {words}
            </TooltipTrigger>
            <TooltipPopup side="bottom">Open on the Board</TooltipPopup>
          </Tooltip>
        )}
        {confirming ? (
          <span className="flex items-center gap-1" data-zerops-surface="mate-task-stop-ask">
            <span className="text-muted-foreground">
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
        ) : onStop !== undefined ? (
          <Button
            onClick={() => {
              setAsking(true);
            }}
            size="sm"
            variant="secondary"
          >
            Stop
          </Button>
        ) : null}
        {/* A task the person took: say it is done, or put it back on the Board for another. */}
        {onDone === undefined ? null : (
          <Button onClick={onDone} size="sm" variant="secondary">
            Mark done
          </Button>
        )}
        {onRelease === undefined ? null : (
          <Button aria-label="Put back on the Board" onClick={onRelease} size="sm" variant="ghost">
            Put back
          </Button>
        )}
      </span>
      {review === null ? null : (
        <>
          <Separator className="h-4" orientation="vertical" />
          <HeaderReviewDoor held={review.held} review={{ ...review.review, items }} />
        </>
      )}
    </>
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
  const { session, appId } = useTaskSession(task, environmentId, conversationId, taskId);
  const origin = usePutOrigin(task);
  const openChange =
    onOpenChange === undefined || appId === null || session.change === null
      ? undefined
      : () => onOpenChange({ appId, ...session.change! });
  return (
    <MateTaskCardView
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
  onOpenChange,
}: {
  readonly task: MateTaskSource;
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
    <Card data-zerops-surface="mate-task-card" render={<article />}>
      <div className="flex flex-col gap-1.5 px-5 pt-3.5 pb-3">
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
    </Card>
  );
}

/** Who said a task's follow-up, and where: "ida-ops commented on the issue". */
function mateTaskMessageHeading(message: Pick<MateTaskMessage, "from" | "author">): string {
  const who = message.author ?? "Someone";
  switch (message.from) {
    case "comment":
      return `${who} commented on the issue`;
    case "reply":
      return `${who} replied in the thread`;
    case "review":
      return `${who} commented on the change`;
    case "edit":
      return `${who} edited the issue`;
  }
}

/**
 * Something said about a task after its Mate took it, told to it in the task's conversation: its
 * author's words, from where they said them — never drawn as the viewer's own message.
 */
export function MateTaskMessageRow({ message }: { readonly message: MateTaskMessage }) {
  return (
    <Card data-zerops-surface="mate-task-message">
      <div className="flex flex-col gap-1 px-4 py-2.5">
        <Text className="min-w-0" render={<p />} truncate variant="remark">
          {mateTaskMessageHeading(message)}
        </Text>
        <p className="max-h-60 min-w-0 overflow-y-auto text-prose break-words whitespace-pre-wrap text-foreground">
          {message.text}
        </p>
      </div>
    </Card>
  );
}
