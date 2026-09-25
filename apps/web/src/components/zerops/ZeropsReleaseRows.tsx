import {
  flowVerbKey,
  flowVerbLabel,
  releaseCarriedToggleLabel,
  releaseDescription,
  type FlowReleaseRow,
  type ReleaseServiceChange,
} from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useZeropsCommitDetailReader } from "~/zerops/useZeropsCommitDetail";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";
import { useNowMs } from "~/zerops/useNowMs";

import { StatusDot } from "./primitives";
import { ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
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
  // The first of this release's repositories whose commits are not read: its
  // note is what the row opens onto until they are.
  const waiting = [
    ...new Set(release.entries.map((entry) => carried.repositoryOf.get(entry.service))),
  ].flatMap((repository) => {
    const state = repository === undefined ? undefined : carried.reads.get(repository);
    return repository === undefined || state === undefined || state.kind === "read"
      ? []
      : [{ repository, state }];
  })[0];
  // A refused release's line is the broker's reason, and the reason stays.
  const description =
    changes.length === 0 || (release.verdict === "refused" && release.detail !== undefined)
      ? undefined
      : releaseDescription(changes, release.line, now, carried.names);
  return (
    <ZeropsEnvironmentRow
      {...releaseRowParts(release, groupId, pending, onRollBack)}
      expansion={
        open ? (
          <div className="flex flex-col gap-1 pl-7.5" data-zerops-surface="release-carried">
            {changes.length > 0 ? (
              changes.map((change) => (
                <ReleaseServiceCommits
                  change={change}
                  forge={carried.forge}
                  key={change.repository}
                  named={changes.length > 1}
                  names={carried.names}
                />
              ))
            ) : waiting === undefined ? null : (
              <ZeropsHistoryView
                commits={waiting.state}
                names={carried.names}
                request={{ repo: waiting.repository, deployed: EMPTY_DEPLOYED }}
              />
            )}
          </div>
        ) : undefined
      }
      leading={
        changes.length > 0 || waiting !== undefined ? (
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
        )
      }
      summary={description?.primary ?? release.line}
      summaryDetail={description?.secondary}
    />
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
  /** Whether the release moved more than this one, so its hostname is said. */
  readonly named: boolean;
  readonly names: HistoryNames;
}) {
  const readDetail = useZeropsCommitDetailReader({ ...forge, repo: change.repository });
  return (
    <div className="flex min-w-0 flex-col">
      {named ? <span className="text-xs text-muted-foreground">{change.service}</span> : null}
      <ZeropsHistoryView
        commits={{ kind: "read", commits: change.commits, releases: EMPTY_RELEASES }}
        names={names}
        readDetail={readDetail}
        request={{ repo: change.repository, deployed: EMPTY_DEPLOYED }}
      />
    </div>
  );
}
