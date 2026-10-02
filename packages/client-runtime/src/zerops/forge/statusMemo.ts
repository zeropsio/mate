/**
 * A commit's statuses, read as seldom as what they say allows — for the readers that ask Gitea on a
 * clock of their own rather than through the forge store (`useZeropsGroupForge`,
 * `useZeropsGroupDeploys`).
 *
 * Statuses that are settled (at least one, none pending) are what no read changes: they are read
 * once and kept. Pending ones, and a commit CI has posted nothing to yet, are read again on
 * {@link STATUS_RECHECK_LADDER_MS}, a rung further each time the answer is the same and from the
 * bottom again when it moved. A release group whose thirty tags all point at one commit asked
 * Gitea about that commit thirty times a minute, every minute, in every open tab (pass 30, 2026-10-02:
 * 560 reads of one commit in 17.8 min); with the memo it is one read.
 *
 * @module forge/statusMemo
 */
import type { GiteaCommitStatus } from "../giteaClient.ts";

/** How long statuses that may still move are kept before the next read, rung by rung. */
export const STATUS_RECHECK_LADDER_MS: ReadonlyArray<number> = [
  15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
];

/**
 * Statuses no read changes: at least one, none pending. A commit read before CI posted anything
 * has none yet, and its first pending status is still to come.
 */
export const statusesSettled = (statuses: ReadonlyArray<GiteaCommitStatus>): boolean =>
  statuses.length > 0 && !statuses.some((status) => status.state === "pending");

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
  /** Drops an owner's unsettled statuses: a verb changed something, and the next read asks. */
  readonly forget: (owner: string) => void;
}

interface Kept {
  readonly owner: string;
  readonly statuses: ReadonlyArray<GiteaCommitStatus>;
  readonly signature: string;
  /** The ladder's rung the next read waits; `null` once settled. */
  readonly rung: number | null;
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
  const inFlight = new Map<string, Promise<ReadonlyArray<GiteaCommitStatus>>>();
  const keyOf = (commit: CommitRef) => `${commit.owner}/${commit.repo}@${commit.sha}`;

  const settle = (key: string, owner: string, statuses: ReadonlyArray<GiteaCommitStatus>) => {
    const previous = kept.get(key);
    const signature = signatureOf(statuses);
    if (statusesSettled(statuses)) {
      kept.set(key, { owner, statuses, signature, rung: null, nextAtMs: Number.POSITIVE_INFINITY });
      return;
    }
    const last = STATUS_RECHECK_LADDER_MS.length - 1;
    const rung =
      previous?.rung == null || previous.signature !== signature
        ? 0
        : Math.min(previous.rung + 1, last);
    kept.set(key, {
      owner,
      statuses,
      signature,
      rung,
      nextAtMs: now() + (STATUS_RECHECK_LADDER_MS[rung] ?? 0),
    });
  };

  return {
    read: (commit, load) => {
      const key = keyOf(commit);
      const held = kept.get(key);
      if (held !== undefined && now() < held.nextAtMs) return Promise.resolve(held.statuses);
      const running = inFlight.get(key);
      if (running !== undefined) return running;
      const read = load().then(
        (statuses) => {
          inFlight.delete(key);
          settle(key, commit.owner, statuses);
          return statuses;
        },
        (cause: unknown) => {
          inFlight.delete(key);
          throw cause;
        },
      );
      inFlight.set(key, read);
      return read;
    },
    forget: (owner) => {
      for (const [key, entry] of kept) {
        if (entry.owner === owner && entry.rung !== null) kept.delete(key);
      }
    },
  };
}
