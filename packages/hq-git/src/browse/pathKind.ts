/**
 * What a path is at a commit: a file, a folder, or nothing there. A link names a path's kind by
 * its spelling (a README's `[docs](docs)` names a folder as a file); the commit says what it is.
 *
 * @module browse/pathKind
 */
import { GitError } from "../api.ts";
import type { GitRunner } from "../git.ts";

export type PathKind = "file" | "folder";

export const pathKind = async (
  git: GitRunner,
  dir: string,
  sha: string,
  path: string,
  signal: AbortSignal,
): Promise<PathKind | null> => {
  if (!/^[0-9a-f]{40}$/u.test(sha))
    throw new GitError({
      operation: "browse.pathKind",
      reason: "invalid_config",
      message: "Invalid commit",
    });
  if (path === "") return "folder";
  // One line of input names one object; a path that cannot be one line is no path of the commit.
  if (/[\n\0]/u.test(path)) return null;
  const answer = await git.run(["-C", dir, "cat-file", "--batch-check=%(objecttype)"], {
    signal,
    input: `${sha}:${path}\n`,
  });
  const type = answer.toString().trim();
  return type === "blob" ? "file" : type === "tree" ? "folder" : null;
};
