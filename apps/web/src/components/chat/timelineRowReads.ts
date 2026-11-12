/**
 * The rows of a conversation still reading what they show (an approved domain's records, read once
 * its card is drawn): while the conversation is placed out of sight, a row reading keeps it hidden
 * (`judgeTimelinePlacing`), so it does not grow under the reader once shown.
 */
import { createContext, use, useLayoutEffect } from "react";

export interface TimelineRowReads {
  /** A row begins to read; the returned call says it is done. */
  readonly hold: () => () => void;
  /** A row is about to stand at a height of its own saying; the returned call says it does. */
  readonly settle: () => () => void;
}

export const TimelineRowReadsCtx = createContext<TimelineRowReads | null>(null);

/** The rows' reads, counted: whether any still reads, or is about to settle its height. */
export function makeTimelineRowReads(): TimelineRowReads & {
  readonly reading: () => boolean;
  readonly settling: () => boolean;
} {
  const counts = { reading: 0, settling: 0 };
  const held = (which: keyof typeof counts) => () => {
    counts[which] += 1;
    let holds = true;
    return () => {
      if (!holds) return;
      holds = false;
      counts[which] -= 1;
    };
  };
  return {
    hold: held("reading"),
    settle: held("settling"),
    reading: () => counts.reading > 0,
    settling: () => counts.settling > 0,
  };
}

/** Says, from a row, that it still reads what it shows. Before paint, so placing hears it. */
export function useTimelineRowReading(reading: boolean): void {
  const reads = use(TimelineRowReadsCtx);
  useLayoutEffect(() => {
    if (!reading || reads === null) return;
    return reads.hold();
  }, [reading, reads]);
}

/**
 * Says, from a row, that it is about to stand at a height of its own saying (a page in its frame,
 * heard within a few frames; an access proposal's lines, come with a read under way): placing
 * waits for it, briefly (`TIMELINE_ROW_SETTLE_DEADLINE_MS`).
 */
export function useTimelineRowSettling(settling: boolean): void {
  const reads = use(TimelineRowReadsCtx);
  useLayoutEffect(() => {
    if (!settling || reads === null) return;
    return reads.settle();
  }, [settling, reads]);
}
