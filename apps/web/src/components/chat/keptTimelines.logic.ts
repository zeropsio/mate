/**
 * Which conversations' lists the pane keeps (`KeptTimelines`). A switch back
 * to a conversation seen a moment ago shows its rows where they stood, in the
 * frame the header changes: its list stays mounted, hidden, rather than being
 * placed again. The pane keeps the last few, by count; one whose Mate or
 * conversation is gone goes at once.
 *
 * One more may be warming: a conversation the person is about to open (the
 * menu row they rest on), mounted out of sight so its rows are placed before
 * the press. Only one warms at a time, never the one open, never one already
 * kept, and nothing warms while the pane is still placing the one it opened.
 */

/** A kept list, in the order it arrived: a list never moves in the page. */
export interface KeptTimeline {
  readonly key: string;
  /** When it was last the open one, as a count of opens. */
  readonly openedAt: number;
}

/** How many lists the pane keeps, the open one included. */
export const KEPT_TIMELINES_AT_MOST = 4;

export function keepTimelines(
  kept: ReadonlyArray<KeptTimeline>,
  input: {
    /** The open conversation's key. */
    readonly open: string;
    /** Whether a kept conversation may stay: its Mate and the conversation still there. */
    readonly alive: (key: string) => boolean;
    readonly atMost?: number;
  },
): ReadonlyArray<KeptTimeline> {
  const atMost = Math.max(1, input.atMost ?? KEPT_TIMELINES_AT_MOST);
  const latest = kept.reduce((most, slot) => Math.max(most, slot.openedAt), 0);
  const current = kept.find((slot) => slot.key === input.open);
  const opened =
    current !== undefined && current.openedAt === latest
      ? current
      : { key: input.open, openedAt: latest + 1 };
  let next = kept
    .filter((slot) => slot.key === input.open || input.alive(slot.key))
    .map((slot) => (slot.key === input.open ? opened : slot));
  if (current === undefined) next = [...next, opened];
  while (next.length > atMost) {
    const oldest = next
      .filter((slot) => slot.key !== input.open)
      .reduce((least, slot) => (slot.openedAt < least.openedAt ? slot : least));
    next = next.filter((slot) => slot !== oldest);
  }
  const same =
    next.length === kept.length &&
    next.every(
      (slot, index) => slot.key === kept[index]?.key && slot.openedAt === kept[index]?.openedAt,
    );
  return same ? kept : next;
}

/** The conversation to warm now, if any. */
export function warmingTimeline(input: {
  /** The newest conversation the person is about to open; null when none. */
  readonly asked: string | null;
  readonly open: string;
  readonly kept: ReadonlyArray<KeptTimeline>;
  /** The open conversation is still being placed. */
  readonly placing: boolean;
}): string | null {
  if (input.asked === null || input.placing || input.asked === input.open) return null;
  return input.kept.some((slot) => slot.key === input.asked) ? null : input.asked;
}
