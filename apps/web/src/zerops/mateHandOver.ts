/**
 * A Mate's own view handing over to its conversation (`ZeropsMateComingPage`,
 * and `MateOpeningView` on a reload):
 * what the conversation then carries on from it. Its Mate was at work on the
 * screen the whole wait, so the conversation's pane shows it at work at once
 * rather than after its usual 400 ms hold; and what the person typed into the
 * composer standing in while it connected is in the conversation's composer,
 * the caret where they left it. In memory only, one per conversation, and
 * forgotten when the account closes.
 */
import { onAccountLifetimeClose } from "./accountLifetime";

/** How long after the hand-over the conversation counts as handed over. */
export const HANDED_OVER_FOR_MS = 5_000;

interface HandOver {
  readonly atMs: number;
  /** Where the caret stood in what was typed; null when nothing was typed. */
  readonly caret: number | null;
}

const handOvers = new Map<string, HandOver>();
/** Conversations a stand-in stands for now, with the caret typed there. */
const standing = new Map<string, number | null>();

onAccountLifetimeClose(() => {
  handOvers.clear();
  standing.clear();
});

export function handOverMateConversation(
  threadKey: string,
  input: { readonly nowMs: number; readonly caret: number | null },
): void {
  handOvers.set(threadKey, { atMs: input.nowMs, caret: input.caret });
}

/** Whether the conversation was handed over from its Mate's own view a moment ago. */
export function handedOverRecently(threadKey: string, nowMs: number): boolean {
  if (standing.has(threadKey)) return true;
  const handOver = handOvers.get(threadKey);
  return handOver !== undefined && nowMs - handOver.atMs < HANDED_OVER_FOR_MS;
}

/** Where to put the caret in the conversation's composer, taken: it is told once. */
export function takeHandedOverCaret(threadKey: string, nowMs: number): number | null {
  const handOver = handOvers.get(threadKey);
  if (handOver === undefined || handOver.caret === null) return null;
  handOvers.set(threadKey, { ...handOver, caret: null });
  return nowMs - handOver.atMs < HANDED_OVER_FOR_MS ? handOver.caret : null;
}

/**
 * The conversation's draft once what was typed while it connected joins it:
 * after what it already held, on a line of its own, the caret where it stood
 * in what was typed.
 */
export function draftWithTyped(
  held: string,
  typed: { readonly text: string; readonly caret: number },
): { readonly prompt: string; readonly caret: number } {
  const caret = Math.min(Math.max(0, typed.caret), typed.text.length);
  if (typed.text.length === 0) return { prompt: held, caret: held.length };
  if (held.trim().length === 0) return { prompt: typed.text, caret };
  const prompt = `${held}\n\n${typed.text}`;
  return { prompt, caret: held.length + 2 + caret };
}

/**
 * A view standing in for the conversation until it takes over, the
 * conversation known from the start (`MateOpeningView`): the conversation
 * mounts while it still stands, and counts as handed over from then. Its
 * release is the hand-over.
 */
export function standInForConversation(threadKey: string): {
  readonly caret: (caret: number) => void;
  readonly release: (nowMs: number) => void;
} {
  standing.set(threadKey, null);
  return {
    caret: (caret) => {
      if (standing.has(threadKey)) standing.set(threadKey, caret);
    },
    release: (nowMs) => {
      const caret = standing.get(threadKey) ?? null;
      standing.delete(threadKey);
      handOverMateConversation(threadKey, { nowMs, caret });
    },
  };
}
