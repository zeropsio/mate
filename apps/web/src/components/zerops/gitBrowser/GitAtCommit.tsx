/**
 * What every page that reads at a commit shares: the commit the page's branch, tag or commit names
 * now (the frame's home read), and how a read says it is still reading or why it stopped.
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";

/** A read not answered yet: reading, or waiting for HQ before it can. */
export function GitReading({ busy, words }: { readonly busy: boolean; readonly words: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {busy ? words : "Waiting for HQ…"}
    </p>
  );
}

/** Why a read stopped, and Read again. */
export function GitReadTrouble({
  words,
  onAgain,
}: {
  readonly words: string;
  readonly onAgain: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-status-failed" role="alert">
        {words}
      </p>
      <Button variant="ghost" size="sm" onClick={onAgain}>
        Read again
      </Button>
    </div>
  );
}

const NO_COMMIT = "This branch, tag or commit is not in the repository.";

const REFUSALS: Readonly<Record<string, string>> = {
  commit_not_found: NO_COMMIT,
  path_not_found: "This commit holds nothing at this path.",
};

/** A read that ended in no answer, in the person's words. */
export const troubleWords = (view: { readonly words: string; readonly reason?: string }) =>
  (view.reason === undefined ? undefined : REFUSALS[view.reason]) ?? view.words;

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
  home,
  onHomeAgain,
  children,
}: {
  readonly home: GitBrowseState<GitHome>;
  readonly onHomeAgain: () => void;
  readonly children: (home: GitHome, sha: string) => ReactNode;
}) {
  if (home.state === "known")
    return home.answer.sha === null ? (
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <p>No commits on this branch yet.</p>
        <GitHomeAgain home={home} onHomeAgain={onHomeAgain} />
      </div>
    ) : (
      children(home.answer, home.answer.sha)
    );
  if (home.state === "withheld") return null;
  if (home.state === "unread")
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the repository…
      </p>
    );
  return (
    <GitReadTrouble
      words={
        // A revision HQ cannot read as one (empty, or read as an option) names no commit either.
        home.state === "refused" && home.reason === "invalid" ? NO_COMMIT : troubleWords(home)
      }
      onAgain={onHomeAgain}
    />
  );
}
