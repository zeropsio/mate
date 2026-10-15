import type { MateComing } from "@t3tools/client-runtime/data";
import { useState } from "react";

import { RunLine } from "~/components/chat/RunChat";
import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineContext";
import { ChiefStage } from "~/components/zerops/chief/ChiefPage";
import { ChiefSetupRowLine } from "~/components/zerops/chief/SidebarChiefRow";
import { ZeropsBirthChecklist, ZeropsBirthLine } from "~/components/zerops/ZeropsBirthProgress";
import { ZeropsEnvironmentCreation } from "~/components/zerops/ZeropsEnvironmentCreation";
import { ComingBelow } from "~/components/zerops/ZeropsMateComingPage";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { ZeropsOperationCard } from "~/components/zerops/ZeropsOperationCard";
import { comingSentenceOf } from "~/zerops/mateNoticeVoice";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { CensusLook, StateCensus, StateFrame, useKitNowMs } from "../states/Census";
import {
  birthProgress,
  creationProgress,
  ROW_SHARED,
  ROW_WORKING,
  showcaseOperation,
  WREN,
  YOU,
  type BirthAge,
} from "../states/fixtures";

const AGES: readonly BirthAge[] = ["start", "midway", "over-time"];

/** A Mate's own page while it comes up: the real stage with its real steps under it. */
function ArrivalStage({ age }: { readonly age: BirthAge }) {
  const nowMs = useKitNowMs();
  const progress = birthProgress(age, nowMs);
  const coming: MateComing = { kind: "coming", line: "Coming up. A few minutes." };
  return (
    <MateEmptyStateView
      coming={{
        kind: "coming",
        sentence: comingSentenceOf({ coming, progress, nowMs }),
        below: (
          <ComingBelow
            coming={coming}
            mate={WREN}
            nowMs={nowMs}
            onRemove={() => {}}
            progress={progress}
            you={YOU}
          />
        ),
      }}
      mate={WREN}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
}

function BirthLine({ age }: { readonly age: BirthAge }) {
  const nowMs = useKitNowMs();
  return <ZeropsBirthLine nowMs={nowMs} progress={birthProgress(age, nowMs)} />;
}

function BirthChecklist() {
  const nowMs = useKitNowMs();
  return <ZeropsBirthChecklist nowMs={nowMs} progress={birthProgress("midway", nowMs)} />;
}

function Creation({ runningSeconds }: { readonly runningSeconds: number }) {
  const nowMs = useKitNowMs();
  // The import's start, fixed at the specimen's mount: its step's clock runs from there.
  const [mountedAt] = useState(nowMs);
  return (
    <ZeropsEnvironmentCreation
      name="Beviro CRM - production"
      nowMs={nowMs}
      onDismiss={() => {}}
      progress={creationProgress(mountedAt, runningSeconds)}
      tier="production"
    />
  );
}

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

function RunningOperation() {
  const nowMs = useKitNowMs();
  const [mountedAt] = useState(nowMs);
  const operation = showcaseOperation("running");
  if (operation === null) return null;
  // The scene's call began on its own date: its clock runs from 42 s in, from the mount.
  const now = Date.parse(operation.anchorAt) + 42_000 + (nowMs - mountedAt);
  return (
    <div className="w-[560px]">
      <ZeropsOperationCard now={now} operation={operation} />
    </div>
  );
}

function WaitingCensus() {
  return (
    <StateCensus
      atom="none: the kit has no progress or step list; Spinner is the nearest"
      count="8 looks: 14 own waiting components in 12 files; 3 of the looks are inline and listed under Not shown."
    >
      <CensusLook
        name="Mate arrival stage: face, headline, steps below"
        uses="13 sites in 7 files"
        places={[
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx:324 MateEmptyStateView",
          "apps/web/src/components/zerops/ZeropsMateComingPage.tsx:1076 ComingBelow",
          "apps/web/src/components/zerops/ZeropsArrivalSteps.tsx:30 ZeropsArrivalSteps",
          "apps/web/src/components/zerops/ZeropsMateComingPage.tsx:185 ZeropsMateComingPage",
          "apps/web/src/components/zerops/ZeropsNewProjectComingPage.tsx:52 ZeropsNewProjectComingPage",
          "apps/web/src/components/zerops/ArrivalSwap.tsx:34 ArrivalSwap (its hand-over)",
          "apps/web/src/components/zerops/chief/ChiefPage.tsx:107 ChiefStage",
        ]}
      >
        {AGES.map((age) => (
          <Specimen
            key={age}
            label={`<MateEmptyStateView coming={coming} /> · ${age}`}
            source="apps/web/src/components/zerops/ZeropsMateComingPage.tsx"
          >
            <StateFrame size="page">
              <ArrivalStage age={age} />
            </StateFrame>
          </Specimen>
        ))}
        <Specimen
          label='<ChiefStage view={{ kind: "steps", setup: { phase: "running", step: "hq" } }} />'
          source="apps/web/src/components/zerops/chief/ChiefPage.tsx"
        >
          <StateFrame size="page">
            <ChiefStage
              onAgain={() => {}}
              onFinish={() => {}}
              onSetUp={() => {}}
              view={{
                kind: "steps",
                setup: { phase: "running", step: "hq", birthId: "b1", projectId: "p-chief" },
              }}
            />
          </StateFrame>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Ringed step list with durations (ProcessSteps)"
        uses="11 sites in 6 files"
        places={[
          "apps/web/src/components/zerops/primitives/ProcessSteps.tsx:82 ProcessSteps",
          "apps/web/src/components/zerops/ZeropsEnvironmentCreation.tsx:131 ZeropsEnvironmentCreation",
          "apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.tsx:118 PressSteps",
          "apps/web/src/components/zerops/ZeropsOperationCard.tsx:664 ZeropsOperationCard",
          "apps/web/src/components/zerops/ZeropsToolResultCards.tsx:181",
          "apps/web/src/components/zerops/ZeropsBirthProgress.tsx:122 ZeropsBirthChecklist",
        ]}
      >
        <Specimen
          label="<ZeropsEnvironmentCreation /> · import just begun"
          source="apps/web/src/components/zerops/ZeropsEnvironmentCreation.tsx"
        >
          <div className="w-[480px]">
            <Creation runningSeconds={4} />
          </div>
        </Specimen>
        <Specimen
          label="<ZeropsEnvironmentCreation /> · import 9 min in"
          source="apps/web/src/components/zerops/ZeropsEnvironmentCreation.tsx"
        >
          <div className="w-[480px]">
            <Creation runningSeconds={9 * 60} />
          </div>
        </Specimen>
        <Specimen
          label="<ZeropsBirthChecklist /> · midway"
          source="apps/web/src/components/zerops/ZeropsBirthProgress.tsx"
        >
          <div className="w-[320px]">
            <BirthChecklist />
          </div>
        </Specimen>
        <Specimen
          label='<ZeropsOperationCard operation={phase: "running"} />'
          source="apps/web/src/components/zerops/ZeropsOperationCard.tsx"
        >
          <RunningOperation />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Words, a clock and a segmented bar"
        uses="1 site in 1 file"
        places={[
          "apps/web/src/components/zerops/ZeropsBirthProgress.tsx:54 ZeropsBirthLine",
          "apps/web/src/components/zerops/ZeropsBirthProgress.tsx:48 ZeropsMateBirthLine",
        ]}
      >
        {AGES.map((age) => (
          <Specimen
            key={age}
            label={`<ZeropsBirthLine /> · ${age}`}
            source="apps/web/src/components/zerops/ZeropsBirthProgress.tsx"
          >
            <div className="w-[260px]">
              <BirthLine age={age} />
            </div>
          </Specimen>
        ))}
      </CensusLook>

      <CensusLook
        name="Working line with its clock"
        uses="9 sites in 3 files"
        places={[
          "apps/web/src/components/chat/RunChat.tsx:3565 RunLine",
          "apps/web/src/components/chat/RunChat.tsx:3089 (the calm clock)",
          "apps/web/src/components/chat/ConversationWorking.tsx:836 ConversationWorking",
          "apps/web/src/components/chat/ConversationRows.tsx:77 elapsedSince",
        ]}
      >
        <Specimen
          label="<RunLine status={live, 8 s} />"
          source="apps/web/src/components/chat/RunChat.tsx"
        >
          <WorkingLine secondsAgo={8} />
        </Specimen>
        <Specimen
          label="<RunLine status={live, 23 min} />"
          source="apps/web/src/components/chat/RunChat.tsx"
        >
          <WorkingLine secondsAgo={23 * 60} />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="One muted line in a menu row"
        uses="5 sites in 2 files"
        places={["apps/web/src/components/zerops/chief/SidebarChiefRow.tsx:220 ChiefSetupRowLine"]}
      >
        {(["running", "stopped", "unfinished"] as const).map((state) => (
          <Specimen
            key={state}
            label={`<ChiefSetupRowLine state="${state}" />`}
            source="apps/web/src/components/zerops/chief/SidebarChiefRow.tsx"
          >
            <span className="flex w-[240px] flex-col">
              <ChiefSetupRowLine state={state} />
            </span>
          </Specimen>
        ))}
      </CensusLook>
    </StateCensus>
  );
}

export default defineKitSection({
  id: "home-made-waiting",
  title: "Waiting on a long operation",
  purpose:
    "Every way the app shows a wait that runs for minutes: steps, clocks, bars and arrival pages.",
  group: "Home-made",
  kind: "Feedback",
  source: "apps/web/src/kit/sections/states-waiting.tsx",
  render: () => <WaitingCensus />,
});
