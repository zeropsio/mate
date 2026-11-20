import { type MessagesTimelineRow } from "./MessagesTimeline.logic";

// LegendList estimates unmeasured rows from the running average size of their
// type. One type for every assistant reply lets a few very long replies, or
// one that is streaming, lift the estimate for short replies to thousands of
// pixels. Rows then mount one at a time, each measurement shrinks the list
// and mounts the next row in the same commit, and scrolling into unmeasured
// history exceeds React's nested update limit. Doubling-length buckets keep
// each average within about 2x of the rows it estimates.
export function getItemType(item: MessagesTimelineRow) {
  if (item.kind !== "message") return item.kind;
  const lengthBucket = Math.max(0, Math.floor(Math.log2(item.message.text.length / 1000)));
  return `message:${item.message.role}:${lengthBucket}`;
}

interface TimelinePositionState {
  readonly contentLength?: number;
  readonly scroll?: number;
  readonly scrollLength?: number;
  readonly positionAtIndex?: (index: number) => number | undefined;
  readonly sizeAtIndex?: (index: number) => number | undefined;
}

export function resolveTimelineRowTop(state: TimelinePositionState, rowIndex: number) {
  const top = state.positionAtIndex?.(rowIndex);
  return typeof top === "number" && Number.isFinite(top) ? top : null;
}

export function resolveTimelineRowHeight(state: TimelinePositionState, rowIndex: number) {
  const height = state.sizeAtIndex?.(rowIndex);
  return typeof height === "number" && Number.isFinite(height) ? height : null;
}
