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
import type { GitBrowseSearch, GitRepoPageProps } from "./GitBrowseView";
import { GitDiffFiles, type GitLaterHunks } from "./GitDiffFiles";
import { GitWhen } from "./GitWhen";

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const STATUS_LETTER: Record<GitCommit["files"][number]["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  const additions = commit.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = commit.files.reduce((sum, file) => sum + file.deletions, 0);
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
      <section aria-label="Changed files" className="flex min-w-0 flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          {commit.filesTruncated
            ? `Showing ${count(commit.files.length, "file", "files")} of ${commit.totalFiles} changed`
            : `${count(commit.totalFiles, "file", "files")} changed`}
          {additions > 0 ? (
            <span className="ml-2 font-mono text-diff-addition-foreground">+{additions}</span>
          ) : null}
          {deletions > 0 ? (
            <span className="ml-1 font-mono text-diff-deletion-foreground">−{deletions}</span>
          ) : null}
        </p>
        <ul className="flex min-w-0 flex-col">
          {commit.files.map((file) => (
            <li key={file.path}>
              <button
                className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onJump(file.path)}
                type="button"
              >
                <span className="w-3 shrink-0 font-mono text-muted-foreground">
                  {STATUS_LETTER[file.status]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                  {file.path}
                </span>
                {file.binary ? (
                  <span className="text-muted-foreground">Binary file</span>
                ) : (
                  <span className="shrink-0 font-mono">
                    <span className="text-diff-addition-foreground">+{file.additions}</span>{" "}
                    <span className="text-diff-deletion-foreground">−{file.deletions}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
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
  if (view.state !== "known") return <PageState view={view} onAgain={again} what="commit" />;
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
  view,
  onAgain,
  what,
}: {
  readonly view: GitBrowseView<unknown>;
  readonly onAgain: () => void;
  readonly what: string;
}) {
  if (view.state === "known") return null;
  const words =
    view.state === "failed" || view.state === "refused"
      ? view.words
      : view.state === "withheld"
        ? "You do not have access to this repository."
        : `Reading the ${what}…`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p
        className="text-sm text-muted-foreground"
        role={view.state === "failed" || view.state === "refused" ? "alert" : "status"}
      >
        {words}
      </p>
      {view.state === "failed" ? (
        <Button onClick={onAgain} size="sm" variant="ghost">
          Read again
        </Button>
      ) : null}
    </div>
  );
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
  if (sha === undefined) return <PageState view={home} onAgain={onHomeAgain} what="commit" />;
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
