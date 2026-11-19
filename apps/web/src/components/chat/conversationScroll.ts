import type { MessageId } from "@t3tools/contracts";

/**
 * Drops the send-time anchored end space. That space is what holds a sent
 * message near the top while its turn streams, and it keeps LegendList's
 * maintainScrollAtEnd switched off for as long as it is installed — ChatView
 * drives the streaming scrolls itself, but only in "anchoring-new-turn" mode.
 * So every return to the live edge has to release the anchor too, otherwise the
 * timeline settles into "following-end" with nothing following anything.
 */
export function releaseChatTimelineAnchor<T extends { readonly messageId: MessageId | null }>(
  current: T,
): T {
  return current.messageId === null ? current : { ...current, messageId: null };
}

/** Whether the person asked for less motion: a scroll's way then is a cut. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
