import { cn } from "~/lib/utils";
import { RUN_TRAY_SLICE } from "~/components/chat/runTray";
import { useState } from "react";

import { ErrorLine } from "~/components/chat/ConversationRows";
import { RunLine } from "~/components/chat/RunChat";
import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineContext";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { ROW_SHARED, ROW_WORKING } from "../states/fixtures";

function WorkingLine({ secondsAgo }: { readonly secondsAgo: number }) {
  const [startedAt] = useState(() => new Date(Date.now() - secondsAgo * 1000).toISOString());
  return (
    <TimelineRowCtx value={ROW_SHARED}>
      <TimelineRowActivityCtx value={ROW_WORKING}>
        <div className={cn(RUN_TRAY_SLICE.top, "w-full max-w-[560px]")}>
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
    <Specimens>
      <SpecimenBlock note="The Mate at work, with its clock." title="At work">
        <SpecimenGrid size="xl">
          <Specimen label="<RunLine status={live} />" note="Working for 8 seconds">
            <WorkingLine secondsAgo={8} />
          </Specimen>
          <Specimen label="<RunLine status={live} />" note="Working for 23 minutes">
            <WorkingLine secondsAgo={23 * 60} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A turn that stopped, alerted; an expected refusal, told calmly."
        title="Stopped"
      >
        <SpecimenGrid size="xl">
          <Specimen label="<ErrorLine label detail onDismiss />" note="A turn that stopped">
            <div className="w-full max-w-[560px]">
              <ErrorLine
                detail="The provider closed the stream after 3 minutes."
                label="The turn stopped."
                onDismiss={() => {}}
              />
            </div>
          </Specimen>
          <Specimen label="<ErrorLine label calm />" note="An expected refusal">
            <div className="w-full max-w-[560px]">
              <ErrorLine calm label="You've reached the usage limit until 18:00." />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
