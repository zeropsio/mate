/**
 * A change's review as HQ recorded it when the change last moved (`ChangeReview`): its files and
 * their sizes, its commits, how it merges into `main` and whether `main` moved on under it. No
 * diff is held: a file's is read from the recorded merge base once the person unfolds it.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeReadout
 */
import type { ChangeReview, HqChange } from "@t3tools/shared/hqChanges";
import type { GitCompare } from "@t3tools/shared/hqGitBrowse/compare";

import { mergeabilityKindOf, type MergeabilityKind } from "./changeMergeability.ts";

/** A file it changes, as its row draws it. */
export interface ChangeReadoutFile {
  readonly path: string;
  /** `unknown` where HQ has not recorded it: the row draws no letter, never a guessed one. */
  readonly status: "added" | "deleted" | "modified" | "unknown";
  readonly additions: number;
  readonly deletions: number;
}

/** A commit on it and not on `main`. */
export interface ChangeReadoutCommit {
  readonly sha: string;
  readonly subject: string;
  readonly at: string;
}

export interface ChangeReadout {
  readonly files: ReadonlyArray<ChangeReadoutFile>;
  /** Whether `files` is the change's files: false where HQ has not recorded them yet. */
  readonly filesKnown: boolean;
  /** The merge base a file's diff is read from when the person unfolds it; none, no diff is read. */
  readonly diffBase: string | null;
  /** HQ read only so many of its files. */
  readonly filesCut: boolean;
  /** Newest first. */
  readonly commits: ReadonlyArray<ChangeReadoutCommit>;
  /** Whether `commits` is the change's commits: false where HQ has not recorded them yet. */
  readonly commitsKnown: boolean;
  /** Only the newest commits are held. */
  readonly commitsCut: boolean;
  readonly mergeability: MergeabilityKind;
  /** The files it conflicts with `main` in; none named for a change that shares no history. */
  readonly conflict: ReadonlyArray<string>;
  /** Whether `main`'s head as read is past the change's merge base with it: `main` moved on. */
  readonly behind: boolean;
}

const recordedStatus: Record<string, ChangeReadoutFile["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  T: "modified",
};

/**
 * A change's review as HQ recorded it with the merge verdict: its files, sizes and commits, no diffs. A file's status is as HQ recorded it, else unknown.
 */
export function changeReadoutOfRecord(change: HqChange, review: ChangeReview): ChangeReadout {
  return {
    filesKnown: review.files !== null,
    diffBase: review.mergeBase,
    files: (review.files ?? []).map((file) => ({
      path: file.path,
      status: recordedStatus[file.status ?? "?"] ?? "unknown",
      additions: file.added ?? 0,
      deletions: file.deleted ?? 0,
    })),
    filesCut: review.filesTruncated,
    commits: (review.commits ?? []).map(({ sha, subject, at }) => ({ sha, subject, at })),
    commitsKnown: review.commits !== null,
    commitsCut: review.commitsTruncated,
    mergeability: mergeabilityKindOf(change.mergeability),
    conflict: review.conflictPaths,
    behind: change.behind,
  };
}

/**
 * The files of a change HQ never recorded, as the person asked for them: `main` compared with the
 * change's head in its repository. A file's diff is read from where the two split once it is
 * unfolded, as for recorded files; its commits stay as recorded, read on their own press.
 */
export function changeReadoutOfCompare(readout: ChangeReadout, compare: GitCompare): ChangeReadout {
  return {
    ...readout,
    filesKnown: true,
    diffBase: compare.mergeBase,
    files: compare.files.map(({ path, status, additions, deletions }) => ({
      path,
      status,
      additions,
      deletions,
    })),
    filesCut: compare.filesTruncated,
  };
}
