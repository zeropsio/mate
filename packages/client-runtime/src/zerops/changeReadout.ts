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
import type { ChangeDetailResponse, ChangeFile } from "@t3tools/shared/hqChanges";

import type { MergeabilityKind } from "./changeMergeability.ts";
import { parseChangeDiff, type ChangeDiffFile } from "./changeDiff.ts";

/** A file it changes, as its row draws it. */
export interface ChangeReadoutFile {
  readonly path: string;
  readonly status: "added" | "deleted" | "modified";
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
  /** HQ read only so many of its files. */
  readonly filesCut: boolean;
  /** Each file's diff, by its path. */
  readonly diff: ReadonlyMap<string, ChangeDiffFile>;
  /** Newest first. */
  readonly commits: ReadonlyArray<ChangeReadoutCommit>;
  readonly mergeability: MergeabilityKind;
  /** The files it conflicts with `main` in; none named for a change that shares no history. */
  readonly conflict: ReadonlyArray<string>;
  /** `main`'s head as read, and the change's merge base with it: past it, `main` moved on. */
  readonly mainHead: string | undefined;
  readonly mergeBase: string | undefined;
}

/** Whether the change adds the file or deletes it, as its patch's header says; else it edits it. */
function statusOf(file: ChangeFile): ChangeReadoutFile["status"] {
  const firstHunk = file.hunks.indexOf("\n@@");
  const header = firstHunk === -1 ? file.hunks : file.hunks.slice(0, firstHunk);
  if (/^new file mode /mu.test(header)) return "added";
  if (/^deleted file mode /mu.test(header)) return "deleted";
  return "modified";
}

function mergeabilityOf(
  mergeability: ChangeDetailResponse["mergeability"],
): Pick<ChangeReadout, "mergeability" | "conflict"> {
  switch (mergeability.kind) {
    case "clean":
      return { mergeability: "mergeable", conflict: [] };
    case "conflict":
      return { mergeability: "conflicting", conflict: mergeability.paths };
    case "unrelated":
      return { mergeability: "conflicting", conflict: [] };
    case "empty":
    case "already_merged":
    case "no_change":
      return { mergeability: "empty", conflict: [] };
  }
}

export function changeReadout(detail: ChangeDetailResponse): ChangeReadout {
  const diff = new Map<string, ChangeDiffFile>();
  for (const file of detail.files) {
    const read = parseChangeDiff(file.hunks, { cut: file.truncated }).get(file.path);
    if (read !== undefined) diff.set(file.path, read);
  }
  return {
    files: detail.files.map((file) => ({
      path: file.path,
      status: statusOf(file),
      additions: file.added ?? 0,
      deletions: file.deleted ?? 0,
    })),
    filesCut: detail.filesTruncated,
    diff,
    commits: detail.commits.map(({ sha, subject, at }) => ({ sha, subject, at })),
    ...mergeabilityOf(detail.mergeability),
    mainHead: detail.mainHead ?? undefined,
    mergeBase: detail.mergeBase ?? undefined,
  };
}
