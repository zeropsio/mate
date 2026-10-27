/**
 * The squashes of Mates' changes on a repository's `main`, by the `Mate-Change: <mateId>/<number>`
 * trailer the git layer gives every squash (`@t3tools/hq-git` `squashMerge`): what tells that a
 * change is merged when its record does not say so — a squash whose record never landed, or one a
 * restore's records predate. Only `main`'s first-parent line is read: what a merge brought in
 * beside it — another repository's history kept by the first change, or a person's commits under a
 * GitHub merge commit — carries trailers HQ never wrote.
 *
 * @module squashes
 */
import type { HqGit, Repo } from "@t3tools/hq-git";
import * as Effect from "effect/Effect";

const TRAILER = /^Mate-Change: (\S+\/[1-9][0-9]*)$/u;

/**
 * Among the latest commits of `main`'s first-parent line, the squash of each change, by
 * `<mateId>/<number>`; none past them, and none while `main` is unborn.
 */
export const squashesOnMain = (git: HqGit, repo: Repo) =>
  Effect.gen(function* () {
    const found = new Map<string, string>();
    const main = (yield* git.branches(repo)).items.find(
      (branch) => branch.ref === "refs/heads/main",
    );
    if (main === undefined) return found;
    const log = yield* git.log(repo, main.sha, { limit: 100, firstParent: true });
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
