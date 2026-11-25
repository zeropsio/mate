import { ZeropsMark } from "~/components/ZeropsMark";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

export default defineKitSection({
  id: "zerops-mark",
  title: "ZeropsMark",
  purpose: "The platform: in Zerops' teal, or in the ink of a place that already has a colour.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/ZeropsMark.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="In Zerops' teal, or in the ink of a place that already has a colour."
        title="Tones"
      >
        <SpecimenGrid>
          {(["brand", "current"] as const).map((tone) => (
            <Specimen key={tone} label={specimenLabel({ tone })}>
              <ZeropsMark className="size-8" tone={tone} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
