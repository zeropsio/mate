import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

import { Row } from "~/components/ui/row";
import { GitBrowserLink, type GitRepoAt } from "./gitBrowser/GitBrowserLink";
import type { HistoryChange } from "./ZeropsHistoryView";
import { ChangeAge } from "./system/ChangeRow";
import { Loading } from "~/components/ui/loading";
import { Text } from "~/components/ui/text";

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
        <Loading className="my-2" count={3} label="Recorded changes" shape="lines" />
      ) : (
        <ul>
          {changes.map((change) => (
            <li key={`${change.repository}-${String(change.number)}`}>
              <Row
                meta={<ChangeAge at={change.mergedAt} />}
                onClick={(event) => onOpenChange?.(change, event.currentTarget)}
                pressable
                render={<button type="button" />}
                size="sm"
                title={change.title}
              />
            </li>
          ))}
        </ul>
      )}
      {publication?.mainHead == null ? null : (
        <Text className="py-2" render={<p />} variant="note">
          Latest recorded main: {publication.mainHead.slice(0, 7)} ·{" "}
          <ChangeAge at={publication.updatedAt} />
        </Text>
      )}
      <GitBrowserLink to={{ ...repo, view: "commits" }}>History</GitBrowserLink>
    </div>
  );
}
