/**
 * What has happened to a codebase, drawn the way the menu draws a project.
 *
 * HQ answers it (`useRepositoryHistory`): every commit up to `main`'s head, newest first and bounded,
 * each naming the change of HQ's that landed it. A commit a change landed opens that change's
 * review; one none did — a person's, a recipe's — is a line, and nothing more.
 *
 * Mounted by the group's page, the stop's own, and a release row that says what it carried.
 *
 * Same language as the left menu: one spine, a node per commit, and the stops that are running a
 * commit wear their name on it. The rows sit flush and the rail is opaque for the same reason they
 * are there.
 *
 * Structural only: the folding is `groupHistory`'s (R5), the reading is the caller's.
 */
import {
  groupHistory,
  historyEarlier,
  historyLine,
  historyNote,
  type HistoryEntry,
} from "@t3tools/client-runtime/zerops";
import { RUNNING_HERE } from "@t3tools/client-runtime/zerops/flow";
import { ChevronRightIcon } from "lucide-react";

import type { ZeropsHistoryState } from "~/zerops/useRepositoryHistory";
import { useNowMs } from "~/zerops/useNowMs";

import { ZeropsReadFailure } from "./ZeropsReadFailure";
import { StatusDot } from "./primitives";
import { RAIL_BLANK, RAIL_LINE } from "./rail";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";

/** What to call the things a history row names. */
export interface HistoryNames {
  readonly mateNames?: ReadonlyMap<string, string> | undefined;
}

export interface ZeropsHistoryRequest {
  /** The repository, as the recipe names it — never guessed from a hostname. */
  readonly repo: string;
  /** `environment name → the whole sha it runs`. */
  readonly deployed: ReadonlyMap<string, string>;
}

/** The change of HQ's that landed a commit, as a row opens its review. */
export type HistoryChange = NonNullable<HistoryEntry["change"]>;

export function ZeropsHistoryView({
  request,
  history,
  tags,
  names = {},
  onOpenChange,
  here,
}: {
  readonly request: ZeropsHistoryRequest;
  readonly history: ZeropsHistoryState;
  /** `full sha → the releases that shipped it` (`releaseTagsByCommit`). */
  readonly tags: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly names?: HistoryNames;
  /**
   * The stop this history is drawn on, by its environment name: the commit it runs reads
   * *Running here* rather than its own name. Absent where the history is no one stop's.
   */
  readonly here?: string | undefined;
  /** Opens the review of the change that landed a commit. Absent, a row is a line and nothing more. */
  readonly onOpenChange?: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
}) {
  // One clock for the whole list, the app's minute tick: rows age together and
  // move on as the minute turns, not only when something else re-renders them.
  const now = useNowMs();
  if (history.kind === "failed") {
    return (
      <ZeropsReadFailure action="Compare again" reason={history.reason} again={history.again} />
    );
  }
  if (history.kind === "reading") {
    return <HistoryNote>{historyNote("reading")}</HistoryNote>;
  }
  const entries = groupHistory({ commits: history.commits, deployed: request.deployed, tags });
  if (entries.length === 0) {
    return <HistoryNote>{historyNote("empty")}</HistoryNote>;
  }
  const earlier = historyEarlier(entries.length, history.total);
  return (
    <>
      <ul className="flex flex-col" data-zerops-surface="zerops-history">
        {entries.map((entry, index) => (
          <HistoryRow
            entry={entry}
            first={index === 0}
            here={here}
            key={entry.sha}
            last={index === entries.length - 1}
            names={names}
            now={now}
            onOpenChange={onOpenChange}
          />
        ))}
      </ul>
      {earlier === undefined ? null : (
        <p className="py-2 pl-7.5 text-xs text-muted-foreground">{earlier}</p>
      )}
    </>
  );
}

function HistoryRow({
  entry,
  first,
  here,
  last,
  names,
  now,
  onOpenChange,
}: {
  readonly entry: HistoryEntry;
  readonly first: boolean;
  readonly here: string | undefined;
  readonly last: boolean;
  /** The clock, read once by the list so every row ages against the same one. */
  readonly now: number;
  /** What to call a Mate and a project, so neither shows as an identifier. */
  readonly names: HistoryNames;
  readonly onOpenChange?: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
}) {
  const runsHere = here !== undefined && entry.deployedTo.includes(here);
  // The stop it runs on is the page itself: its name gives way to the mark, the rest stays said.
  const line = historyLine(
    runsHere ? { ...entry, deployedTo: entry.deployedTo.filter((stop) => stop !== here) } : entry,
    now,
    names,
  );
  const live = entry.deployedTo.length > 0;
  const { change } = entry;
  return (
    <li className="flex min-w-0 items-stretch gap-2.5" data-zerops-surface="zerops-history-commit">
      <span className="relative flex w-5 shrink-0 flex-col items-center self-stretch">
        {/* Pinned to the row's first line, never centred in it: a centred node
            slides down the rail as a two-line row grows. */}
        <span
          aria-hidden="true"
          className={first ? "h-3.5 w-px" : "h-3.5 w-px bg-[var(--zerops-rail)]"}
        />
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
          {onOpenChange === undefined || change === null ? (
            <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">
              {entry.subject}
            </span>
          ) : (
            <button
              className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 rounded-sm text-left text-sm leading-5 font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              onClick={(event) => {
                onOpenChange(change, event.currentTarget);
              }}
              type="button"
            >
              {/* What opens says so at rest. Hover was the only sign this row
                  had more in it, and a touch screen has no hover at all. */}
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 self-center text-muted-foreground/60"
              />
              <span className="min-w-0 truncate">{entry.subject}</span>
            </button>
          )}
          {/* The name it went live under, where a release carried it: on a
              stop's Deploys the version in plain text beside a release role
              tag, as the stop's release rows draw it; the green chip elsewhere. */}
          {entry.tags.map((tag) =>
            here === undefined ? (
              <span
                className="shrink-0 rounded-full bg-[var(--zerops-status-ok-surface)] px-1.5 text-[11px] leading-[18px] font-medium text-[var(--zerops-status-ok-text)]"
                data-zerops-surface="zerops-history-release"
                key={tag}
              >
                {tag}
              </span>
            ) : (
              <span
                className="flex shrink-0 items-center gap-1.5 self-center"
                data-zerops-surface="zerops-history-release"
                key={tag}
              >
                <span className="text-[13px] leading-5 text-foreground tabular-nums">{tag}</span>
                <ZeropsRoleTag label="release" />
              </span>
            ),
          )}
          <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground tabular-nums">
            {entry.shortSha}
          </span>
        </span>
        {runsHere ? (
          <span className="flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
            <StatusDot className="shrink-0" label={RUNNING_HERE} sentence tone="ok" />
            {line === undefined ? null : <span className="truncate">{line}</span>}
          </span>
        ) : line === undefined ? null : (
          <span className="truncate text-xs leading-4 text-muted-foreground">{line}</span>
        )}
      </span>
    </li>
  );
}

function HistoryNote({ children }: { readonly children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
