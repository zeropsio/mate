/**
 * A task's first message in an automated Mate's conversation, drawn as the task's chain: the
 * issue's title, where it lives and who opened it with a way out to it on GitHub, then where it
 * stands now — its Mate at work, waiting for an answer, its change waiting for review, or the pull
 * request on GitHub it became, linked. That last line holds its room from the first frame, so the
 * conversation never moves as the task does. The words the agent got with it are its brief, never
 * the person's, so they are never drawn. What people say about the task afterwards, told to its
 * Mate, is drawn as theirs (`MateTaskMessageRow`).
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
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
} from "lucide-react";

import { taskChainLine, type TaskChain } from "~/zerops/automatedMate.logic";
import { useTaskChain } from "~/zerops/useTaskChain";

import { InlineButton } from "../ui/button";

/** "acme/tea-shop#12 · opened by nova-dev": where the task came from, and whose it is. */
export function mateTaskCardSource(task: MateTaskSource): string {
  const where = mateTaskSourceLabel(task);
  const author = mateTaskSourceAuthor(task);
  return author === null ? where : `${where} · opened by ${author}`;
}

const UNKNOWN: TaskChain = { kind: "unknown" };

/** The card, for the Mate living in the conversation's environment: its chain read live. */
export function MateTaskChainCard({
  task,
  environmentId,
}: {
  readonly task: MateTaskSource;
  readonly environmentId: EnvironmentId;
}) {
  return <MateTaskCard chain={useTaskChain(task, environmentId)} task={task} />;
}

export function MateTaskCard({
  task,
  chain = UNKNOWN,
}: {
  readonly task: MateTaskSource;
  /** Where it stands now (`taskChain`); not known: its line holds its room, empty. */
  readonly chain?: TaskChain;
}) {
  const link = mateTaskSourceLink(task);
  const line = taskChainLine(chain);
  const PullRequestIcon =
    chain.kind === "pull-request" && chain.pullRequest.state === "merged"
      ? GitMergeIcon
      : chain.kind === "pull-request" && chain.pullRequest.state === "closed"
        ? GitPullRequestClosedIcon
        : GitPullRequestIcon;
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card px-4 py-2.5"
      data-zerops-surface="mate-task-card"
    >
      <p className="min-w-0 truncate text-prose font-medium text-foreground">{task.title}</p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-line text-muted-foreground">
        <span className="min-w-0 truncate">{mateTaskCardSource(task)}</span>
        {link === null ? null : (
          <InlineButton render={<a href={link.url} rel="noreferrer" target="_blank" />}>
            {link.words}
            <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
          </InlineButton>
        )}
      </p>
      <p
        className="flex min-w-0 items-center gap-x-2 text-line text-foreground"
        data-zerops-surface="mate-task-chain"
      >
        {/* Its room, held while nothing is known: a line of nothing. */}
        {line.status === null && line.pullRequest === null ? <span>{"\u00a0"}</span> : null}
        {line.status === null ? null : <span className="shrink-0">{line.status}</span>}
        {line.status !== null && line.pullRequest !== null ? (
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
        ) : null}
        {line.pullRequest === null ? null : (
          <InlineButton render={<a href={line.pullRequest.url} rel="noreferrer" target="_blank" />}>
            <PullRequestIcon aria-hidden="true" className="me-1 inline size-3.5" />
            {line.pullRequest.words}
            <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
          </InlineButton>
        )}
      </p>
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
