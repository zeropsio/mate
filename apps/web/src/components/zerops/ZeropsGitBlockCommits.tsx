/**
 * Explicit History reads the change's commits without file patches. Empty, pending and failed
 * lists draw nothing, matching the Git block's existing quiet readout. Rows open a commit's
 * changes only when a conversation can display them beside the list.
 */
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { historyAge } from "@t3tools/client-runtime/zerops";

import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsChangeCommits } from "~/zerops/useZeropsChangeCommits";

export function ZeropsGitBlockCommits({
  appId,
  repository,
  change,
  main,
  onOpenCommit,
}: {
  /** The Mate's application, which is its group. */
  readonly appId: string | undefined;
  readonly repository: string;
  /** The Mate's change in the repository, by its number and head; none, nothing is read. */
  readonly change: { readonly number: number; readonly head: string } | undefined;
  /** What `main` was as the flow last told it: the newest landed change's commit. */
  readonly main: string | undefined;
  readonly onOpenCommit?:
    | ((commit: { readonly sha: string; readonly subject: string }) => void)
    | undefined;
}) {
  const identity =
    appId === undefined || change === undefined
      ? null
      : JSON.stringify([appId, repository, change.number]);
  const [openedChange, setOpenedChange] = useState<string | null>(null);
  const historyOpen = identity !== null && openedChange === identity;
  const now = useNowMs();
  const detail = useZeropsChangeCommits(
    !historyOpen || appId === undefined || change === undefined
      ? null
      : { link: { appId, repo: repository, number: change.number }, head: change.head, main },
  );
  const readout = detail.readout;
  if (appId === undefined || change === undefined) return null;
  if (!historyOpen)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpenedChange(identity)}>
        History
      </Button>
    );

  if (readout.kind !== "read" || readout.value.commits.length === 0) return null;
  const commits = readout.value.commits;
  return (
    <section className="flex min-w-0 flex-col gap-1" data-zerops-surface="git-commits">
      <h4 className="text-xs font-medium text-muted-foreground">Commits · {commits.length}</h4>
      <ul className="flex min-w-0 flex-col">
        {commits.map((commit) => {
          const age = historyAge(commit.at, now);
          const line = (
            <>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                {commit.sha.slice(0, 7)}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{commit.subject}</span>
              {age === undefined ? null : (
                <span className="shrink-0 tabular-nums text-muted-foreground">{age}</span>
              )}
            </>
          );
          return (
            <li className="flex min-w-0 text-xs" data-zerops-surface="git-commit" key={commit.sha}>
              {onOpenCommit === undefined ? (
                <div className="flex min-w-0 flex-1 items-baseline gap-2 py-1">{line}</div>
              ) : (
                <button
                  className="-mx-1.5 flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => onOpenCommit({ sha: commit.sha, subject: commit.subject })}
                  type="button"
                >
                  {line}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
