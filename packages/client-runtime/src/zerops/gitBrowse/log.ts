/**
 * `log`: the commits reachable from one commit, or those that touched a path, a page at a time
 * (`@t3tools/shared/hqGitBrowse/log`). Pinned to that commit: a held page is never read again.
 *
 * @module zerops/gitBrowse/log
 */
import { GitLog, GitLogQuery, type GitLogItem } from "@t3tools/shared/hqGitBrowse/log";

export const logRead = { query: GitLogQuery, value: GitLog, moving: false } as const;

export type HistoryRow =
  | { readonly kind: "day"; readonly key: string; readonly day: string }
  | { readonly kind: "commit"; readonly key: string; readonly item: GitLogItem };

/** A list's commits in HQ's order, each run of one day under that day's heading. */
export const historyRows = (
  items: ReadonlyArray<GitLogItem>,
  dayOf: (at: string) => string,
): ReadonlyArray<HistoryRow> => {
  const rows: HistoryRow[] = [];
  let last: string | null = null;
  for (const item of items) {
    const day = dayOf(item.committedAt);
    if (day !== last) rows.push({ kind: "day", key: `day:${item.sha}`, day });
    last = day;
    rows.push({ kind: "commit", key: item.sha, item });
  }
  return rows;
};
