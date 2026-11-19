import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

export function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}
