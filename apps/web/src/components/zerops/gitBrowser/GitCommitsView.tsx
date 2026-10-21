/**
 * A repository's history, or a path's, at the commit the page's branch, tag or commit names: the
 * newest commit first, under each day's heading, 100 at a time. Every page continues the list the
 * first started at, so a branch moving meanwhile never reorders it. A commit a change merged links
 * to that change's review by its title.
 */
import { LegendList } from "@legendapp/list/react";
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import { historyRows, type HistoryRow } from "@t3tools/client-runtime/zerops/gitBrowse/log";
import type { GitLog, GitLogItem } from "@t3tools/shared/hqGitBrowse/log";
import { useMemo, useState, type MouseEvent } from "react";
import { appBasePath } from "~/basePath";
import { Button, InlineButton } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useGitBrowseReads } from "~/zerops/useGitBrowse";
import type { GitBrowseSearch, GitRepoPageProps } from "./GitBrowseView";
import { changeTitle, type PickerChange } from "./GitRefPicker.logic";
import { GitWhen } from "./GitWhen";

const ROW_HEIGHT = 55;
const DAY_HEIGHT = 32;
const END_HEIGHT = 48;
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dayOf = (at: string) => `Commits on ${DAY.format(new Date(at))}`;

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** A link inside the repository: its address for a new tab, the page's own navigation on a click. */
function RepoLink({
  to,
  hrefOf,
  navigate,
  tone,
  children,
}: Pick<GitRepoPageProps, "hrefOf" | "navigate"> & {
  readonly to: GitBrowseSearch;
  readonly tone?: "default" | "muted";
  readonly children: string;
}) {
  return (
    <InlineButton
      tone={tone}
      render={
        <a
          href={hrefOf(to)}
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            navigate(to);
          }}
        />
      }
    >
      {children}
    </InlineButton>
  );
}

function CommitRow({
  item,
  changes,
  appId,
  repo,
  hrefOf,
  navigate,
  onOpenChange,
}: Pick<GitRepoPageProps, "appId" | "repo" | "hrefOf" | "navigate" | "onOpenChange"> & {
  readonly item: GitLogItem;
  readonly changes: ReadonlyArray<PickerChange>;
}) {
  const change = item.change;
  const title = changeTitle(item, changes);
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm text-foreground">{item.subject}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{item.authorName}</span>
          <GitWhen at={item.committedAt}>{formatRelativeTimeLabel(item.committedAt)}</GitWhen>
          {change === undefined ? null : (
            <InlineButton
              render={
                <a
                  href={`${appBasePath()}/change/${encodeURIComponent(appId)}/${encodeURIComponent(repo)}/${change.number}`}
                  onClick={(event) => {
                    if (onOpenChange === undefined || !plainClick(event)) return;
                    event.preventDefault();
                    onOpenChange(change.number);
                  }}
                />
              }
            >
              {title ?? `Change #${change.number}`}
            </InlineButton>
          )}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs">
        <RepoLink
          to={{ rev: item.sha, view: "commit" }}
          hrefOf={hrefOf}
          navigate={navigate}
          tone="muted"
        >
          {item.sha.slice(0, 7)}
        </RepoLink>
      </span>
      <span className="shrink-0 text-xs">
        <RepoLink to={{ rev: item.sha, view: "code" }} hrefOf={hrefOf} navigate={navigate}>
          Browse files
        </RepoLink>
      </span>
    </div>
  );
}

/** How the list ends: still reading, a page that failed, more to show, or why it stops where it does. */
function ListEnd({
  last,
  path,
  onMore,
  onAgain,
}: {
  readonly last: GitBrowseState<GitLog> | undefined;
  readonly path: string;
  readonly onMore: (cursor: string) => void;
  readonly onAgain: () => void;
}) {
  if (last === undefined || last.state === "withheld") return null;
  if (last.state === "unread")
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground" role="status">
        Reading the history…
      </p>
    );
  if (last.state !== "known")
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <p className="text-sm text-status-failed" role="alert">
          {last.state === "refused" && last.reason === "commit_not_found"
            ? "This branch, tag or commit is not in the repository."
            : last.words}
        </p>
        <Button variant="ghost" size="sm" onClick={onAgain}>
          Read again
        </Button>
      </div>
    );
  const page = last.answer;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {page.next === null ? null : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => onMore(page.next!)}>
            Show more
          </Button>
        </div>
      )}
      {page.next === null && page.addsPath ? (
        <p className="text-xs text-muted-foreground">History before a rename is not followed.</p>
      ) : null}
      {page.stopped ? (
        <p className="text-xs text-muted-foreground">
          The history shown here stops after 10,000 commits. Clone the repository to read the rest.
        </p>
      ) : null}
      {page.next === null && page.items.length === 0 && path !== "" ? (
        <p className="text-sm text-muted-foreground">No commits changed {path}.</p>
      ) : null}
    </div>
  );
}

/** A short list's own height, so its box ends where its rows do. */
const listHeight = (rows: ReadonlyArray<HistoryRow>) =>
  rows.reduce((sum, row) => sum + (row.kind === "day" ? DAY_HEIGHT : ROW_HEIGHT), END_HEIGHT);

function HistoryAt(props: GitRepoPageProps & { readonly sha: string }) {
  const { appId, repo, sha, search, repository } = props;
  const path = search.path ?? "";
  // "Show more" pages of this list; another commit or path starts from its first page.
  const of = `${sha}\n${path}`;
  const [more, setMore] = useState<{
    readonly of: string;
    readonly cursors: ReadonlyArray<string>;
  }>({ of: "", cursors: [] });
  const cursors = more.of === of ? more.cursors : [];
  const { views, again } = useGitBrowseReads(
    [undefined, ...cursors].map((cursor) => ({
      appId,
      repo,
      read: "log" as const,
      params: {
        sha,
        ...(path === "" ? {} : { path }),
        ...(cursor === undefined ? {} : { cursor }),
      },
    })),
    true,
  );
  const items = useMemo(
    () => views.flatMap((view) => (view.state === "known" ? view.answer.items : [])),
    [views],
  );
  const rows = useMemo(() => historyRows(items, dayOf), [items]);
  const changes = useMemo(
    () => (repository?.changes ?? []).map(({ pull }) => pull),
    [repository?.changes],
  );
  const renderRow = (row: HistoryRow) =>
    row.kind === "day" ? (
      <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{row.day}</h3>
    ) : (
      <CommitRow {...props} item={row.item} changes={changes} />
    );
  return (
    <section aria-label="History" className="flex min-w-0 flex-col gap-2">
      {path === "" ? null : (
        <h2 className="min-w-0 break-all text-base font-medium text-foreground">
          History of <span className="font-mono">{path}</span>
        </h2>
      )}
      <Card variant="flat">
        <LegendList<HistoryRow>
          data={rows}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.kind}
          renderItem={({ item }) => renderRow(item)}
          estimatedItemSize={ROW_HEIGHT}
          drawDistance={ROW_HEIGHT * 10}
          // The list scrolls in its own box below the frame; a short list is only as tall as itself.
          style={{ height: `min(70dvh, ${listHeight(rows)}px)` }}
          ListFooterComponent={
            <ListEnd
              last={views.at(-1)}
              path={path}
              onAgain={again}
              onMore={(cursor) => setMore({ of, cursors: [...cursors, cursor] })}
            />
          }
        />
      </Card>
    </section>
  );
}

export function GitCommitsView(props: GitRepoPageProps) {
  const { home, onHomeAgain } = props;
  if (home.state === "known")
    return home.answer.sha === null ? (
      <p className="text-sm text-muted-foreground">No commits on this branch yet.</p>
    ) : (
      <HistoryAt {...props} sha={home.answer.sha} />
    );
  if (home.state === "withheld") return null;
  if (home.state === "unread")
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the repository…
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-status-failed" role="alert">
        {home.state === "refused" && home.reason === "commit_not_found"
          ? "This branch, tag or commit is not in the repository."
          : home.words}
      </p>
      <Button variant="ghost" size="sm" onClick={onHomeAgain}>
        Read again
      </Button>
    </div>
  );
}
