/**
 * What an opened release carried, under its row: per repository it moved commits in, the
 * service's hostname over its changes; a repository it moved nothing in is not listed.
 *
 * Everything hangs from the row's title column and ends at the edge its age ends at, on the list's
 * own grid (`ReleaseList`): the hostname, each change's title and who made it, the commit's id at
 * the end. A change's marker stands in the gutter before the title, and a title too long for a
 * narrow column wraps: a change's row is as tall as it needs. No time is said here: the release's
 * own row says when.
 */
import {
  groupHistory,
  historyEarlier,
  historyLine,
  type HistoryEntry,
  type Moved,
} from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";

import type { ComparedCommits } from "~/zerops/useReleaseComparisons";

import { GitBrowserLink, gitCommitLink, type GitRepoAt } from "./gitBrowser/GitBrowserLink";
import { changeTitle } from "./projects/projectHistory.logic";
import type { HistoryChange, HistoryNames } from "./ZeropsHistoryView";
import { ZeropsReadFailure } from "./ZeropsReadFailure";

const NOWHERE: ReadonlyMap<string, string> = new Map();
const NO_TAGS: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

/** One sentence in the changes' place: the read under way, or a release that carried none. */
const SENTENCE = "m-0 text-body text-muted-foreground";

/**
 * Props: `what` (HQ's comparison of the release, `undefined` before it is asked); `changed` (the
 * repositories it moved commits in, `reposCarried`); `appId` (the application, for a commit's page
 * in the Git browser); `names` (a Mate by its name); `onOpenChange` (opens the review of the change
 * that landed a commit, in its repository).
 */
export function ZeropsReleaseCarried({
  what,
  changed,
  appId,
  names,
  onOpenChange,
}: {
  readonly what: ComparedCommits | undefined;
  readonly changed: ReadonlyArray<Moved>;
  readonly appId: string;
  readonly names: HistoryNames;
  readonly onOpenChange?:
    | ((repository: string, change: HistoryChange, from: HTMLElement) => void)
    | undefined;
}) {
  return (
    <div
      className="col-span-full grid min-w-0 grid-cols-subgrid px-3.5 pt-2 pb-3"
      data-zerops-surface="release-carried"
    >
      {/* From the title's column to the age's end; groups stand four times a label's gap apart. */}
      <div className="col-span-2 col-start-3 flex min-w-0 flex-col gap-4">
        {what?.state === "failed" ? (
          <ZeropsReadFailure action="Compare again" reason={what.reason} again={what.again} />
        ) : what?.state === "reading" ? (
          <p className={SENTENCE}>Reading commit messages…</p>
        ) : changed.length === 0 ? (
          <p className={SENTENCE}>No commits.</p>
        ) : (
          changed.map((read) => (
            <Repository
              at={{ appId, repo: read.repository }}
              key={read.repository}
              names={names}
              onOpenChange={
                onOpenChange === undefined
                  ? undefined
                  : (change, from) => {
                      onOpenChange(read.repository, change, from);
                    }
              }
              read={read}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** One repository's changes, under the hostname of the service it moved. */
function Repository({
  read,
  at,
  names,
  onOpenChange,
}: {
  readonly read: Moved;
  readonly at: GitRepoAt;
  readonly names: HistoryNames;
  readonly onOpenChange: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
}) {
  const entries = groupHistory({ commits: read.commits, deployed: NOWHERE, tags: NO_TAGS });
  const earlier = historyEarlier(entries.length, read.total);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-zerops-surface="release-repository">
      {/* A service's own name, in the face of names: never the face of the app's labels. */}
      <span className="truncate font-mono text-caption text-muted-foreground">
        {read.services[0] ?? read.repository}
      </span>
      <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
        {entries.map((entry) => (
          <Change at={at} entry={entry} key={entry.sha} names={names} onOpenChange={onOpenChange} />
        ))}
      </ul>
      {earlier === undefined ? null : (
        <p className="m-0 pt-1 text-caption text-muted-foreground">{earlier}</p>
      )}
    </div>
  );
}

function Change({
  entry,
  at,
  names,
  onOpenChange,
}: {
  readonly entry: HistoryEntry;
  readonly at: GitRepoAt;
  readonly names: HistoryNames;
  readonly onOpenChange: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
}) {
  const { change } = entry;
  // A change by its title, as on every page: GitHub's "(#17)" is no part of it. A commit no
  // change landed keeps its subject as written.
  const title = change === null ? entry.subject : changeTitle(entry.subject);
  // Who, and nothing of when: the clock is left out, so the line says no age.
  const who = historyLine(entry, undefined, names);
  return (
    <li className="relative flex min-w-0 flex-col" data-zerops-surface="release-change">
      {/* In the gutter, centred on the title's first line: the text keeps the column's edge. */}
      <span
        aria-hidden="true"
        className="absolute -start-3 top-2 size-1 rounded-full bg-muted-foreground/60"
      />
      <span className="flex min-w-0 items-baseline gap-3">
        {onOpenChange === undefined || change === null ? (
          <span className="min-w-0 flex-1 text-body wrap-break-word text-foreground">{title}</span>
        ) : (
          <span className="flex min-w-0 flex-1">
            <button
              className="flex max-w-full min-w-0 cursor-pointer items-start gap-1 rounded-sm text-start text-body text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              onClick={(event) => {
                onOpenChange(change, event.currentTarget);
              }}
              type="button"
            >
              <span className="min-w-0 wrap-break-word">{title}</span>
              {/* What opens says so at rest, at its end, as on everything that goes somewhere;
                  on the title's first line where a narrow column wraps it. */}
              <span aria-hidden="true" className="flex h-5 shrink-0 items-center">
                <ChevronRightIcon className="size-3.5 text-muted-foreground/60" />
              </span>
            </button>
          </span>
        )}
        <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
          <GitBrowserLink to={gitCommitLink(at, entry.sha)} tone="muted">
            {entry.shortSha}
          </GitBrowserLink>
        </span>
      </span>
      {who === undefined ? null : (
        <span className="truncate text-caption text-muted-foreground">{who}</span>
      )}
    </li>
  );
}
