/**
 * Which thread *is* an environment's conversation.
 *
 * The product decision this implements: one environment is one agent is one
 * continuous conversation. Parallel work is another environment, not another
 * thread in the same one — a second thread would share the container's dev
 * server, browser and working tree with the first, and the two would collide.
 * The server already agrees: `ZeropsPolicy` forbids worktrees on Zerops
 * because "the isolation unit is a service, not a directory".
 *
 * **Threads are hidden, not removed.** Nothing here deletes a thread, and the
 * substrate — thread ids, routes, history, the server's whole orchestration —
 * is untouched. This module only answers "which one do we open", so the
 * sidebar can show a conversation where it used to show a list. That is what
 * keeps the door open to surfacing the others later (as tabs, say) with no
 * migration, and it is why an environment that already has several threads
 * degrades into this model rather than losing anything.
 *
 * ## The rule, and why it is not "most recently updated"
 *
 * `updatedAt` moves for reasons the user did not cause — a provider event, a
 * checkpoint, a token-usage refresh — and the index route already creates an
 * empty draft on landing. Sorting on it would let a freshly created empty
 * thread displace the conversation the user has been having all week, which is
 * the one failure this resolver must not have.
 *
 * So: a thread that has heard from the user always outranks one that has not,
 * and only then does recency decide. An explicitly chosen primary outranks
 * both, so the user can always overrule us.
 *
 * @module primaryConversation
 */

/**
 * The fields this needs from a thread shell. Structural on purpose: web's
 * `SidebarThreadSummary`, mobile's list row and a test fixture all satisfy it
 * without this module importing any of them.
 */
export interface ZeropsConversationCandidate {
  readonly id: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When the user last said something. Absent on a thread nobody has spoken in. */
  readonly latestUserMessageAt?: string | null;
  /** The user pinned this one as the environment's conversation. */
  readonly pinned?: boolean;
}

/** Why this thread was chosen — the UI may want to explain itself, and tests must. */
export type ZeropsPrimaryConversationReason = "pinned" | "spoken" | "newest" | "none";

export interface ZeropsPrimaryConversation<T extends ZeropsConversationCandidate> {
  /** The conversation to open, or `undefined` when the environment has none yet. */
  readonly primary: T | undefined;
  /**
   * Everything else, newest first — never shown by default, always reachable.
   * Its length is the "N other conversations" affordance.
   */
  readonly hidden: ReadonlyArray<T>;
  readonly reason: ZeropsPrimaryConversationReason;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Ranks two candidates. Higher is more primary.
 *
 * Ties break on `id` so the answer never depends on the order the server
 * happened to return threads in — two clients showing the same environment
 * must open the same conversation.
 */
function compare(left: ZeropsConversationCandidate, right: ZeropsConversationCandidate): number {
  if (left.pinned !== right.pinned) return left.pinned === true ? -1 : 1;

  const leftSpoken = timestamp(left.latestUserMessageAt);
  const rightSpoken = timestamp(right.latestUserMessageAt);
  if (leftSpoken > 0 !== rightSpoken > 0) return leftSpoken > 0 ? -1 : 1;
  if (leftSpoken !== rightSpoken) return rightSpoken - leftSpoken;

  const byUpdated = timestamp(right.updatedAt) - timestamp(left.updatedAt);
  if (byUpdated !== 0) return byUpdated;

  const byCreated = timestamp(right.createdAt) - timestamp(left.createdAt);
  if (byCreated !== 0) return byCreated;

  return left.id.localeCompare(right.id);
}

/**
 * Splits an environment's threads into the one conversation and the rest.
 *
 * Archived threads are excluded outright: archiving is the user saying they
 * are done with it, and resurrecting one as the environment's conversation
 * would be the opposite of what they asked for.
 */
export function resolvePrimaryConversation<T extends ZeropsConversationCandidate>(
  threads: ReadonlyArray<T>,
): ZeropsPrimaryConversation<T> {
  const live = threads.filter((thread) => thread.archivedAt === null);
  if (live.length === 0) return { primary: undefined, hidden: [], reason: "none" };

  const ranked = [...live].sort(compare);
  const [primary, ...hidden] = ranked as [T, ...Array<T>];

  const reason: ZeropsPrimaryConversationReason =
    primary.pinned === true
      ? "pinned"
      : timestamp(primary.latestUserMessageAt) > 0
        ? "spoken"
        : "newest";

  return { primary, hidden, reason };
}
