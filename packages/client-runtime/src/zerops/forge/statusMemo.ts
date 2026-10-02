/**
 * A commit's statuses, read as seldom as what they say allows — for the readers that ask Gitea on a
 * clock of their own rather than through the forge store (`useZeropsGroupForge`,
 * `useZeropsGroupDeploys`).
 *
 * Statuses that are settled (every context's newest one done) are kept for
 * {@link SETTLED_STATUS_KEEP_MS}, or as long as the caller's `maxAgeMs` allows where a deploy may be
 * posting to the commit. Pending ones, and a commit CI has posted nothing to yet, are read again on
 * {@link STATUS_RECHECK_LADDER_MS}, a rung further each time the answer is the same and from the
 * bottom again when it moved, never more than a minute apart. A verb, or a group whose deploys
 * moved, forgets an owner's commits and the reads running for them.
 *
 * A release group whose thirty tags all point at one commit asked Gitea about that commit thirty
 * times a minute, every minute, in every open tab (pass 30, 2026-10-02: 560 reads of one commit in
 * 17.8 min); with the memo it is one read.
 *
 * @module forge/statusMemo
 */
import type { GiteaCommitStatus } from "../giteaClient.ts";

/** How long statuses that may still move are kept before the next read, rung by rung. */
export const STATUS_RECHECK_LADDER_MS: ReadonlyArray<number> = [15_000, 30_000, 60_000];

/**
 * How long settled statuses are kept. Not for ever: a commit takes a new context when a stage's
 * commit is released to production, and another tab's release posts to it too.
 */
export const SETTLED_STATUS_KEEP_MS = 5 * 60_000;

/**
 * How old statuses a deploy may still be posting to are let be: a commit a stage or production
 * runs, and the newest release. The group readers' own clock, so they lag no more than it does.
 */
export const DEPLOY_STATUS_MAX_AGE_MS = 60_000;

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
   * The commit's statuses: what is kept while no read can have changed them yet and it is no older
   * than `maxAgeMs`, otherwise one `load` — shared with whoever asks for the same commit while it
   * runs. A load that fails keeps nothing and rejects.
   */
  readonly read: (
    commit: CommitRef,
    load: () => Promise<ReadonlyArray<GiteaCommitStatus>>,
    options?: { readonly maxAgeMs?: number | undefined },
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
  readonly readAtMs: number;
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
        readAtMs,
        nextAtMs: readAtMs + SETTLED_STATUS_KEEP_MS,
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
      readAtMs,
      nextAtMs: readAtMs + (STATUS_RECHECK_LADDER_MS[rung] ?? 0),
    });
  };

  return {
    read: (commit, load, readOptions) => {
      const key = keyOf(commit);
      const held = kept.get(key);
      const at = now();
      const maxAgeMs = readOptions?.maxAgeMs ?? Number.POSITIVE_INFINITY;
      if (held !== undefined && at < held.nextAtMs && at - held.readAtMs < maxAgeMs) {
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
