/**
 * What has happened to a codebase, drawn the way the menu draws a project.
 *
 * The version on a stop used to be a link into Gitea and *History* a second
 * one. Neither worked: the app holds the only Gitea token, so a person's
 * browser has no session there and both landed on a sign-in page (measured
 * 2026-09-19). Gitea answers this perfectly well as an API, so the answer is
 * drawn here instead of handed off — "we can still make the system available,
 * just give the basic functions our face" (the owner, 2026-09-19).
 *
 * Mounted by the group's page and the stop's own, both of which stand in place
 * of the thread rather than over it.
 *
 * Same language as the left menu: one spine, a node per commit, and the stops
 * that are running a commit wear their name on it. The rows sit flush and the
 * rail is opaque for the same reason they are there.
 *
 * Structural only: the folding is `groupHistory`'s (R5), the reading is the
 * caller's.
 */
import { groupHistory, historyLine, type HistoryEntry } from "@t3tools/client-runtime/zerops";

import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";

/** What the dialog is looking at, and what the reads answered. */
export interface ZeropsHistoryRequest {
  /** The repository, as the recipe names it — never guessed from a hostname. */
  readonly repo: string;
  /** `environment name → the whole sha it runs`. */
  readonly deployed: ReadonlyMap<string, string>;
}

export function ZeropsHistoryView({
  request,
  commits,
}: {
  readonly request: ZeropsHistoryRequest;
  readonly commits: ZeropsCommitsState;
}) {
  if (commits.kind === "no-gitea") {
    return <HistoryNote>Sign in to Gitea to read this repository&rsquo;s history.</HistoryNote>;
  }
  if (commits.kind === "failed") {
    return <HistoryNote>{commits.reason}</HistoryNote>;
  }
  if (commits.kind === "reading") {
    return <HistoryNote>Reading the history&hellip;</HistoryNote>;
  }
  const entries = groupHistory({
    commits: commits.commits,
    deployed: request.deployed,
    tags: commits.releases,
  });
  if (entries.length === 0) {
    return <HistoryNote>Nothing has landed on this repository yet.</HistoryNote>;
  }
  return (
    <ul className="flex flex-col" data-zerops-surface="zerops-history">
      {entries.map((entry, index) => (
        <HistoryRow
          entry={entry}
          first={index === 0}
          key={entry.sha}
          last={index === entries.length - 1}
        />
      ))}
    </ul>
  );
}

function HistoryRow({
  entry,
  first,
  last,
}: {
  readonly entry: HistoryEntry;
  readonly first: boolean;
  readonly last: boolean;
}) {
  const line = historyLine(entry);
  const live = entry.deployedTo.length > 0;
  return (
    <li className="flex min-w-0 items-stretch gap-2.5" data-zerops-surface="zerops-history-commit">
      <span className="relative flex w-5 shrink-0 flex-col items-center self-stretch">
        <span aria-hidden="true" className={first ? RAIL_BLANK : RAIL_LINE} />
        {/* A commit something is running is a stop on this line, so it is the
            same filled node the menu gives one; the rest are open. */}
        <span
          aria-hidden="true"
          className={
            live
              ? "size-2 shrink-0 rounded-full bg-[var(--zerops-status-ok)]"
              : "size-2 shrink-0 rounded-full border border-[var(--zerops-rail)] bg-[var(--app-theme-surface)]"
          }
        />
        <span aria-hidden="true" className={last ? RAIL_BLANK : RAIL_LINE} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">
            {entry.subject}
          </span>
          {/* The name it went live under, where a release carried it. */}
          {entry.tags.map((tag) => (
            <span
              className="shrink-0 rounded-full bg-[var(--zerops-status-ok-surface)] px-1.5 text-[11px] leading-[18px] font-medium text-[var(--zerops-status-ok-text)]"
              data-zerops-surface="zerops-history-release"
              key={tag}
            >
              {tag}
            </span>
          ))}
          <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground tabular-nums">
            {entry.shortSha}
          </span>
        </span>
        {line === undefined ? null : (
          <span className="truncate text-xs leading-4 text-muted-foreground">{line}</span>
        )}
      </span>
    </li>
  );
}

function HistoryNote({ children }: { readonly children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

const RAIL_LINE = "w-px flex-1 bg-[var(--zerops-rail)]";
const RAIL_BLANK = "w-px flex-1";
