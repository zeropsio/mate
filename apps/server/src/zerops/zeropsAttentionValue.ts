/**
 * A Mate's attention (`@t3tools/contracts` `MateAttention`) from its chats: pure, the caller holds
 * the chats and the value it last published.
 *
 * @module zeropsAttentionValue
 */
import {
  MATE_ATTENTION_IDS_MAX,
  type MateAttention,
  type MateAttentionQuestion,
  type MateAttentionQuestionKind,
  type MateAttentionResult,
  type MateAttentionSource,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { linkFrameBytes, MATE_LINK_FRAME_MAX } from "@t3tools/shared/mateLink";
import { resolvePrimaryConversation } from "@t3tools/shared/primaryConversation";
import { projectMateLimit } from "../../../../packages/client-runtime/src/data/projections/mateLimit.ts";
import { mateMarkStateForThreadStatus, resolveThreadStatus } from "@t3tools/shared/threadStatus";

/** The person's chats: neither archived nor a crewmate's, which speaks through the crew. */
const isPersonsChat = (thread: OrchestrationThreadShell) =>
  thread.archivedAt === null && thread.crew === undefined;

const QUESTION_KINDS: ReadonlySet<string> = new Set<MateAttentionQuestionKind>([
  "approval",
  "input",
  "planReady",
  "failed",
]);

const isQuestionKind = (kind: string): kind is MateAttentionQuestionKind =>
  QUESTION_KINDS.has(kind);

type AttentionBody = Omit<MateAttention, "source">;

/**
 * `body` within one frame of the link (`MATE_LINK_FRAME_MAX`), whatever its revision: the oldest
 * entry of the longer list goes first, and the value is marked cut. Both paths — the link and a
 * client's stream — carry this same value.
 */
function fitted(source: Omit<MateAttentionSource, "revision">, body: AttentionBody): AttentionBody {
  const bytes = (candidate: AttentionBody) =>
    linkFrameBytes(
      JSON.stringify({
        type: "attention",
        attention: { source: { ...source, revision: Number.MAX_SAFE_INTEGER }, ...candidate },
      }),
    );
  let candidate = body;
  while (
    bytes(candidate) > MATE_LINK_FRAME_MAX &&
    (candidate.results.length > 0 || candidate.questions.length > 0)
  ) {
    candidate =
      candidate.results.length >= candidate.questions.length
        ? { ...candidate, results: candidate.results.slice(0, -1), truncated: true }
        : { ...candidate, questions: candidate.questions.slice(0, -1), truncated: true };
  }
  return candidate;
}

/**
 * The attention of `threads` from the source `source` names; `previous`, the value last published,
 * gives its revision: kept where nothing else changed, raised where anything did. `threads` come in
 * the order the Mate learned of them, so the last of the person's is its newest chat whatever time
 * its creation is stamped with, and a new chat always raises the revision.
 */
export function mateAttentionOf(
  threads: Iterable<OrchestrationThreadShell>,
  previous: MateAttention | undefined,
  source: Omit<MateAttentionSource, "revision">,
): MateAttention {
  const chats = [...threads].filter(isPersonsChat);
  let working = 0;
  const questions: Array<MateAttentionQuestion & { readonly at: number }> = [];
  const results: Array<MateAttentionResult> = [];
  for (const thread of chats) {
    const { kind } = resolveThreadStatus(
      thread,
      projectMateLimit(thread, Date.parse(thread.updatedAt)).kind,
    );
    const mark = mateMarkStateForThreadStatus(kind);
    if (mark === "working") working += 1;
    if (isQuestionKind(kind)) {
      questions.push({
        threadId: thread.id,
        kind,
        turnId: thread.latestTurn?.turnId ?? null,
        at: Date.parse(thread.updatedAt),
      });
    } else if (mark !== "working" && thread.latestTurn?.completedAt != null) {
      results.push({
        threadId: thread.id,
        turnId: thread.latestTurn.turnId,
        completedAt: thread.latestTurn.completedAt,
      });
    }
  }
  const body = fitted(source, {
    mainThreadId: resolvePrimaryConversation(chats).primary?.id ?? null,
    lastThreadId: chats.at(-1)?.id ?? null,
    working,
    waiting: questions.length,
    results: results
      .toSorted((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      .slice(0, MATE_ATTENTION_IDS_MAX),
    questions: questions
      .toSorted((left, right) => right.at - left.at)
      .slice(0, MATE_ATTENTION_IDS_MAX)
      .map(({ threadId, kind, turnId }) => ({ threadId, kind, turnId })),
    truncated: results.length > MATE_ATTENTION_IDS_MAX || questions.length > MATE_ATTENTION_IDS_MAX,
  });
  if (previous === undefined) return { source: { ...source, revision: 0 }, ...body };
  const { source: held, ...heldBody } = previous;
  if (JSON.stringify(heldBody) === JSON.stringify(body)) return previous;
  return { source: { ...source, revision: held.revision + 1 }, ...body };
}
