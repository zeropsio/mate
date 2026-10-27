/**
 * Two commits compared as a browse page reads them, three dots: what `head` adds since it left
 * `base` — its commits not reachable from `base`, newest first, the first 100 and how many in all,
 * and what changed from where the two split to `head`, under the page's budget (`diff.ts`).
 *
 * @module browse/compare
 */
import type { GitRunner } from "../git.ts";
import { verified } from "./commit.ts";
import { readDiff, readFileDiff, type Diff } from "./diff.ts";
import { LOG_FORMAT, LOG_PAGE_LIMIT, logItemOf, type LogItem } from "./log.ts";

/** Bytes the commit list reads: each record is bounded by its cut subject. */
const BYTES_LIMIT = 1024 * 1024;

export interface CompareRead extends Diff {
  /** Where `head` left `base`; none where the two histories never met. */
  readonly mergeBase: string | null;
  /** What `head` adds, newest first: the first {@link LOG_PAGE_LIMIT}. */
  readonly commits: ReadonlyArray<LogItem>;
  readonly totalCommits: number;
}

const NOTHING: Omit<CompareRead, "mergeBase"> = {
  commits: [],
  totalCommits: 0,
  files: [],
  totalFiles: 0,
  filesTruncated: false,
};

/** What `head` adds since it left `base`; none where the repository holds either not. */
export const readCompare = async (
  git: GitRunner,
  dir: string,
  base: string,
  head: string,
  signal: AbortSignal,
): Promise<CompareRead | null> => {
  if ((await verified(git, dir, base, signal)) === null) return null;
  if ((await verified(git, dir, head, signal)) === null) return null;
  const found = await git.exec(["-C", dir, "merge-base", "--end-of-options", base, head], {
    signal,
    acceptExitCodes: [1],
  });
  if (found.code !== 0) return { mergeBase: null, ...NOTHING };
  const mergeBase = found.stdout.toString().trim();
  const range = ["--end-of-options", head, `^${base}`, "--"];
  const total = await git.run(["-C", dir, "rev-list", "--count", ...range], { signal });
  const listed = await git.prefix(
    [
      "-C",
      dir,
      "log",
      "-z",
      "--no-color",
      `--format=${LOG_FORMAT}`,
      `--max-count=${LOG_PAGE_LIMIT}`,
      ...range,
    ],
    signal,
    BYTES_LIMIT,
  );
  const records = listed.bytes.toString().split("\0");
  if (listed.truncated) records.pop(); // Never a cut record as a whole one.
  return {
    mergeBase,
    commits: records.filter(Boolean).map(logItemOf),
    totalCommits: Number(total.toString().trim()),
    ...(await readDiff(git, dir, mergeBase, head, signal)),
  };
};

/**
 * One file's patch from where two commits split (`base`, the answered merge base) to `head`, read
 * on request; `hunks` none where it is too long to read here. None where either is not held.
 */
export const readCompareFile = async (
  git: GitRunner,
  dir: string,
  base: string,
  head: string,
  path: string,
  signal: AbortSignal,
): Promise<{ readonly hunks: string | null } | null> => {
  if ((await verified(git, dir, base, signal)) === null) return null;
  if ((await verified(git, dir, head, signal)) === null) return null;
  if (path === "" || path.includes("\0")) return { hunks: "" };
  return { hunks: await readFileDiff(git, dir, base, head, path, signal) };
};
