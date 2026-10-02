/**
 * A pull request's state reaching every window sooner, for at most one listing every
 * {@link PULL_WATCH_MS} — and only while a group has one open that moved lately.
 *
 * Every open window reads the forge on its own minute's clock (`useZeropsGroupForge`), and Gitea
 * pushes nothing to a browser: a merge made in one window reached another on its next tick. Run 4
 * (2026-10-02) measured it: merged at +1013.7 s, the merging window cleared its Mate's "needs you"
 * face at +1014.5 s, and a second window kept it until +1062.9 s. Nothing the account store
 * carries says a merge happened — a stage's build after one is the broker's, and only where the
 * group has a stage — so the org's own listing is the cheapest place to see it: its
 * `open_pr_counter` moves when a pull request opens, closes or merges, its `updated_at` with
 * every push (`forge/forgeReads.ts`).
 *
 * So every {@link PULL_WATCH_MS} the watch lists one org, through the listing both group readers
 * share: of the groups with an open pull request updated in the last {@link PULL_WATCH_QUIET_MS},
 * the one looked at longest ago, the most recently updated first. What that listing drops of a
 * repository's pull requests is read again at once (`moved`).
 *
 * The cost is one listing a tick whatever the count — at most four a minute per window, part of
 * which the minute's own listing of that org would have been — and nothing while no group has
 * one open and moving: a pull request left waiting for half an hour is back on the minute's
 * clock. A merge reaches a window within 15 s with one group watched, 30 s with two, and never
 * later than the minute's refresh. The pull requests a merge moved are read twice in the window
 * that merged it — by the verb, and again once the listing shows the merge — as the minute's
 * listing made them before; the watch only makes that read come sooner.
 *
 * Pure but for the reads and the clock it is handed (rule R1). The owner runs
 * {@link PullWatch.tick} on a visible-page clock.
 *
 * @module forge/pullWatch
 */
import type { GiteaRepository } from "../giteaClient.ts";
import type { ForgeReads } from "./forgeReads.ts";

/** How often the forge is read again while nothing is watched: the group readers' own clock. */
export const FORGE_REFRESH_MS = 60_000;

/** How often the watch lists an org: one org a tick. */
export const PULL_WATCH_MS = 15_000;

/** How long a group's open pull requests may sit unchanged before it is back on the minute. */
export const PULL_WATCH_QUIET_MS = 30 * 60_000;

/**
 * How old a shared listing may be and still answer a watch tick: under {@link PULL_WATCH_MS}, so a
 * tick a little early on its timer still asks, and one right after a reader listed does not.
 */
const PULL_WATCH_LISTING_MAX_AGE_MS = PULL_WATCH_MS - 2_000;

/** A group as the watch needs it: its Gitea org, and its answer's open pull requests. */
export interface PullWatchGroup {
  readonly groupId: string;
  readonly slug: string;
  readonly openPulls: number;
  /** When the most recently updated of them was, as Gitea says; `undefined` where none says. */
  readonly newestPullAt: string | undefined;
}

/** Every group, with its answer's open pull requests (none while unanswered). */
export function pullWatchGroups(
  groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>,
  answers: ReadonlyMap<
    string,
    { readonly pullRequests: ReadonlyArray<{ readonly updatedAt?: string | undefined }> }
  >,
): ReadonlyArray<PullWatchGroup> {
  return groups.map((group) => {
    const pulls = answers.get(group.groupId)?.pullRequests ?? [];
    const newest = pulls
      .map((pull) => pull.updatedAt)
      .filter((at): at is string => at !== undefined)
      .reduce<string | undefined>(
        (max, at) => (max === undefined || at > max ? at : max),
        undefined,
      );
    return {
      groupId: group.groupId,
      slug: group.slug,
      openPulls: pulls.length,
      newestPullAt: newest,
    };
  });
}

/** The groups the watch looks at, the most recently updated first. */
export function watchedGroups(
  groups: ReadonlyArray<PullWatchGroup>,
  nowMs: number,
): ReadonlyArray<PullWatchGroup> {
  const at = (group: PullWatchGroup) =>
    group.newestPullAt === undefined ? Number.NaN : Date.parse(group.newestPullAt);
  const watched = groups.filter((group) => {
    if (group.openPulls === 0) return false;
    const updated = at(group);
    // A pull request nothing dates is watched: only a date says it has gone quiet.
    return Number.isNaN(updated) || nowMs - updated < PULL_WATCH_QUIET_MS;
  });
  return watched.sort((left, right) =>
    (right.newestPullAt ?? "").localeCompare(left.newestPullAt ?? ""),
  );
}

export interface PullWatch {
  /**
   * One look: the next watched group's org listed, and `moved` for each repository whose pull
   * requests that listing dropped. A listing that does not answer says nothing; the minute's
   * refresh is still there.
   */
  readonly tick: (groups: ReadonlyArray<PullWatchGroup>) => Promise<void>;
}

export function createPullWatch(options: {
  readonly reads: ForgeReads;
  readonly list: (owner: string) => Promise<ReadonlyArray<GiteaRepository>>;
  /** A repository's pull requests moved: read them again now. */
  readonly moved: (groupId: string, repository: string) => void;
  readonly now?: () => number;
}): PullWatch {
  const now = options.now ?? Date.now;
  /** When each watched org was last looked at. */
  const looked = new Map<string, number>();
  let running: Promise<void> | null = null;

  const tick = async (groups: ReadonlyArray<PullWatchGroup>) => {
    const at = now();
    const watched = watchedGroups(groups, at);
    const slugs = new Set(watched.map((group) => group.slug));
    for (const slug of looked.keys()) if (!slugs.has(slug)) looked.delete(slug);
    // Round the watched groups, never-looked first, the most recently updated first among equals.
    let next: PullWatchGroup | undefined;
    for (const group of watched) {
      const last = looked.get(group.slug) ?? Number.NEGATIVE_INFINITY;
      if (next === undefined || last < (looked.get(next.slug) ?? Number.NEGATIVE_INFINITY))
        next = group;
    }
    if (next === undefined) return;
    const group = next;
    looked.set(group.slug, at);
    const dropped: Array<string> = [];
    let listed: ReadonlyArray<GiteaRepository>;
    try {
      listed = await options.reads.repositories(group.slug, () => options.list(group.slug), {
        maxAgeMs: PULL_WATCH_LISTING_MAX_AGE_MS,
        moved: (reread) => {
          for (const [repository, parts] of reread)
            if (parts.has("pulls")) dropped.push(repository);
        },
      });
    } catch {
      // No answer is no look; the minute's refresh reads on.
      return;
    }
    // A repository the listing no longer names has no pull requests to read.
    const names = new Set(listed.map((repository) => repository.name));
    for (const repository of dropped)
      if (names.has(repository)) options.moved(group.groupId, repository);
  };

  return {
    tick: (groups) => {
      // One look at a time: a tick that comes while one runs is that one.
      running ??= tick(groups).finally(() => {
        running = null;
      });
      return running;
    },
  };
}
