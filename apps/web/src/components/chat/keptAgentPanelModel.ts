/**
 * The helpers' panel model as the conversation last had it, while it holds
 * the same: the model is derived afresh from the thread's activities on every
 * update, and a new one for helpers nothing happened to re-drew every row of
 * the conversation (the rows read it through their shared context) and
 * derived the timeline again (`helperFinishesOf`).
 */
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";

import { sameValue } from "../../lib/sameValue";

/** Conversations whose model is kept: a few, the ones open now. */
const KEPT_CONVERSATIONS = 8;

const keptByConversation = new Map<string, AgentPanelModel>();

export function keptAgentPanelModel(
  conversationKey: string | null,
  model: AgentPanelModel,
): AgentPanelModel {
  if (conversationKey === null) return model;
  const kept = keptByConversation.get(conversationKey);
  if (kept !== undefined && sameValue(kept, model)) return kept;
  keptByConversation.delete(conversationKey);
  keptByConversation.set(conversationKey, model);
  if (keptByConversation.size > KEPT_CONVERSATIONS) {
    const oldest = keptByConversation.keys().next().value;
    if (oldest !== undefined) keptByConversation.delete(oldest);
  }
  return model;
}
