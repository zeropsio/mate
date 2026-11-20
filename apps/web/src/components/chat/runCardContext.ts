import { createContext, use, useId, useState } from "react";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";

// ---------------------------------------------------------------------------
// The chat, drawn once
// ---------------------------------------------------------------------------

/**
 * Whether the chat has been drawn once: a bubble mounting after that arrived
 * while the person watched.
 */
export const ChatShownContext = createContext<{ readonly current: boolean } | null>(null);

/**
 * The run's scroll, to the lines in it: what the person opens there holds the
 * scroll where it stands, rather than following its foot; closing the last of
 * it lets it follow again (`followAfter`).
 */
export const RunScrollHoldContext = createContext<((key: string, opens: boolean) => void) | null>(
  null,
);

/**
 * Whether a bubble stands in the live slot (pass 35): drawn as the row it
 * becomes in the history, with no mark, time or chevron of its own — the
 * slot's face, clock and caps stand for them — and nothing to open.
 */
export const InSlotContext = createContext(false);

/** The key of the chat's line a bubble is drawn for: what its plop finds it by. */
export const ChatLineContext = createContext<string | null>(null);

/**
 * What the person opened in the run's card, by its line's key: a row the slot
 * showed lands in the history as it stood — opened, or at its cap — so its
 * plop moves it and never resizes it (pass 35).
 */
export const CarriedOpenContext = createContext<Map<string, Carried> | null>(null);

/** A line's state as carried: the person's own choice, or how the slot last drew it. */
export interface Carried {
  readonly value: boolean;
  /** The person set it: it holds wherever the line is drawn. */
  readonly own: boolean;
}

/**
 * A state of a line's, kept across its slot row and its history row. With
 * `follows`, the slot row draws it from what it shows now — a call's input
 * streams in after its start — until the person sets it, and the history row
 * takes it as the slot last drew it.
 */
export function useCarried(
  part: string,
  initial: () => boolean,
  follows = false,
  shut = false,
): [boolean, (next: boolean) => void] {
  const carried = use(CarriedOpenContext);
  const line = use(ChatLineContext);
  const inSlot = use(InSlotContext);
  const key = line === null ? null : `${line}#${part}`;
  const following = follows && inSlot;
  const [value, setValue] = useState<boolean | undefined>(() => {
    const kept = key === null ? undefined : carried?.get(key);
    if (kept !== undefined && (kept.own || !following)) return kept.value;
    if (following) return undefined;
    const first = initial();
    if (key !== null) carried?.set(key, { value: first, own: false });
    return first;
  });
  // Shut: it stands closed whatever it carried, and stays so after.
  if (shut && value !== false) {
    if (key !== null) carried?.set(key, { value: false, own: false });
    setValue(false);
  }
  const shown = shut ? false : (value ?? initial());
  if (value === undefined && key !== null && carried?.get(key)?.value !== shown) {
    carried?.set(key, { value: shown, own: false });
  }
  return [
    shown,
    (next) => {
      if (key !== null) carried?.set(key, { value: next, own: true });
      setValue(next);
    },
  ];
}

/**
 * In the live slot, the line of the one deploy that stands open on its card:
 * the newest running one — the others stay one line each, so the slot never
 * outgrows its room.
 */
export const SlotStandsOpenContext = createContext<string | null>(null);

/** Whether the line lands by a plop from the live slot: then it never rises in on its own. */
export const PlopsContext = createContext(false);

/** A call riding in a new card that lands by a plop: it rises in, the card plops. */
export const RidesContext = createContext(false);

/**
 * Whether the log draws lines over the ones in view in this commit — earlier
 * ones as the person scrolls up to them, ones set aside coming back: they
 * were there all along, and are simply there.
 */
export const DrawnEarlierContext = createContext<{ readonly current: boolean } | null>(null);

/** Whether this bubble arrived while the person watched: what the chat opened onto is simply there. */
function useArrivedLive(): boolean {
  const shown = use(ChatShownContext);
  const earlier = use(DrawnEarlierContext);
  // What a resync brings nobody watched happen: it is simply there.
  const { syncing } = use(TimelineRowCtx);
  const [arrived] = useState(
    () => (shown?.current ?? false) && !syncing && !(earlier?.current ?? false),
  );
  return arrived;
}

/**
 * Whether a bubble rises in as it arrives — in the history or in the slot,
 * once it was first drawn — never one landing by a plop.
 */
export function useRisesIn(): boolean {
  const arrived = useArrivedLive();
  // As it mounted: a line that landed by a plop never rises in later.
  const plopping = use(PlopsContext);
  const [plops] = useState(plopping);
  return arrived && !plops;
}

const HOLD_NOTHING = () => {};

/**
 * What the person opened or closed is theirs to read (K12): the conversation
 * stops following its end, and so does the run's scroll it stands in, so the
 * line they clicked stays where it is and only what is under it moves. Drawn
 * outside a conversation, it holds nothing. The run's scroll counts each
 * switch on its own: its `part` of the line keeps it one switch as the row
 * lands from the slot, and a holder of several names each (`which`).
 */
export function useHoldReading(part?: string): (opens: boolean, which?: string) => void {
  const ctx = use(TimelineRowCtx) as TimelineRowSharedState | null;
  const holdScroll = use(RunScrollHoldContext);
  const line = use(ChatLineContext);
  const id = useId();
  const key = line !== null && part !== undefined ? `${line}#${part}` : id;
  const holdPage = ctx?.onHoldReading ?? HOLD_NOTHING;
  return (opens, which) => {
    holdScroll?.(which === undefined ? key : `${key}#${which}`, opens);
    holdPage();
  };
}

/**
 * The pictures the settled run's result draws in its strip, by path: a step
 * that looked at one names it on its line and leaves the picture to the
 * strip, so an opened card never shows it twice (Bodhi, run 9).
 */
export const NO_PATHS: ReadonlySet<string> = new Set();
export const ResultPicturesContext = createContext<ReadonlySet<string>>(NO_PATHS);

/** Whether a call's card was drawn before the call joined it. */
export const CallGroupContext = createContext<{ readonly current: boolean } | null>(null);

/**
 * Whether a call is drawn in the list a folded row of quick calls opens onto
 * (`QuickCallsBubble`): one line of the list — its words at the quiet size,
 * no mark and no code beside it — that still opens what it ran and printed.
 */
export const ListedContext = createContext(false);
