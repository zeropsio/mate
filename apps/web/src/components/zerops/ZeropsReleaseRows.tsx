import {
  flowVerbKey,
  flowVerbLabel,
  releaseCarriedToggleLabel,
  releaseDescription,
  rolledBackDescription,
  rolledBackTo,
  type FlowReleaseRow,
  type GitDelivery,
  type GitDeliveryEnvironment,
  type Moved,
} from "@t3tools/client-runtime/zerops";
import { RELEASE_DIDNT_GO_LIVE } from "@t3tools/client-runtime/zerops/flow";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ComparedCommits } from "~/zerops/useReleaseComparisons";
import { ZeropsReadFailure } from "./ZeropsReadFailure";
import { cn } from "~/lib/utils";
import { useNowMs } from "~/zerops/useNowMs";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { STATUS_BADGE_TONE } from "./primitives";
import { ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { ZeropsHistoryView, type HistoryChange, type HistoryNames } from "./ZeropsHistoryView";
import { releaseRowTone } from "./ZeropsProjectRow.logic";
import { DIDNT_GO_LIVE_QUIET, releaseFailureIsOver, releaseTitle } from "./ZeropsReleaseRows.logic";
import { gitReleaseHistory } from "./GitHistory.logic";
import { changeTitle } from "./projects/projectHistory.logic";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

/** What the rows need to say what each release carried — HQ's comparisons, folded. */
export interface ZeropsReleasesCarried {
  /** `tag → what it carried`, as HQ compared it (`movedCommits` over `carriedReads`). */
  readonly carried: ReadonlyMap<string, ComparedCommits>;
  readonly names: HistoryNames;
  /** The owning surface starts a compare only after this explicit row expansion. */
  readonly onExpandedChange?: ((tag: string, open: boolean) => void) | undefined;
  /** Opens the review of the change that landed a carried commit, in its repository. */
  readonly onOpenChange?:
    | ((repository: string, change: HistoryChange, from: HTMLElement) => void)
    | undefined;
}

interface ReleaseRowsProps {
  readonly groupId: string;
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /**
   * Every release of the production, newest first, where `releases` lists only the first few: a
   * row reads beside the ones before it (`releaseTitle`, `releaseFailureIsOver`). `releases` where
   * absent.
   */
  readonly every?: ReadonlyArray<FlowReleaseRow> | undefined;
  /** The verbs under way (`flowVerbKey`): a release rolling back holds its verb. */
  readonly pending: ReadonlySet<string>;
  /**
   * Opens the roll back's review from the verb pressed, naming the version it goes back to:
   * nothing rolls back from a row (pass 16, R1).
   */
  readonly onRollBack: (tag: string, from: HTMLElement) => void;
  /** Who made the live release, by name: its row says so. */
  readonly liveBy?: string | undefined;
  /** The release on its way to production, by its tag: its row says so, as the page's header does. */
  readonly releasing?: string | undefined;
  /**
   * The releases HQ refused before anything of them deployed (`releasesNotDeployed`): their rows
   * say they didn't go live, where one whose build failed says its deploy failed.
   */
  readonly notDeployed?: ReadonlySet<string> | undefined;
}

/**
 * The list the rows stand in: one grid they all share, so the version column is exactly as wide
 * as the longest version and every title starts on one edge down the list, with the ages in a
 * column of their own at the end. Its container (`@container/releases`) is the caller's card.
 */
export function ReleaseList({ children }: { readonly children: ReactNode }) {
  return <ul className={RELEASE_LIST_CLASS}>{children}</ul>;
}

/** Three titles of three lengths, so the waiting rows read as a list and not as a block. */
const WAITING_TITLES = [
  <Skeleton className="h-3 w-64 max-w-full" key="long" surface="card" />,
  <Skeleton className="h-3 w-48 max-w-full" key="short" surface="card" />,
  <Skeleton className="h-3 w-56 max-w-full" key="middle" surface="card" />,
];

/** The rows' slot while HQ has not answered the releases: three rows in a row's shape. */
export function ReleaseRowsWaiting() {
  return (
    <ul
      aria-hidden="true"
      className="m-0 flex list-none flex-col gap-1 p-0"
      data-zerops-surface="place-releases-waiting"
    >
      {WAITING_TITLES.map((title) => (
        <li
          className="flex min-w-0 items-center gap-3 border border-transparent px-3.5 py-2"
          key={title.key}
        >
          <span className="size-5 shrink-0" />
          <Skeleton className="me-1 h-3 w-12 shrink-0" surface="card" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex h-5 items-center">{title}</span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-20" surface="card" />
            </span>
          </span>
          <Skeleton className="h-3 w-10 shrink-0" surface="card" />
        </li>
      ))}
    </ul>
  );
}

const EMPTY_DEPLOYED: ReadonlyMap<string, string> = new Map();
const EMPTY_RELEASES: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

/**
 * A production's releases, newest first, as its page lists them: one row each — its version, the
 * live one's pill, the first change it brought that the last live release had not, with how many in
 * all, and when; one that carries a failed release's changes again says that instead. A calm
 * release says no word; one that is not calm says its own (Deploy failed, Refused), as a pill while
 * nothing live came after it and quietly once one did. The way back to an earlier one shows on the
 * row's hover or focus, and its review asks before anything moves. The rows only: the card around
 * them is the caller's.
 *
 * Given `carried`, a row also opens onto the commits its release carried — the whole row is the
 * press, its chevron at its start as on everything that opens in place. Without it, or before the
 * commits are read, a row is its tag and its shas.
 */
export function ZeropsReleaseRows({
  carried,
  ...props
}: ReleaseRowsProps & { readonly carried?: ZeropsReleasesCarried }) {
  // One clock for every row, so they age together.
  const now = useNowMs();
  return (
    <>
      {props.releases.map((release) => (
        <ReleaseRow
          {...props}
          carried={carried}
          key={`release-${props.groupId}-${release.tag}`}
          now={now}
          release={release}
        />
      ))}
    </>
  );
}

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function ReleaseRow({
  release,
  releases,
  every = releases,
  groupId,
  pending,
  onRollBack,
  carried,
  liveBy,
  releasing,
  notDeployed,
  now,
}: ReleaseRowsProps & {
  readonly release: FlowReleaseRow;
  readonly carried: ZeropsReleasesCarried | undefined;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const what = carried?.carried.get(release.tag);
  const moved: ReadonlyArray<Moved> = what?.state === "known" ? what.moved : [];
  const named = moved.length > 1;
  const live = release.standing === "live";
  const by = live && liveBy !== undefined ? `released by ${liveBy}` : undefined;
  // A refused release's line is HQ's reason, and the reason stays. A roll back carried nothing
  // new: it says what it went back to.
  const back = rolledBackTo(release, releases);
  const titled = releaseTitle(release, every, releasing);
  const description: { readonly primary: string; readonly secondary: string | undefined } =
    release.verdict === "refused" && release.detail !== undefined
      ? { primary: release.detail, secondary: release.line }
      : back !== undefined
        ? rolledBackDescription(back, release.line)
        : release.history !== undefined
          ? {
              // A release of commits that belong to no change is titled by what it carried, never
              // "No changes" over a count of commits.
              primary:
                titled !== undefined
                  ? titled.text
                  : release.history.changes[0] !== undefined
                    ? changeTitle(release.history.changes[0].title)
                    : release.history.commitCount > 0
                      ? plural(release.history.commitCount, "commit", "commits")
                      : "No changes",
              secondary: [
                release.history.changes.length === 0
                  ? undefined
                  : plural(release.history.changes.length, "change", "changes"),
                by,
              ]
                .filter((part) => part !== undefined)
                .join(" · "),
            }
          : carried?.onExpandedChange === undefined
            ? (described(releaseDescription(moved, release.line, now, carried?.names)) ?? {
                primary: release.line,
                secondary: by,
              })
            : { primary: release.line, secondary: "Which changes it carried was not recorded" };
  const tone = releaseRowTone(release);
  const rollingBack = pending.has(flowVerbKey({ kind: "roll-back", groupId, tag: release.tag }));
  // Only a state that is not calm says its word, after the title: Live, Releasing, Didn't go
  // live, Deploy failed, Refused. A failure with a live release after it is history: no pill, its
  // words quiet.
  const pill = live ? (
    <Badge tone="success">{release.word}</Badge>
  ) : releasing === release.tag && tone === "ok" ? (
    <Badge tone="info">{RELEASING_WORD}</Badge>
  ) : tone === "ok" ? null : releaseFailureIsOver(release, every) ? (
    <span
      className="shrink-0 text-caption whitespace-nowrap text-muted-foreground"
      data-zerops-surface="release-over"
    >
      {DIDNT_GO_LIVE_QUIET}
    </span>
  ) : (
    <Badge tone={STATUS_BADGE_TONE[tone]}>
      {notDeployed?.has(release.tag) === true ? RELEASE_DIDNT_GO_LIVE : release.word}
    </Badge>
  );
  const expandable =
    carried !== undefined &&
    (carried.onExpandedChange !== undefined || moved.length > 0 || what?.state === "failed");
  const expansion =
    !open || carried === undefined ? undefined : (
      <div
        className="col-span-full flex min-w-0 flex-col gap-1 ps-10 pe-3.5 pt-1 pb-3"
        data-zerops-surface="release-carried"
      >
        {what?.state === "failed" ? (
          <ZeropsReadFailure action="Compare again" reason={what.reason} again={what.again} />
        ) : what?.state === "reading" ? (
          <p className="text-sm text-muted-foreground">Reading commit messages…</p>
        ) : moved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commits.</p>
        ) : (
          moved.map((read) => (
            <ReleaseService
              key={read.repository}
              named={named}
              service={read.services[0] ?? read.repository}
            >
              <ZeropsHistoryView
                history={{ kind: "read", commits: read.commits, total: read.total }}
                names={carried.names}
                onOpenChange={
                  carried.onOpenChange === undefined
                    ? undefined
                    : (change, from) => {
                        carried.onOpenChange?.(read.repository, change, from);
                      }
                }
                request={{ appId: groupId, repo: read.repository, deployed: EMPTY_DEPLOYED }}
                tags={EMPTY_RELEASES}
              />
            </ReleaseService>
          ))
        )}
      </div>
    );
  const toggle = () => {
    carried?.onExpandedChange?.(release.tag, !open);
    setOpen(!open);
  };
  return (
    <li
      className={cn(
        "group/release col-span-full grid min-w-0 grid-cols-subgrid rounded-lg border",
        // What is live is found without reading a pill: the one row with a surface at rest.
        live ? "border-status-ok/25 bg-status-ok-surface/50" : "border-transparent",
        open && !live && "bg-accent/40",
      )}
      data-zerops-environment-row="true"
      data-zerops-release={release.tag}
      data-zerops-release-live={live || undefined}
    >
      <div
        className={cn(
          RELEASE_ROW_CLASS,
          // Only a row with something to press answers the pointer.
          !live && (expandable || release.rollBack) && "group-hover/release:bg-accent/40",
        )}
      >
        {expandable ? (
          // The whole row opens it in place (`after`); its way back stands over the row's end.
          <button
            aria-expanded={open}
            aria-label={releaseCarriedToggleLabel(release.tag, open)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground group-hover/release:text-foreground after:absolute after:inset-0 after:rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            onClick={toggle}
            type="button"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="size-5 shrink-0" />
        )}
        <span
          className={cn(
            "pe-1 font-mono text-sm font-medium whitespace-nowrap tabular-nums",
            live ? "text-status-ok-text" : "text-foreground",
          )}
          data-zerops-surface="environment-name"
        >
          {release.tag}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          {/* The title, then its state on the same line; too narrow for both, the state under it. */}
          <span className="flex min-w-0 flex-col items-start gap-1 @lg/releases:flex-row @lg/releases:items-center @lg/releases:gap-3.5">
            <span
              className={cn(
                "max-w-full min-w-0 truncate text-sm",
                // The same changes again are no news: said, and quiet.
                titled?.kind === "again" ? "text-muted-foreground" : "text-foreground",
              )}
              data-zerops-surface="release-description"
            >
              {description.primary}
            </span>
            {pill}
          </span>
          {description.secondary === undefined || description.secondary === "" ? null : (
            <span
              className="min-w-0 truncate text-caption text-muted-foreground"
              data-zerops-surface="release-byline"
            >
              {description.secondary}
            </span>
          )}
        </span>
        <span
          className={cn(
            "text-end text-caption whitespace-nowrap text-muted-foreground/80 tabular-nums",
            release.rollBack &&
              "transition-opacity duration-150 group-focus-within/release:opacity-0 group-hover/release:opacity-0 motion-reduce:transition-none",
            rollingBack && "opacity-0",
          )}
        >
          {formatRelativeTimeLabel(release.taggedAt, now)}
        </span>
        {release.rollBack ? (
          // The way back takes the age's place where the row is pointed at or focused, and stays
          // while it runs. It stands over the row's end on the row's own ground, so a long title
          // ends before it; reached by Tab like any button.
          <span
            className={cn(
              "absolute inset-y-0 end-0 flex items-center rounded-e-lg bg-card transition-opacity duration-150 motion-reduce:transition-none",
              !rollingBack &&
                "pointer-events-none opacity-0 group-focus-within/release:pointer-events-auto group-focus-within/release:opacity-100 group-hover/release:pointer-events-auto group-hover/release:opacity-100",
            )}
            data-zerops-surface="release-roll-back"
          >
            <span className="flex h-full items-center rounded-e-lg bg-accent/40 ps-3 pe-3.5">
              <Button
                disabled={rollingBack}
                onClick={(event) => {
                  onRollBack(release.tag, event.currentTarget);
                }}
                size="sm"
                variant="secondary"
              >
                {rollingBack ? flowVerbLabel("roll-back", true) : `Roll back to ${release.tag}`}
              </Button>
            </span>
          </span>
        ) : null}
      </div>
      {expansion}
    </li>
  );
}

/**
 * The rows' shared grid: the chevron, the version in a column as wide as the longest of them, what
 * it brought with its state after it and its count under it, then when.
 */
const RELEASE_LIST_CLASS =
  "m-0 grid min-w-0 list-none grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 p-0";

/** A release row on the list's columns; its way back stands over its end (`relative`). */
const RELEASE_ROW_CLASS =
  "relative col-span-full grid min-w-0 grid-cols-subgrid items-center rounded-lg px-3.5 py-2";

/** A release on its way to production, as its row says it; the header's pill names the version. */
const RELEASING_WORD = "Releasing";

/**
 * A release's description with its title as every change row says it: no trailing `(#n)`, before
 * the count of the rest (`releaseDescription`'s ", +2 more") where there is one.
 */
function described<D extends { readonly primary: string }>(description: D | undefined) {
  if (description === undefined) return undefined;
  const more = /, \+\d+\+? more$/u.exec(description.primary)?.[0] ?? "";
  const title = description.primary.slice(0, description.primary.length - more.length);
  return { ...description, primary: `${changeTitle(title)}${more}` };
}

/** One repository's block in a release's expansion, under its hostname where there are several. */
function ReleaseService({
  service,
  named,
  children,
}: {
  readonly service: string;
  /** Whether the expansion holds more than this one, so its hostname is said. */
  readonly named: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {named ? <span className="text-xs text-muted-foreground">{service}</span> : null}
      {children}
    </div>
  );
}

/** Historical rows keep HQ's frozen entries and the environment's recorded push outcomes. */
export function GitReleaseRows({
  releases,
  delivery,
  jobs,
}: {
  readonly releases: ReadonlyArray<Pick<FlowReleaseRow, "tag" | "entries" | "verdict">>;
  readonly delivery: GitDelivery | undefined;
  readonly jobs: GitDeliveryEnvironment["jobs"];
}) {
  return (
    <>
      {releases.map((release) => {
        const history = gitReleaseHistory(release, delivery, jobs);
        return (
          <ZeropsEnvironmentRow
            key={release.tag}
            name={release.tag}
            tag="release"
            status={
              <Badge dot tone={STATUS_BADGE_TONE[history.attention ? "attention" : "off"]}>
                {history.word}
              </Badge>
            }
            summary={
              <span className="whitespace-normal">
                {[
                  release.entries
                    .map((entry) => `${entry.service} ${entry.commit.slice(0, 7)}`)
                    .join(" · "),
                  history.reason,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            }
          />
        );
      })}
    </>
  );
}
