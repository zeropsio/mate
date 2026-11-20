import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { type LegendListRef } from "@legendapp/list/react";
import {
  classifyTimelineScroll,
  jumpedAway,
  nextTimelineReading,
  personIsScrolling,
  type TimelineScrollDirection,
  type TimelineScrollReading,
} from "@t3tools/client-runtime/zerops/timelineFollow";
import { takeOwnScroll } from "./timelineEndFollow";
import { wheelHandedToList } from "./timelineScrollTarget";
import { resolveTimelineRowTop, resolveTimelineRowHeight } from "./timelineRowGeometry";
import {
  resolveTimelineMinimapCurrentIndex,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { type TimelineMinimapItem } from "./timelineMinimapItems";
import { type useTimelineMotion } from "./useTimelineMotion";
import { type useTimelinePersonInput } from "./useTimelinePersonInput";

/** Each scroll of the list, read: whose it was, whether it left the end, where the person reads, the minimap's marks. */
export function useTimelineScrollReading({
  listRef,
  motion,
  person,
  restoringReadingPosition,
  rows,
  rememberPosition,
  onIsAtEndChange,
  minimapItems,
  minimapStripMap,
  setMinimapCurrentIndex,
}: {
  listRef: RefObject<LegendListRef | null>;
  motion: ReturnType<typeof useTimelineMotion>;
  person: ReturnType<typeof useTimelinePersonInput>;
  restoringReadingPosition: boolean;
  rows: MessagesTimelineRow[];
  rememberPosition: () => boolean | undefined;
  onIsAtEndChange: (
    isAtEnd: boolean,
    scroll: {
      readonly byPerson: boolean;
      readonly direction: TimelineScrollDirection | null;
      readonly jumped?: boolean;
    },
  ) => void;
  minimapItems: TimelineMinimapItem[];
  minimapStripMap: Map<string, HTMLSpanElement>;
  setMinimapCurrentIndex: Dispatch<SetStateAction<number | null>>;
}) {
  const { placeFolds, followingEndRef, listPlacedRef, followEnd } = motion;
  const { personSessionRef, notePersonSession, wheelLatchRef, onPersonInputRef } = person;
  // Where the list stood at the last read: what tells which way it moved since.
  const lastReadingRef = useRef<TimelineScrollReading | null>(null);

  const readList = useCallback(
    (personScrolling: boolean) => {
      const node = listRef.current?.getScrollableNode();
      const own = node ? takeOwnScroll(node) : undefined;
      placeFolds();
      const reading = node ? { scrollTop: node.scrollTop, contentHeight: node.scrollHeight } : null;
      // The browser carried a wheel gesture of a nested scroller on into the list: the reader
      // took the list, and the wheel's leave or return is told as theirs.
      const now = performance.now();
      const handed =
        own === undefined && reading
          ? wheelHandedToList(wheelLatchRef.current, {
              at: now,
              ...classifyTimelineScroll({
                previous: lastReadingRef.current,
                current: reading,
                personScrolling: true,
              }),
            })
          : null;
      if (handed !== null) {
        wheelLatchRef.current = handed;
        notePersonSession({ type: "input", at: now });
        onPersonInputRef.current({ kind: "wheel", direction: handed.direction });
      }
      const scroll = reading
        ? {
            ...classifyTimelineScroll({
              previous: lastReadingRef.current,
              current: reading,
              personScrolling: own === undefined && (personScrolling || handed !== null),
            }),
            // A jump far up that no change of the content explains — find in
            // page, a fragment link, focus moving — leaves the end, whoever
            // made it; the page's own moves never do.
            jumped: !own && jumpedAway({ previous: lastReadingRef.current, current: reading }),
          }
        : { byPerson: false, direction: null };
      lastReadingRef.current = reading && nextTimelineReading(lastReadingRef.current, reading);
      notePersonSession({ type: "scrolled", at: performance.now(), byPerson: scroll.byPerson });
      const state = listRef.current?.getState?.();
      if (restoringReadingPosition || state?.data !== rows) return own;
      const isAtEnd = rememberPosition();
      if (isAtEnd !== undefined) {
        onIsAtEndChange(isAtEnd, scroll);
      }
      if (!state || minimapItems.length === 0) {
        return own;
      }

      const scrollTop = state.scroll ?? 0;
      const scrollBottom = scrollTop + (state.scrollLength ?? 0);

      const itemBounds = minimapItems.map((item) => ({
        top: resolveTimelineRowTop(state, item.rowIndex),
        height: resolveTimelineRowHeight(state, item.rowIndex),
      }));

      for (const [index, item] of minimapItems.entries()) {
        const strip = minimapStripMap.get(item.id);
        const bounds = itemBounds[index];
        const rowTop = bounds?.top ?? null;
        const rowHeight = bounds?.height ?? null;
        const inView =
          rowTop !== null &&
          rowTop < scrollBottom &&
          rowTop + Math.max(1, rowHeight ?? 1) > scrollTop;

        // Written only on a change: a write restyles the mark even when it
        // says what it said, and this runs on every scroll event.
        const said = inView ? "true" : "false";
        if (strip && strip.dataset.inView !== said) {
          strip.dataset.inView = said;
        }
      }
      const nextCurrentIndex = resolveTimelineMinimapCurrentIndex({
        scrollTop,
        scrollBottom,
        itemBounds,
      });
      setMinimapCurrentIndex((current) =>
        current === nextCurrentIndex ? current : nextCurrentIndex,
      );
      return own;
    },
    [
      listRef,
      minimapItems,
      minimapStripMap,
      notePersonSession,
      onIsAtEndChange,
      placeFolds,
      rememberPosition,
      restoringReadingPosition,
      rows,
    ],
  );
  // A move the page made itself (`scrollOwn`: a glide, a fold) is never the
  // person's, however recently they touched the list.
  const handleScroll = useCallback(() => {
    const own = readList(personIsScrolling(personSessionRef.current, performance.now()));
    // A move of the page's own that left the end while it follows: back to the end; the list's
    // own before the frame paints.
    if (own && followingEndRef.current && listPlacedRef.current) followEnd(0, own);
  }, [followEnd, readList]);

  // Rows changed under the list: where it stands now is none of the person's doing.
  useEffect(() => {
    const frame = requestAnimationFrame(() => readList(false));
    return () => cancelAnimationFrame(frame);
  }, [readList, rows.length]);
  return handleScroll;
}
