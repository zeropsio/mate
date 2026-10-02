/**
 * A commit's statuses, read as seldom as what they say allows — for the readers that ask Gitea on a
 * clock of their own rather than through the forge store (`useZeropsGroupForge`,
 * `useZeropsGroupDeploys`).
 *
 * Statuses that are settled (every context's newest one done) are kept until they are forgotten:
 * no read can change them. Pending ones, and a commit CI has posted nothing to yet, are read again
 * on {@link STATUS_RECHECK_LADDER_MS}, a rung further each time the answer is the same and from the
 * bottom again when it moved, never more than a minute apart. What may post to a settled commit
 * again forgets it: a verb, a group whose deploys moved, or a push the org's listing shows
 * (`forge/forgeReads.ts`).
 *
 * A release group whose thirty tags all point at one commit asked Gitea about that commit thirty
 * times a minute, every minute, in every open tab (pass 30, 2026-10-02: 560 reads of one commit in
 * 17.8 min); with the memo it is one read. Kept for five minutes, and for one minute on the newest
 * release and every deploy, settled statuses were still read again on every tick of a page left
 * open (pass 31, 2026-10-02: one group repo's release commit about once a minute, 60 reads).
 *
 * @module forge/statusMemo
 */
import type { GiteaCommitStatus } from "../giteaClient.ts";

/** How long statuses that may still move are kept before the next read, rung by rung. */
export const STATUS_RECHECK_LADDER_MS: ReadonlyArray<number> = [15_000, 30_000, 60_000];

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
   * The commit's statuses: what is kept while no read can have changed them yet, otherwise one
   * `load` — shared with whoever asks for the same commit while it runs. A load that fails keeps
   * nothing and rejects.
   */
  readonly read: (
    commit: CommitRef,
    load: () => Promise<ReadonlyArray<GiteaCommitStatus>>,
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
  /** The back-off's rung the next read waits; `null` once settled. */
  readonly rung: number | null;
  /** When the next read may ask Gitea; never, once settled. */
  readonly nextAtMs: number;
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
    const { owner, repo } = commit;
    const previous = kept.get(key);
    const signature = signatureOf(statuses);
    if (newestStatusesSettled(statuses)) {
      kept.set(key, {
        owner,
        repo,
        statuses,
        signature,
        rung: null,
        nextAtMs: Number.POSITIVE_INFINITY,
      });
      return;
    }
    const last = STATUS_RECHECK_LADDER_MS.length - 1;
    const rung =
      previous?.rung == null || previous.signature !== signature
        ? 0
        : Math.min(previous.rung + 1, last);
    kept.set(key, {
      owner,
      repo,
      statuses,
      signature,
      rung,
      nextAtMs: readAtMs + (STATUS_RECHECK_LADDER_MS[rung] ?? 0),
    });
  };

  return {
    read: (commit, load) => {
      const key = keyOf(commit);
      const held = kept.get(key);
      const at = now();
      if (held !== undefined && at < held.nextAtMs) {
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
