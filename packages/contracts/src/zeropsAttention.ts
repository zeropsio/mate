/**
 * A Mate's attention (HANDOFF §4.2 "Mate"): one value with its source's revision, which every
 * surface that marks a Mate as working, waiting on its person, or done reads. The same value comes
 * straight from an open Mate and, for one nobody has open, relayed by HQ; both paths go into one
 * reducer, where a value replaces another only by its revision (never by a clock, never by which
 * transport is live).
 *
 * - **Source:** the Mate's environment, the incarnation of its attention (a new one each time the
 *   server starts, its revision starting again at 0) and the revision inside it, raised whenever
 *   anything else in the value changes — a new chat raises it even when no count moves.
 * - **Counts** are whole; the id lists are cut at {@link MATE_ATTENTION_IDS_MAX} each, newest
 *   first, and `truncated` says that a list was.
 * - **Results** are ids only: whether a person has seen one is HQ's to compute from that person's
 *   acknowledgements; the Mate holds no "unseen" count.
 *
 * @module zeropsAttention
 */
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

/** The most ids each list of a Mate's attention carries. */
export const MATE_ATTENTION_IDS_MAX = 50;

export const MateAttentionSource = Schema.Struct({
  environmentId: EnvironmentId,
  /** One run of the Mate's server: revisions order values only inside the same incarnation. */
  incarnation: TrimmedNonEmptyString,
  revision: NonNegativeInt,
});
export type MateAttentionSource = typeof MateAttentionSource.Type;

/** A chat's finished turn: the turn identifies the result, so a later one is a new result. */
export const MateAttentionResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
});
export type MateAttentionResult = typeof MateAttentionResult.Type;

/**
 * What a chat waits on its person for: an approval, an answer, a proposed plan, or a failed turn —
 * the kinds a Mate's mark draws as "needs you" (`mateMarkStateForThreadStatus`).
 */
export const MateAttentionQuestionKind = Schema.Literals([
  "approval",
  "input",
  "planReady",
  "failed",
]);
export type MateAttentionQuestionKind = typeof MateAttentionQuestionKind.Type;

/** A chat waiting on its person, at the turn it waits in (none before its first). */
export const MateAttentionQuestion = Schema.Struct({
  threadId: ThreadId,
  kind: MateAttentionQuestionKind,
  turnId: Schema.NullOr(TurnId),
});
export type MateAttentionQuestion = typeof MateAttentionQuestion.Type;

const atMostIds = Schema.isMaxLength(MATE_ATTENTION_IDS_MAX);

export const MateAttention = Schema.Struct({
  source: MateAttentionSource,
  /** The person's main chat (`resolvePrimaryConversation`); none before the first. */
  mainThreadId: Schema.NullOr(ThreadId),
  /** The person's newest chat, the last the Mate learned of; none before the first. */
  lastThreadId: Schema.NullOr(ThreadId),
  /** The person's chats the agent is on: connecting, working, monitoring. */
  working: NonNegativeInt,
  /** The person's chats waiting on them: every one {@link MateAttention.questions} would list. */
  waiting: NonNegativeInt,
  /** Finished turns of resting chats, the newest first. */
  results: Schema.Array(MateAttentionResult).check(atMostIds),
  /** Chats waiting on their person, the most recently moved first. */
  questions: Schema.Array(MateAttentionQuestion).check(atMostIds),
  /** Whether `results` or `questions` were cut at {@link MATE_ATTENTION_IDS_MAX}. */
  truncated: Schema.Boolean,
});
export type MateAttention = typeof MateAttention.Type;
