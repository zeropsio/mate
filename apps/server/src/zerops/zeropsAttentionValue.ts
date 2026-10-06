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
import { resolvePrimaryConversation } from "@t3tools/shared/primaryConversation";
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

/**
 * The attention of `threads` from the source `source` names; `previous`, the value last published,
 * gives its revision: kept where nothing else changed, raised where anything did.
 */
export function mateAttentionOf(
  threads: Iterable<OrchestrationThreadShell>,
  previous: MateAttention | undefined,
  source: Omit<MateAttentionSource, "revision">,
): MateAttention {
  const chats = [...threads].filter(isPersonsChat);
  let working = 0;
  let last: OrchestrationThreadShell | undefined;
  const questions: Array<MateAttentionQuestion & { readonly at: number }> = [];
  const results: Array<MateAttentionResult> = [];
  for (const thread of chats) {
    if (last === undefined || Date.parse(thread.createdAt) > Date.parse(last.createdAt)) {
      last = thread;
    }
    const { kind } = resolveThreadStatus(thread);
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
  const body: Omit<MateAttention, "source"> = {
    mainThreadId: resolvePrimaryConversation(chats).primary?.id ?? null,
    lastThreadId: last?.id ?? null,
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
  };
  if (previous === undefined) return { source: { ...source, revision: 0 }, ...body };
  const { source: held, ...heldBody } = previous;
  if (JSON.stringify(heldBody) === JSON.stringify(body)) return previous;
  return { source: { ...source, revision: held.revision + 1 }, ...body };
}
