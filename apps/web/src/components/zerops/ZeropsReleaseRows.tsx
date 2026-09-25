import {
  flowVerbKey,
  flowVerbLabel,
  releaseCarriedToggleLabel,
  releaseDescription,
  type FlowReleaseRow,
  type ReleaseServiceChange,
} from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useZeropsCommitDetailReader } from "~/zerops/useZeropsCommitDetail";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";
import { useNowMs } from "~/zerops/useNowMs";

import { StatusDot } from "./primitives";
import { ZeropsEnvironmentRow, ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { ZeropsHistoryView, type HistoryNames } from "./ZeropsHistoryView";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import { releaseRowTone } from "./ZeropsProjectRow.logic";

/** What the rows need to say what each release carried — the caller's reads, folded. */
export interface ZeropsReleasesCarried {
  /** `tag → what it carried`, from `releasesCarried` over the whole release list. */
  readonly changes: ReadonlyMap<string, ReadonlyArray<ReleaseServiceChange>>;
  /** `repository → its read`. */
  readonly reads: ReadonlyMap<string, ZeropsCommitsState>;
  /** `hostname → repository`. */
  readonly repositoryOf: ReadonlyMap<string, string>;
  readonly forge: { readonly giteaOrigin: string | undefined; readonly owner: string | undefined };
  readonly names: HistoryNames;
}

interface ReleaseRowsProps {
  readonly groupId: string;
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /** The verbs under way (`flowVerbKey`): a release rolling back holds its verb. */
  readonly pending: ReadonlySet<string>;
  readonly onRollBack: (tag: string) => void;
}

const EMPTY_DEPLOYED: ReadonlyMap<string, string> = new Map();
const EMPTY_RELEASES: ReadonlyMap<string, string> = new Map();

/**
 * A project's releases, newest first, each with its word and, on an earlier
 * approved one, the way back to it — the same rows on the projects page and on
 * a production's own page. The rows only: the list around them is the caller's.
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
  onRollBack: (tag: string) => void,
) {
  const tone = releaseRowTone(release);
  const rollingBack = pending.has(flowVerbKey({ kind: "roll-back", groupId, tag: release.tag }));
  return {
    action: release.rollBack ? (
      <ZeropsMateVerb
        disabled={rollingBack}
        label={flowVerbLabel("roll-back", rollingBack)}
        onClick={() => {
          onRollBack(release.tag);
        }}
      />
    ) : undefined,
    name: release.tag,
    status:
      tone === undefined || release.word === undefined ? undefined : (
        <StatusDot label={release.word} sentence tone={tone} />
      ),
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
        />
      ))}
    </>
  );
}

function CarriedReleaseRow({
  release,
  groupId,
  pending,
  onRollBack,
  carried,
  now,
}: {
  readonly release: FlowReleaseRow;
  readonly groupId: string;
  readonly pending: ReadonlySet<string>;
  readonly onRollBack: (tag: string) => void;
  readonly carried: ZeropsReleasesCarried;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const changes = carried.changes.get(release.tag) ?? [];
  // This release's repositories whose commits are not read, each named by its
  // first service: their notes stand beside the commits that were.
  const serviceOf = new Map<string, string>();
  for (const entry of release.entries) {
    const repository = carried.repositoryOf.get(entry.service);
    if (repository !== undefined && !serviceOf.has(repository)) {
      serviceOf.set(repository, entry.service);
    }
  }
  const waiting = [...serviceOf].flatMap(([repository, service]) => {
    const state = carried.reads.get(repository);
    return state === undefined || state.kind === "read" ? [] : [{ service, repository, state }];
  });
  const named = changes.length + waiting.length > 1;
  // A refused release's line is the broker's reason, and the reason stays.
  const description =
    changes.length === 0 || (release.verdict === "refused" && release.detail !== undefined)
      ? undefined
      : releaseDescription(changes, release.line, now, carried.names);
  const parts = releaseRowParts(release, groupId, pending, onRollBack);
  const expansion = open ? (
    <div className="flex flex-col gap-1 pl-7.5" data-zerops-surface="release-carried">
      {changes.map((change) => (
        <ReleaseServiceCommits
          change={change}
          forge={carried.forge}
          key={change.repository}
          named={named}
          names={carried.names}
        />
      ))}
      {waiting.map((unread) => (
        <ReleaseService key={unread.repository} named={named} service={unread.service}>
          <ZeropsHistoryView
            commits={unread.state}
            names={carried.names}
            request={{ repo: unread.repository, deployed: EMPTY_DEPLOYED }}
          />
        </ReleaseService>
      ))}
    </div>
  ) : undefined;
  const leading =
    changes.length > 0 || waiting.length > 0 ? (
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

/** One repository's commits in a release, each opening onto what it changed. */
function ReleaseServiceCommits({
  change,
  forge,
  named,
  names,
}: {
  readonly change: ReleaseServiceChange;
  readonly forge: ZeropsReleasesCarried["forge"];
  /** Whether the expansion holds more than this one, so its hostname is said. */
  readonly named: boolean;
  readonly names: HistoryNames;
}) {
  const readDetail = useZeropsCommitDetailReader({ ...forge, repo: change.repository });
  return (
    <ReleaseService named={named} service={change.service}>
      <ZeropsHistoryView
        commits={{ kind: "read", commits: change.commits, releases: EMPTY_RELEASES }}
        names={names}
        readDetail={readDetail}
        request={{ repo: change.repository, deployed: EMPTY_DEPLOYED }}
      />
    </ReleaseService>
  );
}
