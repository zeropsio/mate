/**
 * Every file path at a commit, for the file finder: `ls-tree -r -z`, read until the caller's
 * limit. A submodule is no file there: it is left out. A commit never changes, so neither does
 * the list.
 *
 * @module browse/paths
 */
import { GitError } from "../api.ts";
import { terminate, type GitRunner } from "../git.ts";
import { pathText } from "../pathText.ts";

export interface PathList {
  readonly paths: ReadonlyArray<string>;
  /** More paths than the limit: `paths` holds the first ones. */
  readonly truncated: boolean;
}

/** The paths at `sha`, the first `max`; none where the repository holds no such commit. */
export const listPaths = async (
  git: GitRunner,
  dir: string,
  sha: string,
  max: number,
  signal: AbortSignal,
): Promise<PathList | null> => {
  const process = git.start(["-C", dir, "ls-tree", "-r", "-z", `${sha}^{commit}`], {
    signal,
    // 128: no such commit.
    acceptExitCodes: [128],
  });
  process.child.stdin.end();
  const paths: string[] = [];
  let pending = Buffer.alloc(0);
  let truncated = false;
  try {
    reading: for await (const chunk of process.child.stdout) {
      pending = Buffer.concat([pending, chunk as Uint8Array]);
      let at = 0;
      for (let end = pending.indexOf(0); end !== -1; end = pending.indexOf(0, at)) {
        // `<mode> <type> <object>\t<path>`
        const record = pending.subarray(at, end);
        at = end + 1;
        const tab = record.indexOf(9);
        if (record.subarray(0, tab).toString().split(" ")[1] === "commit") continue;
        if (paths.length === max) {
          truncated = true;
          break reading;
        }
        paths.push(pathText(record.subarray(tab + 1)));
      }
      pending = pending.subarray(at);
    }
    if (truncated) return { paths, truncated };
    await process.done;
    if (process.child.exitCode !== 128) return { paths, truncated };
    if (paths.length === 0) return null;
    throw new GitError({
      operation: "browse.paths",
      reason: "git_failed",
      message: "Git ls-tree failed",
    });
  } finally {
    terminate(process.child);
    await process.done.catch(() => {});
  }
};
