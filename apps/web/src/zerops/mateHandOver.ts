/**
 * A Mate's own view handing over to its conversation (`ZeropsMateComingPage`): its Mate was at
 * work on the screen the whole wait, so the conversation's pane shows it at work at once rather
 * than after its usual 400 ms hold. In memory only, one per conversation, and forgotten when the
 * account closes.
 */
import { onAccountLifetimeClose } from "./accountLifetime";

/** How long after the hand-over the conversation counts as handed over. */
export const HANDED_OVER_FOR_MS = 5_000;

/** When each conversation was handed over, wall ms. */
const handOvers = new Map<string, number>();

onAccountLifetimeClose(() => handOvers.clear());

export function handOverMateConversation(threadKey: string, nowMs: number): void {
  handOvers.set(threadKey, nowMs);
}

/** Whether the conversation was handed over from its Mate's own view a moment ago. */
export function handedOverRecently(threadKey: string, nowMs: number): boolean {
  const atMs = handOvers.get(threadKey);
  return atMs !== undefined && nowMs - atMs < HANDED_OVER_FOR_MS;
}
