/**
 * The commits under a Git tab block: the Mate's change's own, as HQ's detail of it reads them
 * (`useZeropsChangeDetail`) — the same read, kept by the same head and `main`, its review makes.
 *
 * A child per block because a hook cannot be called in a loop, and each read then lives and dies
 * with the block it belongs to. Nothing to say is nothing drawn: a "Reading…" line under every
 * block on every open would be four words of chrome for a list that is usually short.
 */
import { historyAge } from "@t3tools/client-runtime/zerops";

import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsChangeDetail } from "~/zerops/useZeropsChangeDetail";

export function ZeropsGitBlockCommits({
  appId,
  repository,
  change,
  main,
}: {
  /** The Mate's application, which is its group. */
  readonly appId: string | undefined;
  readonly repository: string;
  /** The Mate's change in the repository, by its number and head; none, nothing is read. */
  readonly change: { readonly number: number; readonly head: string } | undefined;
  /** What `main` was as the flow last told it: the newest landed change's commit. */
  readonly main: string | undefined;
}) {
  const now = useNowMs();
  const detail = useZeropsChangeDetail(
    appId === undefined || change === undefined
      ? null
      : { link: { appId, repo: repository, number: change.number }, head: change.head, main },
  );
  const readout = detail.readout;
  if (readout.kind !== "read" || readout.value.commits.length === 0) return null;
  const commits = readout.value.commits;
  return (
    <section className="flex min-w-0 flex-col gap-1" data-zerops-surface="git-commits">
      <h4 className="text-xs font-medium text-muted-foreground">Commits · {commits.length}</h4>
      <ul className="flex min-w-0 flex-col">
        {commits.map((commit) => {
          const age = historyAge(commit.at, now);
          return (
            <li
              className="flex min-w-0 items-baseline gap-2 py-1 text-xs"
              data-zerops-surface="git-commit"
              key={commit.sha}
            >
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                {commit.sha.slice(0, 7)}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{commit.subject}</span>
              {age === undefined ? null : (
                <span className="shrink-0 tabular-nums text-muted-foreground">{age}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
