import { useState } from "react";

import { ErrorLine } from "~/components/chat/ConversationRows";
import { RunLine } from "~/components/chat/RunChat";
import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineContext";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { ROW_SHARED, ROW_WORKING } from "../states/fixtures";

function WorkingLine({ secondsAgo }: { readonly secondsAgo: number }) {
  const [startedAt] = useState(() => new Date(Date.now() - secondsAgo * 1000).toISOString());
  return (
    <TimelineRowCtx value={ROW_SHARED}>
      <TimelineRowActivityCtx value={ROW_WORKING}>
        <div className="run-tray run-tray-top w-[560px]">
          <RunLine
            status={{
              live: true,
              face: "working",
              startedAt,
              endedAt: null,
              waitedMs: 0,
              waitingSince: null,
              worked: true,
            }}
          />
        </div>
      </TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
}

export default defineKitSection({
  id: "conversation-lines",
  title: "Conversation lines",
  purpose:
    "A conversation's own lines, on its mark column: the Mate at work with its clock, and a turn that stopped, alerted or (an expected refusal) told calmly.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/chat/ConversationRows.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label="<RunLine status={live, 8 s} />">
        <WorkingLine secondsAgo={8} />
      </Specimen>
      <Specimen label="<RunLine status={live, 23 min} />">
        <WorkingLine secondsAgo={23 * 60} />
      </Specimen>
      <Specimen label="<ErrorLine label detail onDismiss />">
        <div className="w-[560px]">
          <ErrorLine
            detail="The provider closed the stream after 3 minutes."
            label="The turn stopped."
            onDismiss={() => {}}
          />
        </div>
      </Specimen>
      <Specimen label="<ErrorLine label calm />">
        <div className="w-[560px]">
          <ErrorLine calm label="You've reached the usage limit until 18:00." />
        </div>
      </Specimen>
    </SpecimenGrid>
  ),
});
