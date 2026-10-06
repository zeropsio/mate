import {
  flowVerbKey,
  flowVerbLabel,
  releaseCarriedToggleLabel,
  releaseDescription,
  rolledBackDescription,
  rolledBackTo,
  type FlowReleaseRow,
  type Moved,
} from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ComparedCommits } from "~/zerops/useReleaseComparisons";
import { ZeropsReadFailure } from "./ZeropsReadFailure";
import { cn } from "~/lib/utils";
import { useNowMs } from "~/zerops/useNowMs";

import { StatusDot } from "./primitives";
import { ZeropsEnvironmentRow, ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { ZeropsHistoryView, type HistoryChange, type HistoryNames } from "./ZeropsHistoryView";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import { releaseRowTone } from "./ZeropsProjectRow.logic";

/** What the rows need to say what each release carried — HQ's comparisons, folded. */
export interface ZeropsReleasesCarried {
  /** `tag → what it carried`, as HQ compared it (`movedCommits` over `carriedReads`). */
  readonly carried: ReadonlyMap<string, ComparedCommits>;
  readonly names: HistoryNames;
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
}

const EMPTY_DEPLOYED: ReadonlyMap<string, string> = new Map();
const EMPTY_RELEASES: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

/**
 * A project's releases, newest first, each with its word and, on an earlier
 * approved one, the way back to it — the same rows on the projects page and on
 * a production's own page — whose review asks before anything moves. The rows
 * only: the list around them is the caller's.
 *
 * Given `carried`, a row also says what its release carried — the commit it
 * leads with, who wrote it and when — and opens onto those commits. Without
 * it, or before the commits are read, a row is its tag and its shas.
 */
export function ZeropsReleaseRows({
  carried,
  ...props
}: ReleaseRowsProps & { readonly carried?: ZeropsReleasesCarried }) {
  if (carried !== undefined) return <CarriedReleaseRows {...props} carried={carried} />;
  const { groupId, releases, pending, onRollBack } = props;
  return (
    <>
      {releases.map((release) => (
        <ZeropsEnvironmentRow
          {...releaseRowParts(release, groupId, pending, onRollBack)}
          key={`release-${groupId}-${release.tag}`}
          summary={release.line}
        />
      ))}
    </>
  );
}

/** What every release row has, whether or not it says what it carried. */
function releaseRowParts(
  release: FlowReleaseRow,
  groupId: string,
  pending: ReadonlySet<string>,
  onRollBack: (tag: string, from: HTMLElement) => void,
) {
  const tone = releaseRowTone(release);
  const rollingBack = pending.has(flowVerbKey({ kind: "roll-back", groupId, tag: release.tag }));
  return {
    action: release.rollBack ? (
      <ZeropsMateVerb
        disabled={rollingBack}
        label={flowVerbLabel("roll-back", rollingBack)}
        onClick={(event) => {
          onRollBack(release.tag, event.currentTarget);
        }}
      />
    ) : undefined,
    name: release.tag,
    status: <StatusDot label={release.word} sentence tone={tone} />,
    tag: "release",
  };
}

function CarriedReleaseRows({
  groupId,
  releases,
  pending,
  onRollBack,
  carried,
}: ReleaseRowsProps & { readonly carried: ZeropsReleasesCarried }) {
  // One clock for every row, so they age together.
  const now = useNowMs();
  return (
    <>
      {releases.map((release) => (
        <CarriedReleaseRow
          carried={carried}
          groupId={groupId}
          key={`release-${groupId}-${release.tag}`}
          now={now}
          onRollBack={onRollBack}
          pending={pending}
          release={release}
          releases={releases}
        />
      ))}
    </>
  );
}

function CarriedReleaseRow({
  release,
  releases,
  groupId,
  pending,
  onRollBack,
  carried,
  now,
}: {
  readonly release: FlowReleaseRow;
  /** Every release of the project: what a roll back went back to is among them. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  readonly groupId: string;
  readonly pending: ReadonlySet<string>;
  readonly onRollBack: (tag: string, from: HTMLElement) => void;
  readonly carried: ZeropsReleasesCarried;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const what = carried.carried.get(release.tag);
  const moved: ReadonlyArray<Moved> = what?.state === "known" ? what.moved : [];
  const named = moved.length > 1;
  // A refused release's line is HQ's reason, and the reason stays. A roll back carried nothing
  // new: it says what it went back to.
  const back = rolledBackTo(release, releases);
  const description =
    release.verdict === "refused" && release.detail !== undefined
      ? undefined
      : back !== undefined
        ? rolledBackDescription(back, release.line)
        : releaseDescription(moved, release.line, now, carried.names);
  const parts = releaseRowParts(release, groupId, pending, onRollBack);
  const expansion = open ? (
    <div className="flex flex-col gap-1 pl-7.5" data-zerops-surface="release-carried">
      {what?.state === "failed" ? (
        <ZeropsReadFailure action="Compare again" reason={what.reason} again={what.again} />
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
              request={{ repo: read.repository, deployed: EMPTY_DEPLOYED }}
              tags={EMPTY_RELEASES}
            />
          </ReleaseService>
        ))
      )}
    </div>
  ) : undefined;
  const leading =
    moved.length > 0 || what?.state === "failed" ? (
      <button
        aria-expanded={open}
        aria-label={releaseCarriedToggleLabel(release.tag, open)}
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
    ) : (
      <span aria-hidden="true" className="size-5 shrink-0" />
    );
  return (
    <li className={CARRIED_RELEASE_ROW_CLASS} data-zerops-environment-row="true">
      <span className="row-start-1 flex min-w-0 items-center gap-2.5">
        {leading}
        <span
          className="min-w-0 truncate text-sm text-foreground"
          data-zerops-surface="environment-name"
        >
          {parts.name}
        </span>
        <ZeropsRoleTag label={parts.tag} />
      </span>
      {description === undefined ? (
        <span
          className="col-span-full min-w-0 truncate pl-7.5 text-xs text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:pl-0"
          data-zerops-surface="environment-summary"
        >
          {release.line}
        </span>
      ) : (
        <>
          <span
            className="col-span-full min-w-0 truncate pl-7.5 text-sm text-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:pl-0"
            data-zerops-surface="release-description"
          >
            {description.primary}
          </span>
          <span
            className="col-span-full min-w-0 truncate pl-7.5 text-xs text-muted-foreground sm:col-span-2 sm:col-start-1 sm:row-start-2"
            data-zerops-surface="release-byline"
          >
            {description.secondary}
          </span>
        </>
      )}
      {/* The status word's hand is the row's, as on an environment row: a
          `sentence` StatusDot has no size of its own. */}
      <span className="col-start-2 row-start-1 flex min-w-0 justify-start text-xs text-muted-foreground sm:col-start-3 sm:row-span-2">
        {parts.status}
      </span>
      {/* On a phone the verb takes its own line under the byline, where the
          tag keeps its room; none, the cell takes no line. */}
      <span className="col-span-full flex justify-start pl-7.5 empty:hidden sm:col-span-1 sm:col-start-4 sm:row-span-2 sm:row-start-1 sm:justify-end sm:pl-0">
        {parts.action}
      </span>
      {expansion === undefined ? null : (
        <div className="col-span-full min-w-0 pb-2">{expansion}</div>
      )}
    </li>
  );
}

/**
 * A release row on a page that reads what releases carried: the chevron, the
 * tag and its pill, in a column of one width where a long tag truncates; the
 * description in the flexible middle, its byline under
 * the tag — or, where there is no description, the release's line alone in
 * that middle; then the status and the verb, each in a column of one width on
 * every row, so the middles, the dots and the verbs run down the list — the
 * Live row's dot is where the others are, the verb's column empty. On a phone
 * the middle, its byline and the verb drop under the tag.
 */
const CARRIED_RELEASE_ROW_CLASS =
  "grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)_6.5rem_7rem]";

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
