import type * as Redacted from "effect/Redacted";
import type { FollowedRefs } from "./api.ts";
import type { GitRunner } from "./git.ts";

/**
 * Where a mirror's branches and tags live in HQ's copy: beside Mate's own `refs/heads` and
 * `refs/tags`, never in them, so no name collides with Mate's and nothing pushes them out. HQ's
 * own read data, fetched again from GitHub at will: never bundled, advertised or pushed.
 */
export const GITHUB_REFS = "refs/github/";

/** Every ref under `refs/github/`, at its object. */
const held = async (git: GitRunner, dir: string, signal: AbortSignal) =>
  new Map(
    (
      await git.run(["-C", dir, "for-each-ref", "--format=%(refname) %(objectname)", GITHUB_REFS], {
        signal,
      })
    )
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.lastIndexOf(" ");
        return [line.slice(0, at), line.slice(at + 1)] as const;
      }),
  );

/**
 * Every branch and tag of the remote at `url` into `refs/github/heads/*` and `refs/github/tags/*`:
 * force-pushes there followed, deletions there pruned. `--no-tags` keeps git from following tags
 * into Mate's own `refs/tags`.
 */
export const followRefs = async (
  git: GitRunner,
  dir: string,
  url: string,
  token: Redacted.Redacted,
  signal: AbortSignal,
): Promise<FollowedRefs> => {
  const before = await held(git, dir, signal);
  await git.remoteAskpass(
    [
      "-C",
      dir,
      "fetch",
      "--prune",
      "--no-tags",
      "--no-write-fetch-head",
      "--no-recurse-submodules",
      url,
      `+refs/heads/*:${GITHUB_REFS}heads/*`,
      `+refs/tags/*:${GITHUB_REFS}tags/*`,
    ],
    url,
    token,
    signal,
  );
  const after = await held(git, dir, signal);
  const heads = `${GITHUB_REFS}heads/`;
  return {
    pruned: [...before.keys()].filter((ref) => !after.has(ref)),
    heads: new Map(
      [...after]
        .filter(([ref]) => ref.startsWith(heads))
        .map(([ref, sha]) => [ref.slice(heads.length), sha] as const),
    ),
  };
};

/** Every ref under `refs/github/` gone: the repository no longer follows a remote's refs. */
export const unfollowRefs = async (git: GitRunner, dir: string, signal: AbortSignal) => {
  const refs = await held(git, dir, signal);
  if (refs.size === 0) return;
  await git.run(["-C", dir, "update-ref", "--stdin"], {
    signal,
    input: [...refs.keys()].map((ref) => `delete ${ref}\n`).join(""),
  });
};
