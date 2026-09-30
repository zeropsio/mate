/**
 * What a door asked to be told of a Mate's conversation while the Mate's own view waits for it
 * (`useOpenMate`, `ZeropsMateComingPage`) — its Crew tab to open, an ask to write in its composer.
 * One per Mate, the newest door's; the view tells it the conversation it hands over to, and a view
 * left before then forgets it. In memory only, and forgotten when the account closes.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { onAccountLifetimeClose } from "./accountLifetime";

export type OnMateConversation = (conversation: ScopedThreadRef) => void;

const waiting = new Map<string, OnMateConversation>();

onAccountLifetimeClose(() => waiting.clear());

/** Holds `then` for the Mate's view to tell; no `then` forgets what an earlier door asked. */
export function awaitMateConversation(projectId: string, then: OnMateConversation | undefined) {
  if (then === undefined) waiting.delete(projectId);
  else waiting.set(projectId, then);
}

/** What a door asked to be told of this Mate's conversation, taken: it is told once. */
export function takeMateConversation(projectId: string): OnMateConversation | undefined {
  const then = waiting.get(projectId);
  waiting.delete(projectId);
  return then;
}
