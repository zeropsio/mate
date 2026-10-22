/**
 * A commit's page: its message, who wrote it and when, its parents, and every file it changed
 * against its first parent with the file's counts — a list that jumps to the file's diff below.
 * Hunks come with the page while its budget lasts; a later file is read on press.
 */
import type { GitBrowseView } from "@t3tools/client-runtime/data";
import type { GitCommit } from "@t3tools/shared/hqGitBrowse/commit";
import { useState, type MouseEvent, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useGitBrowse, useGitBrowseReads } from "~/zerops/useGitBrowse";
import { Button } from "../../ui/button";
import { GitReadStopped } from "./GitAtCommit";
import type { GitRepoAt } from "./GitBrowserLink";
import type { GitBrowseSearch, GitRepoPageProps } from "./GitBrowseView";
import { GitChangedFiles, GitDiffFiles, type GitLaterHunks } from "./GitDiffFiles";
import { GitWhen } from "./GitWhen";

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function PageLink({
  to,
  navigate,
  hrefOf,
  children,
  className,
}: Pick<GitRepoPageProps, "navigate" | "hrefOf"> & {
  readonly to: GitBrowseSearch;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <a
      className={className ?? "text-foreground underline-offset-2 hover:underline"}
      href={hrefOf(to)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** The commit's message and people, and the files it changed, each a jump to its diff. */
export function GitCommitSummary({
  commit,
  navigate,
  hrefOf,
  onOpenChange,
  onJump,
}: Pick<GitRepoPageProps, "navigate" | "hrefOf" | "onOpenChange"> & {
  readonly commit: GitCommit;
  readonly onJump: (path: string) => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "commit id" });
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-4">
      <header className="flex min-w-0 flex-col gap-2">
        <h2 className="text-base font-medium break-words text-foreground">{commit.subject}</h2>
        {commit.body === "" ? null : (
          <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
            {commit.body}
          </p>
        )}
        {commit.messageCut ? (
          <p className="text-xs text-muted-foreground">
            The message is longer than 64 KiB. Its end is not shown.
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="text-foreground">{commit.authorName}</span>
            {" · "}
            <GitWhen at={commit.authoredAt}>{formatRelativeTimeLabel(commit.authoredAt)}</GitWhen>
          </span>
          {commit.committerName === commit.authorName ? null : (
            <span>
              {"Committed by "}
              <span className="text-foreground">{commit.committerName}</span>
              {" · "}
              <GitWhen at={commit.committedAt}>
                {formatRelativeTimeLabel(commit.committedAt)}
              </GitWhen>
            </span>
          )}
          <span className="flex items-center gap-1">
            {commit.parents.length === 0
              ? "The first commit"
              : commit.parents.length === 1
                ? "Parent"
                : "Parents"}
            {commit.parents.map((parent) => (
              <PageLink
                className="font-mono text-foreground underline-offset-2 hover:underline"
                hrefOf={hrefOf}
                key={parent}
                navigate={navigate}
                to={{ rev: parent, view: "commit" }}
              >
                {parent.slice(0, 7)}
              </PageLink>
            ))}
          </span>
          <span className="font-mono text-foreground">{commit.sha.slice(0, 7)}</span>
          <Button onClick={() => copyToClipboard(commit.sha)} size="sm" variant="ghost">
            {isCopied ? "Copied" : "Copy commit id"}
          </Button>
          <PageLink hrefOf={hrefOf} navigate={navigate} to={{ rev: commit.sha, view: "code" }}>
            Browse files
          </PageLink>
          {commit.change === undefined || onOpenChange === undefined ? null : (
            <Button onClick={() => onOpenChange(commit.change!.number)} size="sm" variant="link">
              Merged from change #{commit.change.number}
            </Button>
          )}
        </div>
        {commit.parents.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Showing what it brought against its first parent.
          </p>
        ) : null}
      </header>
      <GitChangedFiles
        files={commit.files}
        filesTruncated={commit.filesTruncated}
        onJump={onJump}
        totalFiles={commit.totalFiles}
      />
    </div>
  );
}

function CommitPage({
  appId,
  repo,
  sha,
  navigate,
  hrefOf,
  onOpenChange,
}: Pick<GitRepoPageProps, "appId" | "repo" | "navigate" | "hrefOf" | "onOpenChange"> & {
  readonly sha: string;
}) {
  const { view, again } = useGitBrowse({ appId, repo, read: "commit", params: { sha } }, true);
  const [asked, setAsked] = useState<ReadonlyArray<string>>([]);
  const laterReads = useGitBrowseReads(
    asked.map((path) => ({ appId, repo, read: "commit-file" as const, params: { sha, path } })),
    true,
  );
  const later = new Map<string, GitLaterHunks>(
    asked.flatMap((path, i) => {
      const read = laterReads.views[i];
      return read === undefined ? [] : [[path, read] as const];
    }),
  );
  if (view.state !== "known")
    return <PageState at={{ appId, repo }} view={view} onAgain={again} what="commit" />;
  const commit = view.answer;
  return (
    <GitDiffFiles
      className="h-[calc(100dvh-17.5rem)] min-h-96 overflow-auto"
      files={commit.files}
      later={later}
      onAgain={laterReads.again}
      onLoad={(path) => setAsked((current) => [...current, path])}
      renderHeader={(jump) => (
        <GitCommitSummary
          commit={commit}
          hrefOf={hrefOf}
          navigate={navigate}
          onJump={jump}
          onOpenChange={onOpenChange}
        />
      )}
      sha={commit.sha}
    />
  );
}

function PageState({
  at,
  view,
  onAgain,
  what,
}: {
  readonly at: GitRepoAt;
  readonly view: GitBrowseView<unknown>;
  readonly onAgain: () => void;
  readonly what: string;
}) {
  if (view.state === "known") return null;
  if (view.state === "unread")
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the {what}…
      </p>
    );
  return <GitReadStopped view={view} at={at} onAgain={onAgain} />;
}

export function GitCommitView({
  appId,
  repo,
  search,
  home,
  onHomeAgain,
  navigate,
  hrefOf,
  onOpenChange,
}: GitRepoPageProps) {
  // A full commit id is the page's commit; anything else is what the page's ref names now.
  const sha =
    search.rev !== undefined && FULL_SHA.test(search.rev)
      ? search.rev
      : home.state === "known"
        ? home.answer.sha
        : undefined;
  if (sha === undefined)
    return <PageState at={{ appId, repo }} view={home} onAgain={onHomeAgain} what="commit" />;
  if (sha === null)
    return <p className="text-sm text-muted-foreground">No commits on this branch yet</p>;
  return (
    <CommitPage
      appId={appId}
      hrefOf={hrefOf}
      key={sha}
      navigate={navigate}
      onOpenChange={onOpenChange}
      repo={repo}
      sha={sha}
    />
  );
}
