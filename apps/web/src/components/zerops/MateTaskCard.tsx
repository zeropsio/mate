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
  MessagesSquareIcon,
  TimerIcon,
  WebhookIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { pullRequestName } from "~/zerops/automatedMate.logic";
import { spentWords, type TaskSession } from "~/zerops/taskSession.logic";
import { TASK_STATUS_WORDS, taskStatusDot, workedWords } from "~/zerops/taskStatus";
import { useTaskSession } from "~/zerops/useTaskSession";

import { cn } from "~/lib/utils";

import { GitHubIcon } from "../Icons";
import { Button, InlineButton } from "../ui/button";

/** "acme/tea-shop#12 · opened by nova-dev": where the task came from, and whose it is. */
export function mateTaskCardSource(task: MateTaskSource): string {
  const where = mateTaskSourceLabel(task);
  const author = mateTaskSourceAuthor(task);
  return author === null ? where : `${where} · opened by ${author}`;
}

const NOT_KNOWN: TaskSession = {
  status: null,
  taskId: null,
  stoppable: false,
  workedMs: null,
  spentUsd: null,
  change: null,
  pullRequest: null,
};

/** Where a task came from, as a mark: GitHub's, a Slack channel's, a Discord thread, a webhook, a schedule. */
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
  }
}

/**
 * Where a task stands, beside its Mate in the conversation's header — in sight however far the
 * conversation scrolls — and Stop, for an Owner or Admin while it can be stopped, asked first.
 */
export function MateTaskStatus({
  task,
  taskId,
  environmentId,
  conversationId,
}: {
  /** The conversation's current task (`conversationTask`): its latest brief's. */
  readonly task: MateTaskSource;
  /** HQ's id of it, as its brief says; `null`: the one the conversation's id names (`sessionTaskId`). */
  readonly taskId: string | null;
  readonly environmentId: EnvironmentId;
  readonly conversationId: string;
}) {
  const { session, stop } = useTaskSession(task, environmentId, conversationId, taskId);
  return <MateTaskStatusView onStop={stop ?? undefined} session={session} />;
}

export function MateTaskStatusView({
  session = NOT_KNOWN,
  onStop,
}: {
  /** Where it stands now (`taskSession`); not known: its room held, nothing said. */
  readonly session?: TaskSession;
  /** Stops the task, confirmed first; absent while it cannot be stopped from here. */
  readonly onStop?: (() => void) | undefined;
}) {
  const { status } = session;
  const [asking, setAsking] = useState(false);
  const confirming = asking && onStop !== undefined;
  return (
    <span
      className="flex min-w-0 shrink-0 items-center gap-2 text-line"
      data-zerops-surface="mate-task-session"
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-2 py-px font-medium text-foreground",
          status === null && "invisible",
        )}
        data-zerops-surface="mate-task-status"
      >
        {status === null ? null : (
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${taskStatusDot(status)}`}
          />
        )}
        <span data-zerops-surface="mate-task-status-words">
          {status === null ? "\u00a0" : TASK_STATUS_WORDS[status]}
        </span>
      </span>
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
    </span>
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
  /** What its asker wrote; empty: the ask had no more text than its title. */
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
  const openChange =
    onOpenChange === undefined || appId === null || session.change === null
      ? undefined
      : () => onOpenChange({ appId, ...session.change! });
  return (
    <MateTaskCardView
      session={session}
      task={task}
      text={text}
      {...(openChange === undefined ? {} : { onOpenChange: openChange })}
    />
  );
}

export function MateTaskCardView({
  task,
  text = "",
  session = NOT_KNOWN,
  onOpenChange,
}: {
  readonly task: MateTaskSource;
  readonly text?: string;
  /** Where it stands now (`taskSession`); not known: its facts' line holds its room, empty. */
  readonly session?: TaskSession;
  readonly onOpenChange?: () => void;
}) {
  const link = mateTaskSourceLink(task);
  const { pullRequest, change } = session;
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
    <article
      className="flex flex-col gap-1.5 rounded-2xl border border-border/70 bg-card px-5 pt-3.5 pb-3"
      data-zerops-surface="mate-task-card"
    >
      <div className="flex min-w-0 items-center gap-2 text-line text-muted-foreground">
        <SourceMark source={task} />
        <span className="min-w-0 truncate">{mateTaskCardSource(task)}</span>
        {link === null ? null : (
          <span className="ms-auto shrink-0">
            <InlineButton render={<a href={link.url} rel="noreferrer" target="_blank" />}>
              {link.words}
              <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
            </InlineButton>
          </span>
        )}
      </div>
      <h3 className="text-emphasis font-semibold text-balance text-foreground">{task.title}</h3>
      {text === "" ? null : (
        <div className="flex flex-col items-start gap-1">
          <p
            ref={open ? undefined : watch}
            className={cn(
              "w-full min-w-0 text-prose break-words whitespace-pre-wrap text-foreground",
              !open && "line-clamp-6",
            )}
          >
            {text}
          </p>
          {open || cut ? (
            <InlineButton onClick={() => setOpen((value) => !value)}>
              {open ? "Show less" : "Show all"}
            </InlineButton>
          ) : null}
        </div>
      )}
      {/* Its facts' line holds its room from the first frame: what lands moves nothing. */}
      <div
        className="mt-1 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-line text-muted-foreground"
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
              <InlineButton render={<a href={pullRequest.url} rel="noreferrer" target="_blank" />}>
                {pullRequestName(pullRequest)}
                <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
              </InlineButton>
              {pullRequest.state === "open" && pullRequest.checks !== undefined ? (
                <span>checks {pullRequest.checks}</span>
              ) : null}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

/** Who said a task's follow-up, and where: "ida-ops commented on the issue". */
export function mateTaskMessageHeading(message: Pick<MateTaskMessage, "from" | "author">): string {
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
    <div
      className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card px-4 py-2.5"
      data-zerops-surface="mate-task-message"
    >
      <p className="min-w-0 truncate text-line text-muted-foreground">
        {mateTaskMessageHeading(message)}
      </p>
      <p className="max-h-60 min-w-0 overflow-y-auto text-prose break-words whitespace-pre-wrap text-foreground">
        {message.text}
      </p>
    </div>
  );
}
