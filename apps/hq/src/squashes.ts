/**
 * The squashes of Mates' changes on a repository's `main`, by the `Mate-Change: <mateId>/<number>`
 * trailer the git layer gives every squash (`@t3tools/hq-git` `squashMerge`): what tells that a
 * change is merged when its record does not say so — a squash whose record never landed, or one a
 * restore's records predate.
 *
 * @module squashes
 */
import type { HqGit, Repo } from "@t3tools/hq-git";
import * as Effect from "effect/Effect";

const TRAILER = /^Mate-Change: (\S+\/[1-9][0-9]*)$/u;

/** Among `main`'s latest commits, the squash of each change, by `<mateId>/<number>`; none past them. */
export const squashesOnMain = (git: HqGit, repo: Repo) =>
  Effect.map(git.log(repo, "refs/heads/main", { limit: 100 }), (log) => {
    const found = new Map<string, string>();
    for (const commit of log.items) {
      // Git reads trailers only from the last paragraph, as the git layer writes them there.
      const trailers =
        commit.message
          .trimEnd()
          .split(/\n[ \t]*\n/u)
          .at(-1) ?? "";
      for (const line of trailers.split("\n")) {
        const change = TRAILER.exec(line.trim())?.[1];
        if (change !== undefined && !found.has(change)) found.set(change, commit.sha);
      }
    }
    return found;
  });
