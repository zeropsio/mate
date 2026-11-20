import { useLayoutEffect, useRef, useState } from "react";
import { useUiStateStore } from "~/uiStateStore";
import type { TimelineLatestTurn } from "./MessagesTimeline.logic";

/** Where the person left off in the conversation on screen (`MessagesTimeline`'s new-since line). */
export function useTimelineNewSince(
  routeThreadKey: string,
  latestTurn: TimelineLatestTurn | null,
  shownAgain: boolean,
) {
  // Where the person left off: the last visit this conversation remembers,
  // read as it opens — and as a kept list shows again — only when something
  // came since, so the line marks what is new and never follows the reader
  // around.
  const readNewSince = () => {
    const visitedAt = useUiStateStore.getState().threadLastVisitedAtById[routeThreadKey];
    const completedAt = latestTurn?.completedAt;
    return visitedAt && completedAt && Date.parse(completedAt) > Date.parse(visitedAt)
      ? visitedAt
      : null;
  };
  const [newSince, setNewSince] = useState(readNewSince);
  const readNewSinceRef = useRef(readNewSince);
  useLayoutEffect(() => {
    readNewSinceRef.current = readNewSince;
  });
  const firstShownRef = useRef(true);
  useLayoutEffect(() => {
    if (!shownAgain) return;
    if (firstShownRef.current) {
      firstShownRef.current = false;
      return;
    }
    setNewSince(readNewSinceRef.current());
  }, [shownAgain]);
  return newSince;
}
