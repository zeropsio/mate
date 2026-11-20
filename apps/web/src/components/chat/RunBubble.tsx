import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// A bubble
// ---------------------------------------------------------------------------

/**
 * The log is a ledger (the owner's board, 2026-11-10: "one quiet log, one loud
 * now"): what the Mate did and thought are rows on the tray, no box around
 * any of them, told apart by the mark each wears in the Mate's column — a
 * stack of equal boxes let nothing lead. What it said to the person is the
 * one bubble in it, in its tint, 12 px in and 8 px down; the person's own
 * words keep their bubble on their side.
 */
export const BUBBLE_SHAPE = "rounded-2xl";
export const BUBBLE_PAD = "px-3.5 py-2.5";
/** The Mate's words: one round of 12 px, hugging what it says. */
const SPEECH_SHAPE = "w-fit max-w-full rounded-card";
export const SPEECH_PAD = "px-3 py-2 leading-5";

/**
 * The chat's two sizes, by weight (K14): what anyone said — the person's
 * words, the Mate's — at the prose size, 14 px; everything else at 13 px,
 * quieter: what it did (a call's row), what it thought, a time, a caption,
 * the way to more, code.
 */
export const WORDS = "text-prose";
export const META = "text-line";
/** A row's first line in the log: what it did, 14 px on the card's 20 px line. */
export const ROW = "text-prose leading-5";

/** How a bubble reads: its words to the person, a thought, a thing it did — and in what state. */
type BubbleTone = "speech" | "thought" | "tool";

const BUBBLE_TONE: Record<BubbleTone, string> = {
  // Its words to the person: its own tint, lightly (`.run-speech`) — the log's one bubble.
  speech: `run-speech text-foreground overflow-hidden ${SPEECH_SHAPE}`,
  // Talking to itself: plain words on the tray, quiet.
  thought: "w-full text-muted-foreground",
  // A thing it did: a row on the tray.
  tool: "w-full text-foreground",
};

/**
 * A line's box in the Mate's column: a row as wide as the column, or the
 * Mate's words in their bubble. Named a bubble for what reads it — the
 * card's motion, the page's probes — whatever surface it has.
 */
export function Bubble({
  tone,
  kind,
  size = WORDS,
  className,
  children,
}: {
  readonly tone: BubbleTone;
  /** What the bubble stands for, for the page's own tests and probes. */
  readonly kind: string;
  /** Its words' size: said at the prose size, thought at the quiet one. */
  readonly size?: typeof WORDS | typeof META | typeof ROW;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn("min-w-0", size, BUBBLE_TONE[tone], className)}
      data-chat-bubble={tone}
      data-chat-kind={kind}
    >
      {children}
    </div>
  );
}

/** Only an open the person made rises; a carried, a first or a landing one is simply there. */
export function rises(made: boolean): string | false {
  return made && "animate-detail-in motion-reduce:animate-none";
}
