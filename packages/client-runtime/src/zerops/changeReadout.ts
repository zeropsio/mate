/**
 * A change's review as HQ's detail reads it (SPEC §3.2a, `ChangeDetailResponse`): its files with
 * their diffs, its commits, how it merges into `main`, and where `main` stands against it — one
 * read, so every part is read, or none is.
 *
 * HQ hands each file's patch over as `git diff` wrote it for that one path, its header included
 * and renames never followed: the header says whether the change adds the file or deletes it,
 * and `parseChangeDiff` reads its lines.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeReadout
 */
import type {
  ChangeDetailResponse,
  ChangeFile,
  ChangeReview,
  HqChange,
} from "@t3tools/shared/hqChanges";
import type { GitCompare } from "@t3tools/shared/hqGitBrowse/compare";

import { mergeabilityKindOf, type MergeabilityKind } from "./changeMergeability.ts";
import { parseChangeDiff, type ChangeDiffFile } from "./changeDiff.ts";

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
  /**
   * The merge base a file's diff is read from when the person unfolds it; `null` where `diff`
   * already holds them.
   */
  readonly diffBase: string | null;
  /** HQ read only so many of its files. */
  readonly filesCut: boolean;
  /** Each file's diff, by its path. */
  readonly diff: ReadonlyMap<string, ChangeDiffFile>;
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

/** Whether the change adds the file or deletes it, as its patch's header says; else it edits it. */
function statusOf(file: ChangeFile): ChangeReadoutFile["status"] {
  const firstHunk = file.hunks.indexOf("\n@@");
  const header = firstHunk === -1 ? file.hunks : file.hunks.slice(0, firstHunk);
  if (/^new file mode /mu.test(header)) return "added";
  if (/^deleted file mode /mu.test(header)) return "deleted";
  return "modified";
}

export function changeReadout(detail: ChangeDetailResponse): ChangeReadout {
  const diff = new Map<string, ChangeDiffFile>();
  for (const file of detail.files) {
    const read = parseChangeDiff(file.hunks, { cut: file.truncated }).get(file.path);
    if (read !== undefined) diff.set(file.path, read);
  }
  return {
    filesKnown: true,
    diffBase: null,
    files: detail.files.map((file) => ({
      path: file.path,
      status: statusOf(file),
      additions: file.added ?? 0,
      deletions: file.deleted ?? 0,
    })),
    filesCut: detail.filesTruncated,
    diff,
    commits: detail.commits.map(({ sha, subject, at }) => ({ sha, subject, at })),
    commitsKnown: true,
    commitsCut: detail.commitsTruncated,
    mergeability: mergeabilityKindOf(detail.mergeability.kind),
    conflict: detail.mergeability.kind === "conflict" ? detail.mergeability.paths : [],
    behind:
      detail.mainHead !== null && detail.mergeBase !== null && detail.mainHead !== detail.mergeBase,
  };
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
    diff: new Map(),
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
