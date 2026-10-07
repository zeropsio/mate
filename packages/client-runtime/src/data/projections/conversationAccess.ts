import type { ConversationAccess, ConversationView } from "../../zerops/environments/gate.ts";

/** An open transport and elapsed time supply no authority. Known stale content is usable only
 * while the current source authority permits it. */
export function conversationAccess(access: ConversationAccess): ConversationView {
  if (access.kind === "authorized") return { kind: "shown", until: null };
  return {
    kind: "suppressed",
    reason: access.kind === "lost" ? "access-denied" : access.reason,
  };
}
