import { ProcessSteps } from "~/components/zerops/primitives";
import type { ProcessStep } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const STEPS: ReadonlyArray<ProcessStep> = [
  { id: "build", label: "Build", state: "done", stateLabel: "Done", durationMs: 42_000 },
  { id: "deploy", label: "Deploy", state: "running", stateLabel: "Running", durationMs: 12_000 },
  { id: "address", label: "Give it an address", state: "queued", stateLabel: "Waiting" },
];

const FAILED: ReadonlyArray<ProcessStep> = [
  { id: "build", label: "Build", state: "done", stateLabel: "Done", durationMs: 42_000 },
  {
    id: "deploy",
    label: "Deploy",
    state: "failed",
    stateLabel: "Failed",
    note: "exit 1",
    durationMs: 9_000,
  },
];

export default defineKitSection({
  id: "process-steps",
  title: "ProcessSteps",
  purpose:
    "A Zerops process's steps as Zerops runs them: each step's glyph and words, its time at the end; compact inside a card of results.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/zerops/primitives/ProcessSteps.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Each step's glyph and words, its time at the end."
        title="Under way, failed and compact"
      >
        <SpecimenGrid size="lg">
          <Specimen label="steps" note="Steps under way">
            <div className="w-full max-w-[28rem]">
              <ProcessSteps steps={STEPS} />
            </div>
          </Specimen>
          <Specimen label="steps" note="A step that failed">
            <div className="w-full max-w-[28rem]">
              <ProcessSteps steps={FAILED} />
            </div>
          </Specimen>
          <Specimen label='density="compact" steps' note="Inside a card of results">
            <div className="w-full max-w-[28rem]">
              <ProcessSteps density="compact" steps={STEPS} />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
