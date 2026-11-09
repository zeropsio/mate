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
import { gitReleaseHistory } from "./GitHistory.logic";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

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
  /** The verbs under way (`flowVerbKey`): a release rolling back holds its verb. */
  readonly pending: ReadonlySet<string>;
  /**
   * Opens the roll back's review from the verb pressed, naming the version it goes back to:
   * nothing rolls back from a row (pass 16, R1).
   */
  readonly onRollBack: (tag: string, from: HTMLElement) => void;
  /** Who made the live release, by name: its row says so. */
  readonly liveBy?: string | undefined;
}

const EMPTY_DEPLOYED: ReadonlyMap<string, string> = new Map();
const EMPTY_RELEASES: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

/**
 * A production's releases, newest first, as its page lists them: one row each — its version, the
 * live one's pill, the first change it brought with how many in all, and when. A calm release says
 * no word; one that is not calm says its own (Deploy failed, Refused). The way back to an earlier
 * one shows on the row's hover or focus, and its review asks before anything moves. The rows only:
 * the card around them is the caller's.
 *
 * Given `carried`, a row also opens onto the commits its release carried. Without it, or before
 * the commits are read, a row is its tag and its shas.
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
  groupId,
  pending,
  onRollBack,
  carried,
  liveBy,
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
  const description: { readonly primary: string; readonly secondary: string | undefined } =
    release.verdict === "refused" && release.detail !== undefined
      ? { primary: release.detail, secondary: release.line }
      : back !== undefined
        ? rolledBackDescription(back, release.line)
        : release.history !== undefined
          ? {
              primary: release.history.changes[0]?.title ?? "No changes",
              secondary: [
                release.history.changes.length === 0
                  ? plural(release.history.commitCount, "commit", "commits")
                  : plural(release.history.changes.length, "change", "changes"),
                by,
              ]
                .filter((part) => part !== undefined)
                .join(" · "),
            }
          : carried?.onExpandedChange === undefined
            ? (releaseDescription(moved, release.line, now, carried?.names) ?? {
                primary: release.line,
                secondary: by,
              })
            : { primary: release.line, secondary: "Which changes it carried was not recorded" };
  const tone = releaseRowTone(release);
  const rollingBack = pending.has(flowVerbKey({ kind: "roll-back", groupId, tag: release.tag }));
  // Only a state that is not calm says its word: Live, Deploy failed, Refused.
  const pill = live ? (
    <Badge tone="success">{release.word}</Badge>
  ) : tone === "ok" ? null : (
    <Badge tone={STATUS_BADGE_TONE[tone]}>{release.word}</Badge>
  );
  const expandable =
    carried !== undefined &&
    (carried.onExpandedChange !== undefined || moved.length > 0 || what?.state === "failed");
  const expansion =
    !open || carried === undefined ? undefined : (
      <div className="flex flex-col gap-1 ps-10 pe-3.5 pb-3" data-zerops-surface="release-carried">
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
      className={cn("group/release min-w-0 rounded-lg", open && "bg-accent/40")}
      data-zerops-environment-row="true"
      data-zerops-release={release.tag}
    >
      <div className={RELEASE_ROW_CLASS}>
        {expandable ? (
          <button
            aria-expanded={open}
            aria-label={releaseCarriedToggleLabel(release.tag, open)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
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
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate font-mono text-sm font-medium tabular-nums",
              live ? "text-foreground" : "text-foreground/80",
            )}
            data-zerops-surface="environment-name"
          >
            {release.tag}
          </span>
          {pill}
        </span>
        <span className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-col gap-0.5 @lg/releases:col-span-1 @lg/releases:col-start-3 @lg/releases:row-start-1">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              live ? "text-foreground" : "text-foreground/80",
            )}
            data-zerops-surface="release-description"
          >
            {description.primary}
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
        <span className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-3 @lg/releases:col-start-4">
          {release.rollBack ? (
            // The way back shows where the row is pointed at or focused, and stays while it runs.
            <span
              className={cn(
                "flex transition-opacity duration-150 motion-reduce:transition-none",
                !rollingBack &&
                  "opacity-0 group-focus-within/release:opacity-100 group-hover/release:opacity-100 pointer-coarse:opacity-100",
              )}
            >
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
          ) : null}
          <span className="text-body whitespace-nowrap text-muted-foreground tabular-nums">
            {formatRelativeTimeLabel(release.taggedAt, now)}
          </span>
        </span>
      </div>
      {expansion}
    </li>
  );
}

/**
 * A release row: the chevron, the version with its pill in a column of one width, what it brought
 * in the flexible middle with its count under it, then the way back and when — so the versions,
 * the middles and the times run down the list. Narrow, the middle drops under the version.
 */
const RELEASE_ROW_CLASS =
  "grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3.5 py-3 group-hover/release:bg-accent/40 @lg/releases:grid-cols-[1.25rem_10.5rem_minmax(0,1fr)_auto]";

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
