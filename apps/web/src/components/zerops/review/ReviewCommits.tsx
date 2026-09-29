/**
 * The commits a change squashes, one line each: what it did, then its age and its hash on the
 * column's right edge. No spine — a straight run of commits on one branch has nothing for one to
 * say. A long run shows its newest five and opens whole in place ("Show all 19", D4). While they
 * are read, three rows hold their place; a read that fails says so, with *Try again*.
 */
import { historyAge, shortCommit, type GiteaCommit } from "@t3tools/client-runtime/zerops";
import { useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import type { ReadoutPart } from "~/zerops/useZeropsChangeReadout";

import { commitFold } from "./ZeropsReview.logic";
import { ReviewFailed, ReviewSection } from "./ZeropsReviewSurface";

/** How many rows hold the place of commits still being read. */
const COMMITS_PENDING = 3;

export function ReviewCommits({
  commits,
  now,
  onRetry,
}: {
  readonly commits: ReadoutPart<ReadonlyArray<GiteaCommit>>;
  readonly now: number;
  readonly onRetry: (() => void) | undefined;
}) {
  const [all, setAll] = useState(false);
  if (commits.kind === "none") return null;
  if (commits.kind === "read" && commits.value.length === 0) return null;
  const count = commits.kind === "read" ? commits.value.length : undefined;
  return (
    <ReviewSection aside={count === undefined ? undefined : String(count)} title="Commits">
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
        <CommitRows all={all} commits={commits.value} now={now} onShowAll={() => setAll(true)} />
      )}
    </ReviewSection>
  );
}

function CommitRows({
  commits,
  all,
  now,
  onShowAll,
}: {
  readonly commits: ReadonlyArray<GiteaCommit>;
  readonly all: boolean;
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
            {commit.at === undefined ? null : (
              <span className="rv-commit-at">{historyAge(commit.at, now)}</span>
            )}
            <code className="rv-commit-sha">{shortCommit(commit.sha)}</code>
          </li>
        ))}
      </ol>
      {rest === undefined ? null : (
        <button className="rv-textbtn rv-fold" onClick={onShowAll} type="button">
          Show all {rest}
        </button>
      )}
    </>
  );
}
