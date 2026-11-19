import { Fragment, type ReactNode } from "react";

import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

/** A draft's first rows, drawn over the list until the measured list stands in their place (see `draftRows`). */
export function TimelineDraftRows({
  rows,
  renderItem,
}: {
  rows: ReadonlyArray<MessagesTimelineRow>;
  renderItem: (info: { item: MessagesTimelineRow }) => ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden px-3 sm:px-5">
      {rows.map((row) => (
        <Fragment key={row.id}>{renderItem({ item: row })}</Fragment>
      ))}
    </div>
  );
}
