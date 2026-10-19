/**
 * A project page's History: its releases, newest first, each with the changes it put live — the
 * page's Changes keeps only what is not released yet, so each change is said in one place (the
 * owner, 2026-10-19: the raw log of `main` "mixes stuff with what's at the bottom of the left
 * card"). A commit on `main` no change of a Mate's landed — a person's direct push — is said
 * inside its release, quietly; GitHub's merge commits and the commits a Mate's merged branch
 * brought belong to that change and are no line of their own.
 */
import type {
  CanonicalEnvironmentRow as EnvironmentRow,
  FlowPullRequest,
  FlowReleaseRow,
} from "@t3tools/client-runtime/zerops";
import type { CompareCommit } from "@t3tools/shared/hqChanges";

/** How many releases History shows before *Show all*. */
export const HISTORY_RELEASES = 5;

/** A release as History reads it: newest first, as the flow lists them. */
export type HistoryReleaseInput = Pick<FlowReleaseRow, "tag" | "taggedAt"> &
  Partial<Pick<FlowReleaseRow, "verdict" | "rollbackOf" | "standing">>;

type HistoryCommit = Pick<CompareCommit, "sha" | "subject" | "authorName" | "at" | "change">;

export interface HistoryRelease {
  readonly tag: string;
  readonly taggedAt: string;
  /** Live where production runs it; Rolled back where production went back past it. */
  readonly state: "live" | "rolled-back" | "deploy-failed" | undefined;
  /** The release a roll back went back to: it put no change of its own live. */
  readonly backTo: string | undefined;
  /** The Mates' changes it put live, newest first. */
  readonly changes: ReadonlyArray<FlowPullRequest>;
  /** The commits on `main` it carried that no change of a Mate's landed, newest first. */
  readonly outside: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
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

/** A merge commit GitHub or git wrote: the change it merged is the row, never the merge. */
function isMergeCommit(subject: string): boolean {
  return /^Merge (?:pull request #\d+ from |branch |remote-tracking branch )/u.test(subject);
}

/** A commit a Mate's bot made: its change's, merged with it, never someone's outside Mate. */
function isBotCommit(authorName: string): boolean {
  return authorName.endsWith("[bot]");
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
  /** `main`'s commits, newest first, as HQ compares them; none while unread. */
  readonly commits: ReadonlyArray<HistoryCommit>;
}): ReadonlyArray<HistoryRelease> {
  const releases = input.releases.filter((release) => release.verdict !== "refused");
  const newestFirst = (left: string | undefined, right: string | undefined) =>
    time(right ?? "") - time(left ?? "");
  const changes = input.merged
    .filter((change) => change.kind === "code")
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt));
  const outside = input.commits.filter(
    (commit) =>
      commit.change === null && !isMergeCommit(commit.subject) && !isBotCommit(commit.authorName),
  );
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
    changes: changes.filter(
      (change) => releaseOfLanding(change.mergedAt, releases)?.tag === release.tag,
    ),
    outside: outside
      .filter((commit) => releaseOfLanding(commit.at, releases)?.tag === release.tag)
      .map((commit) => ({ sha: commit.sha, subject: changeTitle(commit.subject) })),
  }));
}

/** A release's second line: how many changes it put live, or where it went back to. */
export function releaseLine(release: HistoryRelease): string {
  if (release.backTo !== undefined) return `Back to ${release.backTo}`;
  const count = release.changes.length;
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
