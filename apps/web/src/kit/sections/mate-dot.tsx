import { MateDot } from "~/components/zerops/MateDot";
import { MateFace } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const TONES = ["attention", "unread", "failed", "working"] as const;

export default defineKitSection({
  id: "mate-dot",
  title: "MateDot",
  purpose:
    "A Mate's state as one dot, the same wherever a Mate is drawn: amber waits on you, blue an unseen result, red stopped on an error, its own tint at work.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/zerops/MateDot.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Amber waits on you, blue an unseen result, red stopped on an error, its own tint at work."
        title="Tones"
      >
        <SpecimenGrid>
          {TONES.map((tone) => (
            <Specimen key={tone} label={specimenLabel({ tone, place: "inline", tint: "sky" })}>
              <MateDot place="inline" tint="sky" tone={tone} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="On a face">
        <SpecimenGrid>
          <Specimen
            label={specimenLabel({ tone: "attention", place: "corner" })}
            note="At a face's corner"
          >
            <span className="relative flex">
              <MateFace className="size-9" size={32} state="needs" tint="sky" />
              <MateDot place="corner" tone="attention" />
            </span>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
