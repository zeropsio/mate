/**
 * A commit as its page reads it: its message and people, and what it changed against its first
 * parent — the empty tree for a repository's first commit — under the page's budget
 * (`diff.ts`). A merge shows what it brought into the branch it was made on.
 *
 * @module browse/commit
 */
import type { GitRunner } from "../git.ts";
import { readDiff, readFileDiff, type Diff } from "./diff.ts";

/** The most of a message a page reads. */
const MESSAGE_MAX_BYTES = 64 * 1024;

export interface CommitRead extends Diff {
  readonly sha: string;
  readonly parents: ReadonlyArray<string>;
  readonly subject: string;
  readonly body: string;
  /** The message was longer than a page reads: its end is not here. */
  readonly messageCut: boolean;
  readonly authorName: string;
  readonly authoredAt: string;
  readonly committerName: string;
  readonly committedAt: string;
}

/** The commit `sha` is, verified; none where the repository holds no such commit. */
export const verified = async (git: GitRunner, dir: string, sha: string, signal: AbortSignal) => {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha)) return null;
  const found = await git.exec(
    ["-C", dir, "rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}`],
    { signal, acceptExitCodes: [1, 128] },
  );
  return found.code === 0 && found.stdout.toString().trim() === sha ? sha : null;
};

/** What a commit is compared with: its first parent, or the empty tree for a first commit. */
const baseOf = async (
  git: GitRunner,
  dir: string,
  parents: ReadonlyArray<string>,
  signal: AbortSignal,
) =>
  parents[0] ??
  (await git.run(["-C", dir, "hash-object", "-t", "tree", "--stdin"], { signal, input: "" }))
    .toString()
    .trim();

// The message comes last: it is the only field that may hold anything.
const FORMAT = "%P%x00%an%x00%aI%x00%cn%x00%cI%x00%B";

export const readCommit = async (
  git: GitRunner,
  dir: string,
  sha: string,
  signal: AbortSignal,
): Promise<CommitRead | null> => {
  if ((await verified(git, dir, sha, signal)) === null) return null;
  const shown = await git.prefix(
    ["-C", dir, "show", "-s", `--format=${FORMAT}`, sha, "--"],
    signal,
    MESSAGE_MAX_BYTES,
  );
  const [parentList = "", authorName = "", authoredAt = "", committerName = "", committedAt = ""] =
    shown.bytes.toString().split("\0", 5);
  const message = shown.bytes.toString().split("\0").slice(5).join("\0").replace(/\n+$/u, "");
  const parents = parentList.split(" ").filter(Boolean);
  const [subject = "", ...rest] = message.split("\n");
  const diff = await readDiff(git, dir, await baseOf(git, dir, parents, signal), sha, signal);
  return {
    sha,
    parents,
    subject,
    body: rest.join("\n").replace(/^\n+/u, ""),
    messageCut: shown.truncated,
    authorName,
    authoredAt,
    committerName,
    committedAt,
    ...diff,
  };
};

/**
 * One file's hunks in a commit, read on request; `hunks` none where they are too long to read
 * here. None where the repository holds no such commit.
 */
export const readCommitFile = async (
  git: GitRunner,
  dir: string,
  sha: string,
  path: string,
  signal: AbortSignal,
): Promise<{ readonly hunks: string | null } | null> => {
  if ((await verified(git, dir, sha, signal)) === null) return null;
  // No file has such a path: it changed nothing there.
  if (path === "" || path.includes("\0")) return { hunks: "" };
  const parents = (await git.run(["-C", dir, "rev-parse", `${sha}^@`], { signal }))
    .toString()
    .split("\n")
    .filter(Boolean);
  const base = await baseOf(git, dir, parents, signal);
  return { hunks: await readFileDiff(git, dir, base, sha, path, signal) };
};
