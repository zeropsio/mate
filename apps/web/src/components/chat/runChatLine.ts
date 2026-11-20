import type { ReactNode } from "react";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { MarkLine } from "./RunMarks";
import type { Rooms } from "./runRoom";
import type { Travels } from "./runTravel";

export type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

/** A line of the chat: its key, stable from its first sight, and where it stands. */
export interface ChatLine {
  readonly key: string;
  readonly bubble: ReactNode;
  /** What kind of bubble it is, in the Mate's column beside it; a call wears its own. */
  readonly mark?: ReactNode;
  /** The first line its mark stands beside: the words' by default. */
  readonly markLine?: MarkLine;
  /** A caption across the chat, off the Mate's column. */
  readonly across?: boolean;
  /** The person's words, on their side of the chat. */
  readonly theirs?: boolean;
  /** A thing it did: a row of the card its run of calls shares. */
  readonly call?: boolean;
  /** The Mate's question: the person's answer under it pairs with it. */
  readonly asks?: boolean;
  /** The Mate's words to the person, the log's one bubble: more room over and under it than a row gets. */
  readonly said?: boolean;
  /** An answer under its question, 6 px under it — a pair, not two lines (K14). */
  readonly pairs?: boolean;
  /** It lands from the live slot by a plop, rather than rising in. */
  readonly plops?: boolean;
}

/** What the chat draws: a line on its own, or a run of calls in one card, keyed by its first. */
export type ChatEntry =
  | ChatLine
  | { readonly key: string; readonly calls: ReadonlyArray<ChatLine> };

/**
 * The chat's lines with each run of calls gathered into one card. A call only
 * ever joins the card at the end, so what arrives grows the last card and
 * never re-keys one above it.
 */
export function gatherCalls(lines: ReadonlyArray<ChatLine>): ReadonlyArray<ChatEntry> {
  const entries: ChatEntry[] = [];
  for (const line of lines) {
    const last = entries.at(-1);
    if (line.call !== true) entries.push(line);
    else if (last !== undefined && "calls" in last) {
      entries[entries.length - 1] = { key: last.key, calls: [...last.calls, line] };
    } else entries.push({ key: `calls:${line.key}`, calls: [line] });
  }
  return entries;
}

/**
 * The boxes in a run's chat whose height eases as what they hold grows
 * (`easeRooms`): a bubble, a card of calls, and a deploy's step, which gains
 * its failure or its log under it as it ends — eased there, the steps under
 * it ride its edge instead of dropping 32 px in a frame (R12-26).
 */
export const EASED_BOXES = "[data-chat-bubble],[data-chat-calls],[data-zerops-pipeline-step]";

/** What the motions of a run's card share: the live slot's rooms, read by the history beside it. */
export interface RunMotion {
  slot: Rooms | null;
  /**
   * The travels of the card (`runTravel`): what one draw changes — the slot's
   * room, the history's, the card's own, the rows a landing moves — goes by one.
   */
  readonly travels: Travels;
  /**
   * How the history keeps to its foot, while one is drawn: called in each
   * frame a box of the card eased, once it shows its height (`afterStep`).
   */
  keep: (() => void) | null;
}
