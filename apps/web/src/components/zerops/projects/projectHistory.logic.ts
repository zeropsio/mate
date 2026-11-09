/** Recorded release membership supplies overview history; release states use the existing domain rows. */
import type {
  CanonicalEnvironmentRow as EnvironmentRow,
  FlowPullRequest,
  FlowReleaseRow,
  ReleaseFailure,
} from "@t3tools/client-runtime/zerops";

/** How many releases History shows before *Show all*. */
export const HISTORY_RELEASES = 5;

/** A release as History reads it: newest first, as the flow lists them. */
export type HistoryReleaseInput = Pick<FlowReleaseRow, "tag" | "taggedAt"> &
  Partial<Pick<FlowReleaseRow, "verdict" | "rollbackOf" | "standing" | "history" | "by">>;

/** A change a release recorded putting live: its recorded title, and its row where it is read. */
export interface HistoryChange {
  readonly repository: string;
  readonly number: number;
  /** Its title as the release recorded it, without GitHub's trailing `(#n)`. */
  readonly title: string;
  /** The change as the project's merged changes read it: its Mate and when it landed. */
  readonly pull: FlowPullRequest | undefined;
}

export interface HistoryRelease {
  readonly tag: string;
  readonly taggedAt: string;
  /**
   * Live where production runs it; how it did not go through (`releaseFailure`); Rolled back where
   * production went back past it.
   */
  readonly state: "live" | ReleaseFailure["kind"] | "rolled-back" | undefined;
  /** HQ's words for how it did not go through, in one line (`releaseFailureWords`). */
  readonly failure: string | undefined;
  /** The release a roll back went back to: it put no change of its own live. */
  readonly backTo: string | undefined;
  /** The Mates' changes it put live, newest first. */
  readonly changes: ReadonlyArray<FlowPullRequest>;
  /** Who released it: their Zerops user id, as HQ records it. */
  readonly by?: string | undefined;
  /** Recorded numeric facts; undefined on releases predating recording. */
  readonly outsideCommitCount?: number | undefined;
  readonly commitCount?: number | undefined;
  /** Every change it recorded putting live, as recorded; undefined on releases predating recording. */
  readonly recorded?: ReadonlyArray<HistoryChange> | undefined;
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

export function historyReleases<R extends HistoryReleaseInput>(input: {
  /** Newest first, as the flow lists them. */
  readonly releases: ReadonlyArray<R>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** How a release did not go through (`releaseFailure`); none where it did, or is on its way. */
  readonly failureOf?: ((release: R) => ReleaseFailure | undefined) | undefined;
}): ReadonlyArray<HistoryRelease> {
  // A refused release deployed nothing: it is listed for its refusal, never rolled back past.
  const deployed = input.releases.filter((release) => release.verdict !== "refused");
  const newestFirst = (left: string | undefined, right: string | undefined) =>
    time(right ?? "") - time(left ?? "");
  const changes = input.merged
    .filter((change) => change.kind === "code")
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt));
  return input.releases.map((release) => {
    const failure = input.failureOf?.(release);
    return {
      tag: release.tag,
      taggedAt: release.taggedAt,
      state:
        release.standing === "live"
          ? "live"
          : failure !== undefined
            ? failure.kind
            : release.verdict !== "refused" && rolledBack(release, deployed)
              ? "rolled-back"
              : undefined,
      failure: failure === undefined ? undefined : releaseFailureWords(failure),
      backTo: release.rollbackOf ?? undefined,
      changes: changes.filter((change) =>
        release.history?.changes.some(
          (recorded) => recorded.repo === change.repository && recorded.number === change.number,
        ),
      ),
      by: release.by,
      recorded: release.history?.changes.map((recorded) => ({
        repository: recorded.repo,
        number: recorded.number,
        title: changeTitle(recorded.title),
        pull: changes.find(
          (change) => change.repository === recorded.repo && change.number === recorded.number,
        ),
      })),
      outsideCommitCount: release.history?.outsideCommitCount,
      commitCount: release.history?.commitCount,
    };
  });
}

/** A failure's one line: HQ's words, or — a stall HQ could not tell the end of — that it is unknown. */
function releaseFailureWords(failure: ReleaseFailure): string | undefined {
  if (failure.error !== undefined) return failure.error;
  return failure.kind === "stalled" ? "Deploy status unknown — check it in Zerops" : undefined;
}

/** A release's second line: how many changes it put live, or where it went back to. */
export function releaseLine(release: HistoryRelease): string {
  if (release.backTo !== undefined) return `Back to ${release.backTo}`;
  if (release.recorded === undefined && release.changes.length === 0)
    return "Which changes it carried was not recorded";
  const count = release.recorded?.length ?? release.changes.length;
  return count === 0 ? "No changes" : count === 1 ? "1 change" : `${String(count)} changes`;
}

/** A release's state, in the page's words. */
export const RELEASE_STATE_WORDS = {
  live: "Live",
  "rolled-back": "Rolled back",
  "deploy-failed": "Deploy failed",
  refused: "Refused",
  stalled: "Not live",
} as const;

/**
 * An opened release's header line: "6 changes · 6 commits · released by Dana" — or where it went
 * back to, or that its changes were not recorded.
 */
export function releaseFacts(release: HistoryRelease, byName: string | undefined): string {
  return [
    releaseLine(release),
    ...(release.commitCount === undefined
      ? []
      : [`${String(release.commitCount)} ${release.commitCount === 1 ? "commit" : "commits"}`]),
    ...(byName === undefined ? [] : [`released by ${byName}`]),
  ].join(" · ");
}

/**
 * A closed release's line: its first change's title and how many more ("· +3"), or — with no change
 * to name — what its header would say.
 */
export function releaseGist(release: HistoryRelease): {
  readonly text: string;
  readonly more: number;
} {
  const titles = release.recorded?.map((change) => change.title) ?? [];
  const first = titles[0];
  if (first === undefined) return { text: releaseLine(release), more: 0 };
  return { text: first, more: titles.length - 1 };
}

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
