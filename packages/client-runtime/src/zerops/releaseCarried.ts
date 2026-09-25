/**
 * What a release carried: for each service it moved, the commits on that
 * service's default branch since the release before it.
 *
 * A release tag lists one whole sha per service and nothing else, so a row
 * built from it can say `api 3f9c1b2` and not what that is. The branch's
 * commits, read once for the stop's repositories, answer the rest: the slice
 * of the branch between the older release's sha and this one's is what this
 * release put in front of people.
 *
 * Only what was read is claimed. A head outside the read window carries
 * nothing it can name; an older sha outside it runs to the end of the read.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseCarried
 */

import type { GiteaCommit } from "./giteaClient.ts";
import { historyLine } from "./groupHistory.ts";
import { shortCommit, type FlowRelease, type ReleaseEntry } from "./release.ts";

/** One repository a release moved, and the commits that moved it. */
export interface ReleaseServiceChange {
  /** The hostname: the first entry, in entry order, for this repository. */
  readonly service: string;
  readonly repository: string;
  /** Newest first: this release's commit, down to but excluding the older release's commit. Never empty. */
  readonly commits: ReadonlyArray<GiteaCommit>;
}

/** Where `sha` sits on a branch read newest first; `-1` outside it. */
function indexOnBranch(branch: ReadonlyArray<GiteaCommit>, sha: string): number {
  const wanted = sha.toLowerCase();
  return branch.findIndex((commit) => commit.sha.toLowerCase() === wanted);
}

/** The commit of the first entry `matches` finds, in the nearest older release that has one. */
function olderCommit(
  older: ReadonlyArray<ReadonlyArray<ReleaseEntry>>,
  matches: (entry: ReleaseEntry) => boolean,
): string | undefined {
  for (const entries of older) {
    const found = entries.find(matches);
    if (found !== undefined) return found.commit;
  }
  return undefined;
}

/**
 * The repositories one release moved, in entry order, each once.
 *
 * A single-repository group lists every service at the same sha: that is one
 * change, named by its first service. A service no older release lists is
 * measured by the older sha of another service on its repository, so one
 * added to a group carries only what its repository did. A roll back — a
 * release whose sha is older than the one before it — carried nothing new.
 */
export function releaseCarried(input: {
  readonly entries: ReadonlyArray<ReleaseEntry>;
  /** The entries of every older release, nearest first; `[]` for the oldest. */
  readonly older: ReadonlyArray<ReadonlyArray<ReleaseEntry>>;
  /** `hostname → repository`. */
  readonly repositoryOf: ReadonlyMap<string, string>;
  /** `repository → its default branch's commits, newest first` — only the repositories read. */
  readonly commits: ReadonlyMap<string, ReadonlyArray<GiteaCommit>>;
}): ReadonlyArray<ReleaseServiceChange> {
  const changes: Array<ReleaseServiceChange> = [];
  for (const entry of input.entries) {
    const repository = input.repositoryOf.get(entry.service);
    if (repository === undefined) continue;
    const olderSha =
      olderCommit(input.older, (older) => older.service === entry.service) ??
      olderCommit(input.older, (older) => input.repositoryOf.get(older.service) === repository);
    if (olderSha !== undefined && olderSha.toLowerCase() === entry.commit.toLowerCase()) continue;
    if (changes.some((change) => change.repository === repository)) continue;
    const branch = input.commits.get(repository);
    if (branch === undefined) continue;
    const head = indexOnBranch(branch, entry.commit);
    if (head === -1) continue;
    const since = olderSha === undefined ? -1 : indexOnBranch(branch, olderSha);
    if (since !== -1 && since <= head) continue;
    changes.push({
      service: entry.service,
      repository,
      commits: since === -1 ? branch.slice(head) : branch.slice(head, since),
    });
  }
  return changes;
}

/**
 * `tag → what it carried`, for every release in a list read newest first —
 * each service against the nearest older release that lists it, so the whole
 * list must be passed even where only its head is shown: the last row drawn
 * is measured against the releases not drawn. A refused release never
 * deployed, so it is no release's baseline; one whose tag could not be read
 * lists nothing, so it is passed over.
 */
export function releasesCarried(input: {
  /** Newest first, the whole list. */
  readonly releases: ReadonlyArray<Pick<FlowRelease, "tag" | "entries" | "verdict">>;
  readonly repositoryOf: ReadonlyMap<string, string>;
  readonly commits: ReadonlyMap<string, ReadonlyArray<GiteaCommit>>;
}): ReadonlyMap<string, ReadonlyArray<ReleaseServiceChange>> {
  return new Map(
    input.releases.map((release, index) => [
      release.tag,
      releaseCarried({
        entries: release.entries,
        older: input.releases
          .slice(index + 1)
          .flatMap((older) => (older.verdict === "refused" ? [] : [older.entries])),
        repositoryOf: input.repositoryOf,
        commits: input.commits,
      }),
    ]),
  );
}

/** A release row's two lines: what it carried, over who, when and the shas. */
export interface ReleaseDescription {
  readonly primary: string;
  readonly secondary: string;
}

/**
 * What a release row says it carried: the newest commit's subject, the
 * service it moved only where it moved more than one, and how many more
 * commits came with it; under it, who wrote that commit and how long ago,
 * then the per-service shas the row said before (`line`).
 *
 * `undefined` where nothing carried is known — the row keeps its shas alone.
 * The author goes through {@link historyLine}, so a Mate's bot login is its
 * name here exactly as it is in the history.
 */
export function releaseDescription(
  changes: ReadonlyArray<ReleaseServiceChange>,
  /** `FlowReleaseRow.line`: the per-service shas. */
  line: string,
  now: number,
  names?: {
    readonly mateNames?: ReadonlyMap<string, string> | undefined;
    readonly groupName?: string | undefined;
  },
): ReleaseDescription | undefined {
  const [lead] = changes;
  const head = lead?.commits[0];
  if (lead === undefined || head === undefined) return undefined;
  const total = changes.reduce((sum, change) => sum + change.commits.length, 0);
  const primary =
    (changes.length > 1 ? `${lead.service}: ` : "") +
    head.subject +
    (total > 1 ? `, +${String(total - 1)} more` : "");
  const byline = historyLine(
    {
      sha: head.sha,
      shortSha: shortCommit(head.sha),
      subject: head.subject,
      author: head.author,
      at: head.at,
      deployedTo: [],
      tags: [],
    },
    now,
    names,
  );
  return { primary, secondary: byline === undefined ? line : `${byline} · ${line}` };
}

/** What a release row's chevron does, for a screen reader. */
export function releaseCarriedToggleLabel(tag: string, open: boolean): string {
  return `${open ? "Hide" : "Show"} what ${tag} carried`;
}
