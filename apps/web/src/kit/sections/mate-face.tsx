import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateMarkState } from "@t3tools/shared/brand";

import { MateFace, type MateFaceSize } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

const STATES = variantsOf<MateMarkState>({
  idle: true,
  working: true,
  needs: true,
  surprise: true,
  done: true,
  blink: true,
  sleep: true,
  waking: true,
  closed: true,
});
const SIZES: ReadonlyArray<MateFaceSize> = [16, 20, 24, 32, 64];

function MateFaceSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Tints × states: the eyes carry its state">
        <SpecimenMatrix
          rowProp="tint"
          rows={MATE_TINT_IDS}
          columnProp="state"
          columns={STATES}
          render={(tint, state) => <MateFace size={32} state={state} tint={tint} />}
        />
      </SpecimenBlock>
      <SpecimenBlock title="Sizes, shapes and moments">
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ size, tint: "coral" })}>
              <MateFace size={size} state="idle" tint="coral" />
            </Specimen>
          ))}
          {MATE_SHAPE_IDS.map((shape) => (
            <Specimen key={shape} label={specimenLabel({ shape, size: 32 })}>
              <MateFace shape={shape} size={32} state="idle" tint="violet" />
            </Specimen>
          ))}
          <Specimen label={specimenLabel({ mark: true, size: 32 })}>
            <MateFace mark size={32} state="idle" tint="amber" />
          </Specimen>
          <Specimen label={specimenLabel({ gaze: "up", state: "working", size: 64 })}>
            <MateFace gaze="up" size={64} state="working" tint="olive" />
          </Specimen>
          <Specimen label={specimenLabel({ restarting: true, size: 64 })}>
            <MateFace restarting size={64} state="idle" tint="rose" />
          </Specimen>
          <Specimen label={specimenLabel({ paces: true, size: 32 })}>
            <MateFace paces size={32} state="working" tint="sky" />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "mate-face",
  title: "MateFace",
  purpose:
    "A Mate: its tint, its shape, and its eyes carrying its state, wherever a Mate is drawn.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/zerops/primitives/MateFace.tsx",
  render: () => <MateFaceSpecimens />,
});
