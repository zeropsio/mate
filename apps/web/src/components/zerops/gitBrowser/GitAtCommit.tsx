/**
 * What every page that reads at a commit shares: the commit the page's branch, tag or commit names
 * now (the frame's home read), and how a read says it is still reading or why it stopped.
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { GitBrowserLink, type GitRepoAt } from "./GitBrowserLink";

/** Missing commit facts are pending, not evidence of an empty branch. */
export function GitNoCommit({ pending }: { readonly pending?: boolean | undefined }) {
  return (
    <p className="text-sm text-muted-foreground">
      {pending === true ? "Commit metadata is pending." : "No commits on this branch yet."}
    </p>
  );
}

/** A read not answered yet: reading, or waiting for HQ before it can. */
export function GitReading({ busy, words }: { readonly busy: boolean; readonly words: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {busy ? words : "Waiting for HQ…"}
    </p>
  );
}

const NO_COMMIT = "This branch, tag or commit is not in the repository.";

const REFUSALS: Readonly<Record<string, string>> = {
  commit_not_found: NO_COMMIT,
  path_not_found: "This commit holds nothing at this path.",
};

/** What a repository says once HQ denies a read the offers allowed. */
export const NO_LONGER_ALLOWED = "You no longer have access to this repository.";

/** A read that ended in no answer. */
export type GitReadStop = Extract<
  GitBrowseState<unknown>,
  { readonly state: "withheld" | "failed" | "refused" }
>;

/** A read that ended in no answer, in the person's words. */
export const troubleWords = (view: GitReadStop) =>
  view.state === "withheld"
    ? NO_LONGER_ALLOWED
    : ((view.state === "refused" ? REFUSALS[view.reason] : undefined) ?? view.words);

/**
 * Why a read ended in no answer, and the way on: Read again where HQ may answer next time; where
 * it refused, back to the repository; where it denied access, back to Git.
 */
export function GitReadStopped({
  view,
  words,
  at,
  onAgain,
}: {
  readonly view: GitReadStop;
  /** The page's own words for this end, where it has them. */
  readonly words?: string | undefined;
  /** The repository a refusal leads back to; none where the page is already its way back. */
  readonly at: GitRepoAt | null;
  readonly onAgain: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <p className="text-status-failed" role="alert">
        {words ?? troubleWords(view)}
      </p>
      {view.state === "failed" ? (
        <Button variant="ghost" size="sm" onClick={onAgain}>
          Read again
        </Button>
      ) : view.state === "withheld" ? (
        <GitBrowserLink to={{}}>Back to Git</GitBrowserLink>
      ) : at === null ? null : (
        <GitBrowserLink to={{ appId: at.appId, repo: at.repo }}>
          Back to the repository
        </GitBrowserLink>
      )}
    </div>
  );
}

/** A read not answered: still reading, waiting for HQ, or why it ended. */
export function GitNotRead({
  view,
  reading,
  at,
  onAgain,
}: {
  readonly view: Exclude<GitBrowseState<unknown>, { readonly state: "known" }>;
  readonly reading: string;
  readonly at: GitRepoAt | null;
  readonly onAgain: () => void;
}) {
  if (view.state === "unread") return <GitReading busy={view.busy} words={reading} />;
  return <GitReadStopped view={view} at={at} onAgain={onAgain} />;
}

/** A home read moves with its ref: read again on the person's ask, said when that read failed. */
export function GitHomeAgain({
  home,
  onHomeAgain,
}: {
  readonly home: { readonly busy: boolean; readonly failed: boolean };
  readonly onHomeAgain: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-3">
      {home.failed ? (
        <span className="text-status-failed" role="alert">
          HQ could not read this again. Showing the last read.
        </span>
      ) : null}
      <Button variant="ghost" size="sm" disabled={home.busy} onClick={onHomeAgain}>
        Read again
      </Button>
    </span>
  );
}

/** The page at the commit the frame's home read resolved, or what that read says instead. */
export function GitAtCommit({
  at,
  home,
  onHomeAgain,
  children,
}: {
  readonly at: GitRepoAt;
  readonly home: GitBrowseState<GitHome>;
  readonly onHomeAgain: () => void;
  readonly children: (home: GitHome, sha: string) => ReactNode;
}) {
  if (home.state === "known")
    return home.answer.sha === null ? (
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <GitNoCommit pending={home.answer.pending} />
        <GitHomeAgain home={home} onHomeAgain={onHomeAgain} />
      </div>
    ) : (
      children(home.answer, home.answer.sha)
    );
  if (home.state === "unread")
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the repository…
      </p>
    );
  return (
    <GitReadStopped
      view={home}
      // A revision HQ cannot read as one (empty, or read as an option) names no commit either.
      words={home.state === "refused" && home.reason === "invalid" ? NO_COMMIT : undefined}
      at={at}
      onAgain={onHomeAgain}
    />
  );
}
