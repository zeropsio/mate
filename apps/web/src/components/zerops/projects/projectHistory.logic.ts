/** Recorded release membership supplies overview history; release states use the existing domain rows. */
import type {
  CanonicalEnvironmentRow as EnvironmentRow,
  FlowPullRequest,
  FlowReleaseRow,
} from "@t3tools/client-runtime/zerops";

/** How many releases History shows before *Show all*. */
export const HISTORY_RELEASES = 5;

/** A release as History reads it: newest first, as the flow lists them. */
export type HistoryReleaseInput = Pick<FlowReleaseRow, "tag" | "taggedAt"> &
  Partial<Pick<FlowReleaseRow, "verdict" | "rollbackOf" | "standing" | "history">>;

export interface HistoryRelease {
  readonly tag: string;
  readonly taggedAt: string;
  /** Live where production runs it; Rolled back where production went back past it. */
  readonly state: "live" | "rolled-back" | "deploy-failed" | undefined;
  /** The release a roll back went back to: it put no change of its own live. */
  readonly backTo: string | undefined;
  /** The Mates' changes it put live, newest first. */
  readonly changes: ReadonlyArray<FlowPullRequest>;
  /** Recorded numeric facts; undefined on releases predating recording. */
  readonly outsideCommitCount?: number | undefined;
  readonly commitCount?: number | undefined;
  readonly changeTitles?: ReadonlyArray<string> | undefined;
  readonly ranges?: NonNullable<FlowReleaseRow["history"]>["ranges"] | undefined;
}

const time = (at: string) => Date.parse(at);

/** Whether a release put changes live: HQ approved it, and it is no roll back to an earlier one. */
function shipsChanges(release: HistoryReleaseInput): boolean {
  return release.verdict !== "refused" && release.rollbackOf == null;
}

/**
 * The release that put live what landed at `landedAt`: the oldest release made after it that put
 * changes live. Releases newest first. One rule for the card's *In v1.0.4* and History's rows.
 */
export function releaseOfLanding<R extends HistoryReleaseInput>(
  landedAt: string | undefined,
  releases: ReadonlyArray<R>,
): R | undefined {
  if (landedAt === undefined) return undefined;
  const landed = time(landedAt);
  return releases.findLast((release) => shipsChanges(release) && time(release.taggedAt) >= landed);
}

/** GitHub's `(#n)` a squash adds, every one stacked: "Add a chip (#9) (#11)" → "Add a chip". */
export function changeTitle(subject: string): string {
  const title = subject.replace(/(?:\s*\(#\d+\))+\s*$/u, "");
  return title.length === 0 ? subject : title;
}

/** Whether production went back past `release`: a newer roll back to a release older than it. */
function rolledBack(release: HistoryReleaseInput, releases: ReadonlyArray<HistoryReleaseInput>) {
  const at = time(release.taggedAt);
  return releases.some((other) => {
    if (other.rollbackOf == null || other.tag === release.tag || time(other.taggedAt) <= at)
      return false;
    const target = releases.find((candidate) => candidate.tag === other.rollbackOf);
    return target === undefined || time(target.taggedAt) < at;
  });
}

export function historyReleases(input: {
  /** Newest first, as the flow lists them. */
  readonly releases: ReadonlyArray<HistoryReleaseInput>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
}): ReadonlyArray<HistoryRelease> {
  const releases = input.releases.filter((release) => release.verdict !== "refused");
  const newestFirst = (left: string | undefined, right: string | undefined) =>
    time(right ?? "") - time(left ?? "");
  const changes = input.merged
    .filter((change) => change.kind === "code")
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt));
  return releases.map((release) => ({
    tag: release.tag,
    taggedAt: release.taggedAt,
    state:
      release.standing === "live"
        ? "live"
        : release.standing === "deploy-failed"
          ? "deploy-failed"
          : rolledBack(release, releases)
            ? "rolled-back"
            : undefined,
    backTo: release.rollbackOf ?? undefined,
    changes: changes.filter((change) =>
      release.history?.changes.some(
        (recorded) => recorded.repo === change.repository && recorded.number === change.number,
      ),
    ),
    changeTitles: release.history?.changes.map((change) => change.title),
    outsideCommitCount: release.history?.outsideCommitCount,
    commitCount: release.history?.commitCount,
    ranges: release.history?.ranges,
  }));
}

/** A release's second line: how many changes it put live, or where it went back to. */
export function releaseLine(release: HistoryRelease): string {
  if (release.backTo !== undefined) return `Back to ${release.backTo}`;
  if (release.changeTitles === undefined && release.changes.length === 0)
    return "Membership not recorded";
  const count = release.changeTitles?.length ?? release.changes.length;
  return count === 0 ? "No changes" : count === 1 ? "1 change" : `${String(count)} changes`;
}

/** A release's state, in the page's words. */
export const RELEASE_STATE_WORDS = {
  live: "Live",
  "rolled-back": "Rolled back",
  "deploy-failed": "Deploy failed",
} as const;

/** The quiet line of a release's commits no Mate's change landed. */
export function outsideLine(count: number): string {
  return `${String(count)} ${count === 1 ? "commit" : "commits"} outside Mate`;
}

/** The releases drawn: the latest five, or every one; `all` counts them where there are more. */
export function shownReleases(
  releases: ReadonlyArray<HistoryRelease>,
  all: boolean,
): { readonly rows: ReadonlyArray<HistoryRelease>; readonly all: number | undefined } {
  const more = releases.length > HISTORY_RELEASES ? releases.length : undefined;
  return { rows: all ? releases : releases.slice(0, HISTORY_RELEASES), all: more };
}

/**
 * The repository a project's history is read from: the one its environments are built from. Never
 * guessed from a hostname — that address 404s.
 */
export function groupRepository(environments: ReadonlyArray<EnvironmentRow>): string | undefined {
  for (const environment of environments) {
    if (environment.versionRepository !== undefined) return environment.versionRepository;
  }
  return undefined;
}
