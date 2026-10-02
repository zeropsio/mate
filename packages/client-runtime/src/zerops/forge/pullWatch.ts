/**
 * A pull request's state reaching every window sooner, at the cost of one listing — and only while
 * a group has one open.
 *
 * Every open window reads the forge on its own minute's clock (`useZeropsGroupForge`), and Gitea
 * pushes nothing to a browser: a merge made in one window reached another on its next tick. Run 4
 * (2026-10-02) measured it: merged at +1013.7 s, the merging window cleared its Mate's "needs you"
 * face at +1014.5 s, and a second window kept it until +1062.9 s. Nothing the account store
 * carries says a merge happened — a stage's build after one is the broker's, and only where the
 * group has a stage — so the org's own listing is the cheapest place to see it: its
 * `open_pr_counter` moves when a pull request opens, closes or merges (`forge/forgeReads.ts`).
 *
 * So while a group has an open pull request, its org is listed every {@link PULL_WATCH_MS} through
 * the listing both group readers share, and a repository whose counter moved since the watch last
 * looked has its pull requests read again at once (`moved`). Nothing else is read: a group with
 * none open costs nothing more, and one with any — however many — costs {@link PULL_WATCH_MS}'s
 * listings a minute in place of the minute's one: +3 requests a minute per watched group, per
 * window, and two pull request listings for the repository a merge moved. The answer that reads
 * the merge has no open pull request, and the group drops back to the minute's refresh.
 *
 * Pure but for the reads it is handed: no clock of its own, no platform globals (rule R1). The
 * owner runs {@link PullWatch.tick} on a visible-page clock.
 *
 * @module forge/pullWatch
 */
import type { GiteaRepository } from "../giteaClient.ts";
import type { ForgeReads } from "./forgeReads.ts";

/** How often the forge is read again while nothing is open: the group readers' own clock. */
export const FORGE_REFRESH_MS = 60_000;

/** How often a group with an open pull request has its org listed. */
export const PULL_WATCH_MS = 15_000;

/**
 * How old a shared listing may be and still answer a watch tick: under {@link PULL_WATCH_MS}, so a
 * tick a little early on its timer still asks, and one right after a reader listed does not.
 */
const PULL_WATCH_LISTING_MAX_AGE_MS = PULL_WATCH_MS - 2_000;

/** How often a group's pull requests are looked at, by how many it has open. */
export function pullCadenceMs(openPulls: number): number {
  return openPulls > 0 ? PULL_WATCH_MS : FORGE_REFRESH_MS;
}

/** A group as the watch needs it: its Gitea org, and how many pull requests its answer has open. */
export interface PullWatchGroup {
  readonly groupId: string;
  readonly slug: string;
  readonly openPulls: number;
}

/** Every group, with how many pull requests its forge answer has open (none while unanswered). */
export function pullWatchGroups(
  groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>,
  answers: ReadonlyMap<string, { readonly pullRequests: ReadonlyArray<unknown> }>,
): ReadonlyArray<PullWatchGroup> {
  return groups.map((group) => ({
    groupId: group.groupId,
    slug: group.slug,
    openPulls: answers.get(group.groupId)?.pullRequests.length ?? 0,
  }));
}

export interface PullWatch {
  /**
   * One look at each group with an open pull request: its org's listing, and `moved` for each
   * repository whose open counter changed since the last look. A listing that does not answer
   * says nothing; the minute's refresh is still there.
   */
  readonly tick: (groups: ReadonlyArray<PullWatchGroup>) => Promise<void>;
}

export function createPullWatch(options: {
  readonly reads: ForgeReads;
  readonly list: (owner: string) => Promise<ReadonlyArray<GiteaRepository>>;
  /** A repository's pull requests moved: read them again now. */
  readonly moved: (groupId: string, repository: string) => void;
}): PullWatch {
  /** Each watched org's open counters at the last look, by repository. */
  const seen = new Map<string, Map<string, number>>();
  let running: Promise<void> | null = null;

  const look = async (group: PullWatchGroup) => {
    let listed: ReadonlyArray<GiteaRepository>;
    try {
      listed = await options.reads.repositories(group.slug, () => options.list(group.slug), {
        maxAgeMs: PULL_WATCH_LISTING_MAX_AGE_MS,
      });
    } catch {
      // No answer is no look: the counters stand as last seen, and the minute's refresh reads on.
      return;
    }
    const before = seen.get(group.slug);
    const now = new Map<string, number>();
    for (const repository of listed) {
      const open = repository.open_pr_counter;
      if (open === undefined) continue;
      now.set(repository.name, open);
      const was = before?.get(repository.name);
      if (before !== undefined && was !== open) options.moved(group.groupId, repository.name);
    }
    seen.set(group.slug, now);
  };

  const tick = async (groups: ReadonlyArray<PullWatchGroup>) => {
    const watched = groups.filter((group) => pullCadenceMs(group.openPulls) === PULL_WATCH_MS);
    // A group that left the watch starts over: the minute's refresh read what moved meanwhile.
    const slugs = new Set(watched.map((group) => group.slug));
    for (const slug of seen.keys()) if (!slugs.has(slug)) seen.delete(slug);
    for (const group of watched) await look(group);
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
