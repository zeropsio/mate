import { createContext, use, type ReactNode } from "react";

import { Seam } from "./ConversationRows";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { TimelineLoadEarlierHeader } from "./TimelineLoadEarlierHeader";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";
import type { TimestampFormat } from "@t3tools/contracts/settings";

/**
 * The conversation's earlier turns, where they would stand: provided by the list beside its rows,
 * read only by the line that marks them, so a press loading them redraws no other row.
 */
const EarlierTurnsContext = createContext<EarlierTurns | null>(null);

interface EarlierTurns {
  readonly loading: boolean;
  readonly onLoadEarlier: () => void;
}

/** What the list's rows read: the state they share, and apart from it the earlier turns. */
export function TimelineProviders({
  shared,
  earlier,
  children,
}: {
  readonly shared: TimelineRowSharedState;
  readonly earlier: EarlierTurns | null;
  readonly children: ReactNode;
}) {
  return (
    <TimelineRowCtx value={shared}>
      <EarlierTurnsContext value={earlier}>{children}</EarlierTurnsContext>
    </TimelineRowCtx>
  );
}

/**
 * Where earlier turns not loaded yet stand between rows kept from them on their own (an open
 * request) and the turns loaded: the line says so, and *Load earlier turns* loads them there.
 */
export function TimelineEarlierSeam({
  row,
  timestampFormat,
}: {
  readonly row: Extract<MessagesTimelineRow, { kind: "seam" }>;
  readonly timestampFormat: TimestampFormat;
}) {
  const earlier = use(EarlierTurnsContext);
  return (
    <div data-timeline-earlier>
      <Seam row={row} timestampFormat={timestampFormat} />
      {earlier === null ? null : (
        <TimelineLoadEarlierHeader
          fade={false}
          loading={earlier.loading}
          onLoadEarlier={earlier.onLoadEarlier}
        />
      )}
    </div>
  );
}
