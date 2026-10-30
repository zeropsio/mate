/**
 * A change's review as HQ recorded it when the change last moved (`ChangeReview`): its files and
 * their sizes, its commits, how it merges into `main` and whether `main` moved on under it. No
 * diff is held: a file's is read from the recorded merge base once the person unfolds it.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeReadout
 */
import type { ChangeReview, HqChange, HqCorePush, Mergeability } from "@t3tools/shared/hqChanges";
import type { GitCompare } from "@t3tools/shared/hqGitBrowse/compare";

import {
  judgedMergeabilityOf,
  mergeabilityKindOf,
  type MergeabilityKind,
} from "./changeMergeability.ts";

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

/**
 * HQ's merge of `main` into a change stacked on one that merged, in words: HQ's push, never its
 * Mate's. The merged change by its title where it was read, else by its number.
 */
export function corePushWords(push: HqCorePush, landedTitle: string | undefined): string {
  const landed = landedTitle === undefined ? `#${String(push.landed)}` : `“${landedTitle}”`;
  return `HQ brought main in after ${landed} merged`;
}

/**
 * A change's commits as its review lists them: the merge commit HQ pushed on its branch
 * (`corePush.head`, authored by HQ's Core) reads as HQ's push, at the time HQ pushed it.
 */
export function changeCommitRows(input: {
  readonly commits: ReadonlyArray<ChangeReadoutCommit>;
  readonly corePush: HqCorePush | undefined;
  /** The title of the change whose merge HQ brought in, where it was read. */
  readonly landedTitle: string | undefined;
}): ReadonlyArray<ChangeReadoutCommit> {
  const push = input.corePush;
  if (push === undefined) return input.commits;
  return input.commits.map((commit) =>
    commit.sha === push.head
      ? { sha: commit.sha, subject: corePushWords(push, input.landedTitle), at: push.at }
      : commit,
  );
}

export interface ChangeReadout {
  readonly files: ReadonlyArray<ChangeReadoutFile>;
  /** Whether `files` is the change's files: false where HQ has not recorded them yet. */
  readonly filesKnown: boolean;
  /**
   * What a file's diff is read from when the person unfolds it: the merge base, or Git's empty tree
   * for a change into a `main` with no commit yet; none, no diff is read.
   */
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
  /** What it does, as its Mate described it (`describe-change`); none where it wrote none. */
  readonly description: string | undefined;
}

/** Git's empty tree in a repository of SHA-1 and of SHA-256 object ids. */
const EMPTY_TREE = {
  40: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  64: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
} as const;

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
    // Files recorded with no merge base went into a `main` with no commit: HQ measured them from
    // Git's empty tree.
    diffBase:
      review.mergeBase ??
      (review.files === null ? null : EMPTY_TREE[change.head?.length === 64 ? 64 : 40]),
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
    description: change.body.trim().length === 0 ? undefined : change.body,
  };
}

/**
 * Whether a change merges, from HQ's record while it has a verdict, else from HQ's judgement of the
 * shown head and `main` where that was read: a record HQ never judged again would say it is checked
 * for good. A conflict judged so names its files from the judgement.
 */
export function changeReadoutJudged(
  readout: ChangeReadout,
  judged: Mergeability | undefined,
): ChangeReadout {
  if (readout.mergeability !== "checking" || judged === undefined) return readout;
  return {
    ...readout,
    mergeability: judgedMergeabilityOf(judged),
    conflict: judged.kind === "conflict" ? judged.paths : readout.conflict,
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
