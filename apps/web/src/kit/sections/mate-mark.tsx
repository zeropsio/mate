import { MateMark } from "~/components/MateMark";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

export default defineKitSection({
  id: "mate-mark",
  title: "MateMark",
  purpose:
    "The product's own mark, and the Chief's face: brand presence, never a provider's state.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/MateMark.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="Brand presence, never a provider's state." title="Forms">
        <SpecimenGrid>
          <Specimen label="(defaults)" note="The product's mark">
            <MateMark className="size-8" />
          </Specimen>
          <Specimen label={specimenLabel({ playful: true, awake: true })} note="Awake and playful">
            <MateMark awake className="size-8" playful />
          </Specimen>
          <Specimen label={specimenLabel({ tint: "violet" })} note="The Chief's face, in its tint">
            <MateMark className="size-8" tint="violet" />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
