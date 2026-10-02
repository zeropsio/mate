/**
 * A commit's statuses, read as seldom as what they say allows — for the readers that ask Gitea on a
 * clock of their own rather than through the forge store (`useZeropsGroupForge`,
 * `useZeropsGroupDeploys`).
 *
 * Statuses that are settled (every context's newest one done, or what the reader waits for done)
 * are kept until they are forgotten — unless the reader says the commit still takes contexts
 * after that (`live`): a commit a service runs, a pull request's head, the newest release. Those
 * are read again on {@link SETTLED_RECHECK_LADDER_MS}, so a context that lands after the others
 * settled — a deploy failing, a second workflow, the broker's verdict on a tag that shares an older
 * one's commit — is seen within minutes. Pending ones, and a commit CI has posted nothing to yet,
 * are read again on {@link STATUS_RECHECK_LADDER_MS}. Each back-off goes a rung further each time
 * the answer is the same, and from the bottom again when it moved. A verb, a group whose deploys
 * moved, or a push the org's listing shows forgets an owner's commits (`forge/forgeReads.ts`).
 *
 * A release group whose thirty tags all point at one commit asked Gitea about that commit thirty
 * times a minute, every minute, in every open tab (pass 30, 2026-10-02: 560 reads of one commit in
 * 17.8 min); with the memo it is one read. Kept for one minute on the newest release and every
 * deploy, settled statuses were read again on every tick of a page left open (pass 31,
 * 2026-10-02: one group repo's release commit about once a minute, 60 reads); kept for ever, a
 * refusal the broker posts after the verb's own re-read was never seen.
 *
 * @module forge/statusMemo
 */
import type { GiteaCommitStatus } from "../giteaClient.ts";

/** How long statuses that may still move are kept before the next read, rung by rung. */
export const STATUS_RECHECK_LADDER_MS: ReadonlyArray<number> = [15_000, 30_000, 60_000];

/** How long settled statuses of a commit that still takes contexts are kept, rung by rung. */
export const SETTLED_RECHECK_LADDER_MS: ReadonlyArray<number> = [60_000, 120_000, 300_000];

/** What one reader needs of a commit's statuses. */
export interface StatusReadOptions {
  /** When what this reader waits for is done; every context's newest one, by default. */
  readonly settled?: ((statuses: ReadonlyArray<GiteaCommitStatus>) => boolean) | undefined;
  /** The commit still takes contexts once settled: read it again on the settled back-off. */
  readonly live?: boolean | undefined;
}

/**
 * Statuses no read changes: at least one, none pending. A commit read before CI posted anything
 * has none yet, and its first pending status is still to come. The forge store's finality.
 */
export const statusesSettled = (statuses: ReadonlyArray<GiteaCommitStatus>): boolean =>
  statuses.length > 0 && !statuses.some((status) => status.state === "pending");

/**
 * Every context's newest status is done. Gitea lists a commit's statuses newest first and keeps
 * every one it was ever given, so a context that went pending → success still lists its pending.
 */
export function newestStatusesSettled(statuses: ReadonlyArray<GiteaCommitStatus>): boolean {
  const seen = new Set<string>();
  let settled = statuses.length > 0;
  for (const status of statuses) {
    if (seen.has(status.context)) continue;
    seen.add(status.context);
    if (status.state === "pending") settled = false;
  }
  return settled;
}

export interface CommitRef {
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
}

export interface CommitStatusMemo {
  /**
   * The commit's statuses: what is kept while, for this reader, no read can have changed them
   * yet, otherwise one `load` — shared with whoever asks for the same commit while it runs. A load
   * that fails keeps nothing and rejects.
   */
  readonly read: (
    commit: CommitRef,
    load: () => Promise<ReadonlyArray<GiteaCommitStatus>>,
    options?: StatusReadOptions,
  ) => Promise<ReadonlyArray<GiteaCommitStatus>>;
  /**
   * Drops everything kept and every read running for an owner — or for one of its repositories: a
   * verb changed its commits, and the next read asks Gitea, never a read that started before it.
   */
  readonly forget: (owner: string, repo?: string) => void;
}

interface Kept {
  readonly owner: string;
  readonly repo: string;
  readonly statuses: ReadonlyArray<GiteaCommitStatus>;
  readonly signature: string;
  /** When the read that answered it was asked. */
  readonly readAtMs: number;
  /** How many reads before this one answered the same: the back-off's rung. */
  readonly same: number;
}

/** How long `held` answers for a reader asking with `options`. */
function keepsFor(held: Kept, options: StatusReadOptions | undefined): number {
  const settled = (options?.settled ?? newestStatusesSettled)(held.statuses);
  const ladder = !settled
    ? STATUS_RECHECK_LADDER_MS
    : options?.live === true
      ? SETTLED_RECHECK_LADDER_MS
      : undefined;
  if (ladder === undefined) return Number.POSITIVE_INFINITY;
  return ladder[Math.min(held.same, ladder.length - 1)] ?? 0;
}

const signatureOf = (statuses: ReadonlyArray<GiteaCommitStatus>): string =>
  statuses
    .map((status) => `${status.context}\u0000${status.state}`)
    .sort()
    .join("\n");

export function createCommitStatusMemo(
  options: { readonly now?: () => number } = {},
): CommitStatusMemo {
  const now = options.now ?? Date.now;
  const kept = new Map<string, Kept>();
  const inFlight = new Map<
    string,
    {
      readonly owner: string;
      readonly repo: string;
      readonly read: Promise<ReadonlyArray<GiteaCommitStatus>>;
    }
  >();
  /** Bumped by `forget`, per repository: a read that started under an older one keeps nothing. */
  const generations = new Map<string, number>();
  const repoKey = (owner: string, repo: string) => `${owner}/${repo}`;
  const keyOf = (commit: CommitRef) => `${commit.owner}/${commit.repo}@${commit.sha}`;

  /** `readAtMs` is when the read was asked, not when it answered: a clock's next ask is as old. */
  const settle = (
    key: string,
    commit: CommitRef,
    statuses: ReadonlyArray<GiteaCommitStatus>,
    readAtMs: number,
  ) => {
    const previous = kept.get(key);
    const signature = signatureOf(statuses);
    const same = previous?.signature === signature ? previous.same + 1 : 0;
    kept.set(key, { owner: commit.owner, repo: commit.repo, statuses, signature, readAtMs, same });
  };

  return {
    read: (commit, load, readOptions) => {
      const key = keyOf(commit);
      const held = kept.get(key);
      const at = now();
      if (held !== undefined && at - held.readAtMs < keepsFor(held, readOptions)) {
        return Promise.resolve(held.statuses);
      }
      const running = inFlight.get(key);
      if (running !== undefined) return running.read;
      const scope = repoKey(commit.owner, commit.repo);
      const generation = generations.get(scope) ?? 0;
      const current = () => (generations.get(scope) ?? 0) === generation;
      const read = load().then(
        (statuses) => {
          if (current()) {
            inFlight.delete(key);
            settle(key, commit, statuses, at);
          }
          return statuses;
        },
        (cause: unknown) => {
          if (current()) inFlight.delete(key);
          throw cause;
        },
      );
      inFlight.set(key, { owner: commit.owner, repo: commit.repo, read });
      return read;
    },
    forget: (owner, repo) => {
      const covers = (entry: { readonly owner: string; readonly repo: string }) =>
        entry.owner === owner && (repo === undefined || entry.repo === repo);
      const repos = new Set<string>();
      for (const [key, entry] of kept) {
        if (!covers(entry)) continue;
        kept.delete(key);
        repos.add(repoKey(entry.owner, entry.repo));
      }
      for (const [key, entry] of inFlight) {
        if (!covers(entry)) continue;
        inFlight.delete(key);
        repos.add(repoKey(entry.owner, entry.repo));
      }
      for (const scope of repos) generations.set(scope, (generations.get(scope) ?? 0) + 1);
    },
  };
}
