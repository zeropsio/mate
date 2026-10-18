/**
 * A task's session, at the top of its conversation on an automated Mate: where the task stands in
 * one word beside its dot, where it came from and who opened it with a way out to it, then the
 * change and pull request it made, how long it worked and what it cost as its Mate last reported,
 * and Stop, for an Owner or Admin, while it is queued, at work or waiting for an answer — asked on
 * the band before anything stops, as the board asks. The title is the conversation
 * header's. Every slot holds its room from the first frame, so nothing moves as the task does. The
 * words the agent got with it are its brief, never the person's, so they are never drawn. What
 * people say about the task afterwards, told to its Mate, is drawn as theirs (`MateTaskMessageRow`).
 */
import {
  mateTaskSourceAuthor,
  mateTaskSourceLabel,
  mateTaskSourceLink,
  type EnvironmentId,
  type MateTaskMessage,
  type MateTaskSource,
} from "@t3tools/contracts";
import { ArrowUpRightIcon, TimerIcon } from "lucide-react";
import { useState } from "react";

import { pullRequestName } from "~/zerops/automatedMate.logic";
import { spentWords, type TaskSession } from "~/zerops/taskSession.logic";
import { TASK_STATUS_WORDS, taskStatusDot, workedWords } from "~/zerops/taskStatus";
import { useTaskSession } from "~/zerops/useTaskSession";

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

/** The session, for the Mate living in the conversation's environment: read live. */
export function MateTaskSession({
  task,
  environmentId,
  conversationId,
  onOpenChange,
}: {
  readonly task: MateTaskSource;
  readonly environmentId: EnvironmentId;
  /** The conversation's id: it names HQ's task (`mateTaskIdOfConversation`). */
  readonly conversationId: string;
  readonly onOpenChange?: (change: {
    readonly appId: string;
    readonly repo: string;
    readonly number: number;
  }) => void;
}) {
  const { session, appId, stop } = useTaskSession(task, environmentId, conversationId);
  const openChange =
    onOpenChange === undefined || appId === null || session.change === null
      ? undefined
      : () => onOpenChange({ appId, ...session.change! });
  return (
    <MateTaskSessionBar
      onStop={stop ?? undefined}
      session={session}
      task={task}
      {...(openChange === undefined ? {} : { onOpenChange: openChange })}
    />
  );
}

export function MateTaskSessionBar({
  task,
  session = NOT_KNOWN,
  onStop,
  onOpenChange,
}: {
  readonly task: MateTaskSource;
  /** Where it stands now (`taskSession`); not known: its slots hold their room, empty. */
  readonly session?: TaskSession;
  /** Stops the task, confirmed on the band; absent while it cannot be stopped from here. */
  readonly onStop?: (() => void) | undefined;
  readonly onOpenChange?: () => void;
}) {
  const link = mateTaskSourceLink(task);
  const { status, pullRequest, change } = session;
  const [asking, setAsking] = useState(false);
  const confirming = asking && onStop !== undefined;
  return (
    <div
      className="flex min-h-7 min-w-0 items-center gap-x-4 text-line"
      data-zerops-surface="mate-task-session"
    >
      {/* Its state first, alone: what lands or changes here moves nothing else. */}
      <span
        className="flex shrink-0 items-center gap-1.5 font-medium text-foreground"
        data-zerops-surface="mate-task-status"
      >
        {status === null ? null : (
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${taskStatusDot(status)}`}
          />
        )}
        <span data-zerops-surface="mate-task-status-words">
          {/* Its room, held while nothing is known: a line of nothing. */}
          {status === null ? "\u00a0" : TASK_STATUS_WORDS[status]}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-x-2">
        <span className="min-w-0 truncate text-muted-foreground">{mateTaskCardSource(task)}</span>
        {link === null ? null : (
          <InlineButton render={<a href={link.url} rel="noreferrer" target="_blank" />}>
            {link.words}
            <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
          </InlineButton>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-x-3" data-zerops-surface="mate-task-facts">
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
              <span className="text-muted-foreground">checks {pullRequest.checks}</span>
            ) : null}
          </span>
        )}
        <span className="flex min-w-[7ch] items-center justify-end gap-1 text-muted-foreground tabular-nums">
          {session.workedMs === null ? null : (
            <>
              <TimerIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Worked </span>
              {workedWords(session.workedMs)}
            </>
          )}
        </span>
        <span className="min-w-[5ch] text-end text-foreground tabular-nums">
          {session.spentUsd === null ? null : (
            <>
              <span className="sr-only">Cost so far </span>
              {spentWords(session.spentUsd)}
            </>
          )}
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
        ) : status === "stopping" ? (
          // Its room held while it stops, so nothing on the band moves at the press.
          <span aria-hidden="true" className="invisible">
            <Button disabled size="sm" tabIndex={-1} variant="secondary">
              Stop
            </Button>
          </span>
        ) : null}
      </span>
    </div>
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
