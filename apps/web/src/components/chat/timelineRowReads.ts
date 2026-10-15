/**
 * The rows of a conversation still reading what they show (an approved domain's records, read once
 * its card is drawn): while the conversation is placed out of sight, a row reading keeps it hidden
 * (`judgeTimelinePlacing`), so it does not grow under the reader once shown.
 */
import { createContext, use, useLayoutEffect } from "react";

export interface TimelineRowReads {
  /** A row begins to read; the returned call says it is done. */
  readonly hold: () => () => void;
}

export const TimelineRowReadsCtx = createContext<TimelineRowReads | null>(null);

/** The rows' reads, counted: whether any still reads. */
export function makeTimelineRowReads(): TimelineRowReads & { readonly reading: () => boolean } {
  let count = 0;
  return {
    hold: () => {
      count += 1;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        count -= 1;
      };
    },
    reading: () => count > 0,
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
