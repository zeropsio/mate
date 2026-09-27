/**
 * Which of an environment's chats is its main one.
 *
 * A Mate is one agent with several chats over one tree: the same name and
 * face, the same working tree, the same coding agent in each. Chats are not
 * isolated — two can run at once over the same files, the way two terminals
 * can — and isolation is what a crewmate's own copy is for, never a chat.
 * The main chat is where every surface that opens "the Mate" lands: the
 * sidebar row, the index route, asking the Mate, its activity. The
 * conversation strip shows the others.
 *
 * **The main chat is the pinned one.** When a second chat is started the
 * first is pinned, so this keeps answering "pinned" and nothing that opened
 * the Mate before chats existed moves; *Make main* moves the pin. No pin is
 * written until a second chat is started, and an environment that already
 * holds several unpinned threads degrades into this model rather than losing
 * any.
 *
 * ## Without a pin, the rule is not "most recently updated"
 *
 * `updatedAt` moves for reasons the user did not cause — a provider event, a
 * checkpoint, a token-usage refresh — and the index route already creates an
 * empty draft on landing. Sorting on it would let a freshly created empty
 * thread displace the conversation the user has been having all week, which is
 * the one failure this resolver must not have.
 *
 * So: a thread that has heard from the user always outranks one that has not,
 * and only then does recency decide. A pinned chat outranks both, so the user
 * can always overrule us.
 *
 * @module primaryConversation
 */
import type { ThreadCrewOrigin } from "@t3tools/contracts";

/**
 * The fields this needs from a thread shell. Structural on purpose: a thread
 * shell and a test fixture both satisfy it without this module importing
 * either.
 */
export interface ZeropsConversationCandidate {
  readonly id: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When the user last said something. Absent on a thread nobody has spoken in. */
  readonly latestUserMessageAt?: string | null;
  /** When the user pinned this one as the environment's main chat; null or absent when not. */
  readonly pinnedAt?: string | null | undefined;
  /** Set on a crewmate's thread, which the server made: never the person's conversation. */
  readonly crew?: ThreadCrewOrigin | undefined;
}

/** Why this thread was chosen — the UI may want to explain itself, and tests must. */
export type ZeropsPrimaryConversationReason = "pinned" | "spoken" | "newest" | "none";

export interface ZeropsPrimaryConversation<T extends ZeropsConversationCandidate> {
  /** The conversation to open, or `undefined` when the environment has none yet. */
  readonly primary: T | undefined;
  /** The Mate's other chats, most primary first — the conversation strip shows them. */
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
  const leftPinned = left.pinnedAt != null;
  if (leftPinned !== (right.pinnedAt != null)) return leftPinned ? -1 : 1;

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
 * Splits an environment's threads into the main chat and the rest.
 *
 * Archived threads are excluded outright: archiving is the user saying they
 * are done with it, and resurrecting one as the environment's conversation
 * would be the opposite of what they asked for. A crewmate's thread is
 * excluded too, from `hidden` as well: it is the crew's conversation, not one
 * the person had, and the server's task cards would otherwise rank it spoken.
 */
export function resolvePrimaryConversation<T extends ZeropsConversationCandidate>(
  threads: ReadonlyArray<T>,
): ZeropsPrimaryConversation<T> {
  const live = threads.filter((thread) => thread.archivedAt === null && thread.crew === undefined);
  if (live.length === 0) return { primary: undefined, hidden: [], reason: "none" };

  const ranked = [...live].sort(compare);
  const [primary, ...hidden] = ranked as [T, ...Array<T>];

  const reason: ZeropsPrimaryConversationReason =
    primary.pinnedAt != null
      ? "pinned"
      : timestamp(primary.latestUserMessageAt) > 0
        ? "spoken"
        : "newest";

  return { primary, hidden, reason };
}
