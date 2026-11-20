import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import { createEndFollow, type EndFollow, type OwnScroll } from "./timelineEndFollow";
import { foldTimelineWork } from "./timelineFold";

/** What moves the list's view, shared by every part that moves it: the end follower, the folds and an answer's landing that take turns at the scroll, the room the follower stays out of, and the latest placed, following and arriving. Each cell has one writer; every field is a ref or a callback with no dependencies. */
export function useTimelineMotion({
  listRef,
  askRoom,
  askRoomEnd,
  listPlaced,
  followingEnd,
  rowsHeldKey,
  contentInsetEndAdjustment,
}: {
  listRef: RefObject<LegendListRef | null>;
  askRoom: number;
  askRoomEnd: number;
  listPlaced: boolean;
  followingEnd: boolean;
  rowsHeldKey: string;
  contentInsetEndAdjustment: number;
}) {
  const previousContentInsetEndAdjustmentRef = useRef(contentInsetEndAdjustment);
  // The room the end follower stays out of: an answered ask's, which the view eases out of, and an
  // answer's landing room. An open ask's room is the end: the conversation glides up clear of it.
  const followRoomRef = useRef(0);
  // The room under the end as drawn, all of it: what a landing under a held head reads the end by.
  const askRoomRef = useRef(askRoom);
  useLayoutEffect(() => {
    followRoomRef.current = Math.max(0, askRoom - askRoomEnd);
    askRoomRef.current = askRoom;
  }, [askRoom, askRoomEnd]);
  const remeasurePositionRef = useRef<(() => void) | null>(null);
  const listPlacedRef = useRef(listPlaced);
  useLayoutEffect(() => {
    listPlacedRef.current = listPlaced;
  }, [listPlaced]);
  const followingEndRef = useRef(followingEnd);
  useLayoutEffect(() => {
    followingEndRef.current = followingEnd;
  }, [followingEnd]);
  // What keeps the list at its end while it follows (`createEndFollow`): growth of what is
  // already there carried at once, an arrival by a glide. The list's own keeping is off: it jumps.
  const endFollowRef = useRef<EndFollow | null>(null);
  // Execution ownership only: fold compensation and end following cannot write together.
  const outerFoldsRef = useRef(new Set<() => void>());
  const foldExecutionsRef = useRef(new Set<ReturnType<typeof foldTimelineWork>>());
  const arrivingRef = useRef(rowsHeldKey !== "");
  useLayoutEffect(() => {
    arrivingRef.current = rowsHeldKey !== "";
  }, [rowsHeldKey]);
  useEffect(
    () => () => {
      for (const execution of foldExecutionsRef.current) execution.dispose();
    },
    [],
  );
  useEffect(() => {
    const endFollow = createEndFollow({
      viewport: () => listRef.current?.getScrollableNode() ?? null,
      // Whether it stands at its end is the follower's own judgement, from
      // the scrolls it hears: the list's own reading goes stale mid-glide.
      follows: () => followingEndRef.current,
      room: () => followRoomRef.current,
      // Placed out of sight, it stands at its end at once, so it is shown standing still.
      unseen: () => !listPlacedRef.current,
      placeEnd: () => {
        void listRef.current?.scrollToEnd({ animated: false, viewOffset: followRoomRef.current });
      },
    });
    endFollowRef.current = endFollow;
    return () => {
      endFollow.stop();
      endFollowRef.current = null;
    };
  }, [listRef]);
  // An answer landing (`onAnswerLands`): what it holds still, where it stood. The follower waits.
  const landingRef = useRef<{
    readonly element: HTMLElement;
    readonly edge: "top" | "bottom";
    /** Where it holds its edge; a held head comes down with the work folding under it. */
    at: number;
    readonly since: number;
    frame: number;
    /** A held head whose answer comes apart from its slot: the view may travel to that answer. */
    readonly glides?: boolean;
    /** When the end first went on under the view: from then the view travels to it. */
    glide?: number | undefined;
    /** The held head's row as the last frame drew it, and how many frames it has stood so. */
    card?: { readonly height: number; readonly still: number };
    /** Words landed under a held head where they were read, and how much of their way is left. */
    words?: { readonly travel: Animation; left: number };
  } | null>(null);
  // A fold or a landing holds the view where it stands: the follower waits for it.
  const followEnd = useCallback((grew = 0, own?: OwnScroll) => {
    if (outerFoldsRef.current.size === 0 && landingRef.current === null) {
      if (own === "list") endFollowRef.current?.undo();
      else endFollowRef.current?.follow(grew);
    }
  }, []);
  const placeFolds = useCallback(() => {
    for (const execution of foldExecutionsRef.current) execution.place();
  }, []);
  return {
    previousContentInsetEndAdjustmentRef,
    followRoomRef,
    askRoomRef,
    remeasurePositionRef,
    listPlacedRef,
    followingEndRef,
    endFollowRef,
    outerFoldsRef,
    foldExecutionsRef,
    arrivingRef,
    landingRef,
    followEnd,
    placeFolds,
  };
}
