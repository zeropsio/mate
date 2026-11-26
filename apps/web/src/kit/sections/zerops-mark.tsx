import { ZeropsMark } from "~/components/ZeropsMark";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

export default defineKitSection({
  id: "zerops-mark",
  title: "ZeropsMark",
  purpose:
    "The platform's two-tone Z, or the company's ring; in its own colours, or in the ink of a place that already has a colour; alone, or named as the logo.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/ZeropsMark.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="The platform's Z where the platform is meant; the company's ring where Zerops the company is."
        title="Variants"
      >
        <SpecimenGrid>
          {(["platform", "company"] as const).map((variant) => (
            <Specimen key={variant} label={specimenLabel({ variant })}>
              <ZeropsMark className="size-8" variant={variant} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="The word after the mark, in the text colour: the logo in a page's corner. Its holder gives the height."
        title="Named"
      >
        <SpecimenGrid>
          {(["company", "platform"] as const).map((variant) => (
            <Specimen key={variant} label={specimenLabel({ variant, named: true })}>
              <ZeropsMark className="h-6.5 w-auto text-foreground" named variant={variant} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="In its own colours, or in the ink of a place that already has a colour."
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
