/**
 * The commits a change squashes, one line each: what it did, then its age and its hash on the
 * column's right edge, which opens the commit's page in the Git browser. No spine — a straight run of commits on one branch has nothing for one to
 * say. A long run shows its newest five and opens whole in place ("Show all 19", D4). While they
 * are read, three rows hold their place; a read that fails says so, with *Try again*.
 */
import { historyAge, shortCommit, type ChangeReadoutCommit } from "@t3tools/client-runtime/zerops";
import { useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import type { ReadoutPart } from "~/zerops/useZeropsChangeDetail";

import { commitFold, NOT_RECORDED_ASIDE } from "./ZeropsReview.logic";
import { ReviewFailed, ReviewSection, type ReviewFoldState } from "./ZeropsReviewSurface";
import { Button } from "~/components/ui/button";

import { GitBrowserLink, gitCommitLink, type GitRepoAt } from "../gitBrowser/GitBrowserLink";

/** How many rows hold the place of commits still being read. */
const COMMITS_PENDING = 3;

export function ReviewCommits({
  commits,
  at,
  now,
  onRetry,
  fold,
  notRecorded,
  cut = false,
}: {
  readonly commits: ReadoutPart<ReadonlyArray<ChangeReadoutCommit>>;
  /** The repository its commits open in, in the Git browser; absent, a hash is only words. */
  readonly at?: GitRepoAt | undefined;
  readonly now: number;
  readonly onRetry: (() => void) | undefined;
  /** Folded to its row, in the sheet: one click away. */
  readonly fold?: ReviewFoldState | undefined;
  /** HQ has not recorded the commits: said as that, with a press that reads them where offered. */
  readonly notRecorded?: { readonly onShow: (() => void) | undefined } | undefined;
  /** HQ recorded only the newest commits. */
  readonly cut?: boolean | undefined;
}) {
  const [all, setAll] = useState(false);
  if (notRecorded !== undefined) {
    return (
      <ReviewSection aside={NOT_RECORDED_ASIDE} fold={fold} title="Commits">
        <p className="rv-diff-note">The commits are not known yet.</p>
        {notRecorded.onShow === undefined ? null : (
          <Button onClick={notRecorded.onShow} size="sm" variant="link">
            Show commits
          </Button>
        )}
      </ReviewSection>
    );
  }
  if (commits.kind === "none") return null;
  if (commits.kind === "read" && commits.value.length === 0) return null;
  const count = commits.kind === "read" ? commits.value.length : undefined;
  return (
    <ReviewSection
      aside={count === undefined ? undefined : String(count)}
      fold={fold}
      title="Commits"
    >
      {commits.kind === "reading" ? (
        <ol aria-busy="true" className="rv-commits">
          {Array.from({ length: COMMITS_PENDING }, (_, index) => (
            <li aria-hidden="true" className="rv-commit-skeleton" key={index}>
              <span />
              <span />
            </li>
          ))}
        </ol>
      ) : commits.kind === "failed" ? (
        <ReviewFailed
          onRetry={onRetry}
          reason={commits.reason}
          what="The commits couldn't be read."
        />
      ) : (
        <CommitRows
          all={all}
          cut={cut}
          at={at}
          commits={commits.value}
          now={now}
          onShowAll={() => setAll(true)}
        />
      )}
    </ReviewSection>
  );
}

function CommitRows({
  commits,
  at,
  all,
  cut,
  now,
  onShowAll,
}: {
  readonly commits: ReadonlyArray<ChangeReadoutCommit>;
  readonly at: GitRepoAt | undefined;
  readonly all: boolean;
  readonly cut: boolean;
  readonly now: number;
  readonly onShowAll: () => void;
}) {
  const { shown, rest } = commitFold({ total: commits.length, all });
  return (
    <>
      <ol className="rv-commits">
        {commits.slice(0, shown).map((commit) => (
          <li className="rv-commit" key={commit.sha}>
            {/* Cut to its line, it is whole a hover away (D4). */}
            <Tooltip>
              <TooltipTrigger render={<span className="rv-commit-t" />}>
                {commit.subject}
              </TooltipTrigger>
              <TooltipPopup>{commit.subject}</TooltipPopup>
            </Tooltip>
            <span className="rv-commit-at">{historyAge(commit.at, now)}</span>
            <code className="rv-commit-sha">
              {at === undefined ? (
                shortCommit(commit.sha)
              ) : (
                <GitBrowserLink to={gitCommitLink(at, commit.sha)} tone="muted">
                  {shortCommit(commit.sha)}
                </GitBrowserLink>
              )}
            </code>
          </li>
        ))}
      </ol>
      {cut && (all || rest === undefined) ? <p className="rv-diff-note">and more</p> : null}
      {rest === undefined ? null : (
        <Button className="mt-1 -ml-2" onClick={onShowAll} size="sm" variant="link">
          Show all {rest}
        </Button>
      )}
    </>
  );
}
