import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

import { GitBrowserLink, type GitRepoAt } from "./gitBrowser/GitBrowserLink";
import type { HistoryChange } from "./ZeropsHistoryView";
import { ChangeAge } from "./projects/ChangeRow";

export interface RecordedStageHistoryProps {
  readonly repo: GitRepoAt;
  readonly changes: ReadonlyArray<FlowPullRequest> | undefined;
  readonly publication: RepoListEntry | undefined;
  readonly onOpenChange?: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
}

/** Overview history uses recorded domain rows; History explicitly opens Git. */
export function RecordedStageHistory({
  repo,
  changes,
  publication,
  onOpenChange,
}: RecordedStageHistoryProps) {
  return (
    <div data-zerops-surface="recorded-stage-history">
      {changes === undefined ? (
        <p className="py-2 text-sm text-muted-foreground">Reading recorded changes…</p>
      ) : (
        <ul>
          {changes.map((change) => (
            <li
              className="flex items-center gap-2 py-2 text-sm"
              key={`${change.repository}-${String(change.number)}`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={(event) => onOpenChange?.(change, event.currentTarget)}
              >
                {change.title}
              </button>
              <ChangeAge at={change.mergedAt} />
            </li>
          ))}
        </ul>
      )}
      {publication?.mainHead == null ? null : (
        <p className="py-2 text-xs text-muted-foreground">
          Latest recorded main: {publication.mainHead.slice(0, 7)} ·{" "}
          <ChangeAge at={publication.updatedAt} />
        </p>
      )}
      <GitBrowserLink to={{ ...repo, view: "commits" }}>History</GitBrowserLink>
    </div>
  );
}
