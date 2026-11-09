/**
 * A change's commits, in the Code page's "What changed" above its files: a quiet *Commits · N*
 * fold, read as the section draws so it can count them, without file patches. A read on its way
 * says so once opened; an empty or failed list says nothing more than the fold. Rows open a
 * commit's changes only when a conversation can display them beside the list.
 */
import { historyAge } from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsChangeCommits } from "~/zerops/useZeropsChangeCommits";

export interface GitCommit {
  readonly sha: string;
  readonly subject: string;
  readonly at?: string | undefined;
}

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
  readonly onOpenCommit?: ((commit: GitCommit) => void) | undefined;
}) {
  const identity =
    appId === undefined || change === undefined
      ? null
      : JSON.stringify([appId, repository, change.number]);
  const [openedChange, setOpenedChange] = useState<string | null>(null);
  const open = identity !== null && openedChange === identity;
  const detail = useZeropsChangeCommits(
    appId === undefined || change === undefined
      ? null
      : { link: { appId, repo: repository, number: change.number }, head: change.head, main },
  );
  if (appId === undefined || change === undefined) return null;
  const readout = detail.readout;
  return (
    <GitCommitsFold
      commits={readout.kind === "read" ? readout.value.commits : undefined}
      onOpenCommit={onOpenCommit}
      onToggle={() => setOpenedChange(open ? null : identity)}
      open={open}
    />
  );
}

/**
 * The fold itself, drawn from what was read. Props: `open`; `onToggle`; `commits` (undefined while
 * read or unreadable); `onOpenCommit` (a row opens the commit's changes).
 */
export function GitCommitsFold({
  open,
  onToggle,
  commits,
  onOpenCommit,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly commits: ReadonlyArray<GitCommit> | undefined;
  readonly onOpenCommit?: ((commit: GitCommit) => void) | undefined;
}) {
  const now = useNowMs();
  // A change with no commits of its own has nothing to fold.
  if (commits?.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col" data-zerops-surface="git-commits">
      <button
        aria-expanded={open}
        className="-mx-1.5 flex w-fit cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        Commits
        {commits === undefined ? null : (
          <span className="tabular-nums">{` · ${String(commits.length)}`}</span>
        )}
      </button>
      {!open ? null : commits === undefined ? (
        <p className="py-1 ps-5 text-caption text-muted-foreground">Reading commits…</p>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col p-0 ps-5">
          {commits.map((commit) => {
            const age = commit.at === undefined ? undefined : historyAge(commit.at, now);
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
              <li
                className="flex min-w-0 text-xs"
                data-zerops-surface="git-commit"
                key={commit.sha}
              >
                {onOpenCommit === undefined ? (
                  <div className="flex min-w-0 flex-1 items-baseline gap-2 py-1">{line}</div>
                ) : (
                  <button
                    className="-mx-1.5 flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => onOpenCommit(commit)}
                    type="button"
                  >
                    {line}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
