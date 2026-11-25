import { setupFailureReason, type MateComing } from "@t3tools/client-runtime/data";

import { CrewSectionEmpty } from "~/components/zerops/crew/CrewSection";
import { MateDetailFailure } from "~/components/zerops/MateDetailFailure";
import { ComingBelow } from "~/components/zerops/ZeropsMateComingPage";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { comingSentenceOf } from "~/zerops/mateNoticeVoice";
import { useSecondsNowMs } from "~/zerops/useNowMs";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { birthProgress, failedBirthProgress, WREN, type BirthAge } from "../states/fixtures";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { StateFrame } from "../states/StateFrame";

const AGES: readonly BirthAge[] = ["start", "midway", "over-time"];
const AGE_WORDS: Readonly<Record<BirthAge, string>> = {
  start: "at the start",
  midway: "midway",
  "over-time": "past its estimate",
};
const READY_WREN = { ...WREN, connected: true };

/** A Mate's own page while it comes up: the stage with its steps under it. */
export function ArrivalStage({
  age,
  mate = WREN,
}: {
  readonly age: BirthAge;
  readonly mate?: ZeropsMateIdentity;
}) {
  const nowMs = useSecondsNowMs(true);
  const progress = birthProgress(age, nowMs);
  const coming: MateComing = { kind: "coming", line: "Coming up. A few minutes." };
  return (
    <MateEmptyStateView
      coming={{
        kind: "coming",
        sentence: comingSentenceOf({ coming, progress }),
        below: (
          <ComingBelow
            coming={coming}
            mate={mate}
            nowMs={nowMs}
            onRemove={() => {}}
            progress={progress}
          />
        ),
      }}
      mate={mate}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
}

/** A Mate whose container never came: the stage, its stopped steps, *Try again* and *Remove*. */
export function NotCreatedStage({ mate = WREN }: { readonly mate?: ZeropsMateIdentity }) {
  // Its setup stopped: its times stand.
  const nowMs = useSecondsNowMs(false);
  const progress = failedBirthProgress(nowMs);
  const failure = setupFailureReason(mate.name, "CommandExec: init command failed", [
    "curl: (6) Could not resolve host: zerops.io",
    "zcp init: command not found (exit 127)",
  ]);
  const coming: MateComing = { kind: "failed", line: failure.text, verb: "try-again" };
  return (
    <MateEmptyStateView
      coming={{
        kind: "failed",
        sentence: comingSentenceOf({ coming, progress }),
        below: (
          <ComingBelow
            coming={coming}
            mate={mate}
            nowMs={nowMs}
            onRemove={() => {}}
            onTryAgain={() => {}}
            progress={progress}
            setupFailureDetails={{
              details: failure.details,
              status: "ended",
              retrying: false,
              projectUrl: "https://app.zerops.io/project/kit",
              process: {
                id: "kit-dns",
                projectId: "kit",
                status: "FAILED",
                actionName: "stack.create",
                serviceStackIds: ["zcp"],
                created: new Date(nowMs - 136_000).toISOString(),
              },
            }}
          />
        ),
      }}
      mate={mate}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
}

export default defineKitSection({
  id: "mate-stage",
  title: "MateEmptyStateView",
  purpose:
    "A Mate's own page while there is nothing in it yet: its face, a headline, and under them what it waits on — an empty conversation, its arrival, a setup that stopped.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="A Mate's own page before anything is in it." title="Ready">
        <SpecimenGrid size="page">
          <Specimen label="<MateEmptyStateView>" note="An empty conversation">
            <StateFrame size="page">
              <MateEmptyStateView
                mate={READY_WREN}
                phase={null}
                signIn={null}
                signInRequired={false}
                unknown={null}
              />
            </StateFrame>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Its face, a headline, and its steps under them: at the start, midway and past its estimate."
        title="Coming up"
      >
        <SpecimenGrid size="page">
          {AGES.map((age) => (
            <Specimen
              key={age}
              label='<ComingBelow coming={{ kind: "coming" }}>'
              note={`Coming up, ${AGE_WORDS[age]}`}
            >
              <StateFrame size="page">
                <ArrivalStage age={age} />
              </StateFrame>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A setup that stopped, details that could not be read, a Mate with no crew yet."
        title="Stopped and empty"
      >
        <SpecimenGrid size="page">
          <Specimen
            label='<ComingBelow coming={{ kind: "failed" }}>'
            note="Its container never came"
          >
            <StateFrame size="page">
              <NotCreatedStage />
            </StateFrame>
          </Specimen>
          <Specimen
            label="<MateDetailFailure message>"
            note="Its details could not be read"
            source="apps/web/src/components/zerops/MateDetailFailure.tsx"
          >
            <StateFrame size="page">
              <MateDetailFailure
                again={() => {}}
                mate={WREN}
                message="Zerops did not answer within 20 seconds."
              />
            </StateFrame>
          </Specimen>
          <Specimen
            label="<CrewSectionEmpty lock={null}>"
            note="A Mate with no crew yet"
            source="apps/web/src/components/zerops/crew/CrewSection.tsx"
          >
            <StateFrame size="page">
              <CrewSectionEmpty
                error={null}
                lock={null}
                mate={{ name: "Fen", tint: "amber" }}
                onSetUp={() => {}}
                onSignIn={() => {}}
              />
            </StateFrame>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
