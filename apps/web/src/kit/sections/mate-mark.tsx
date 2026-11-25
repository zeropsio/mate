import { MateMark } from "~/components/MateMark";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
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
    <SpecimenGrid>
      <Specimen label="(defaults)">
        <MateMark className="size-8" />
      </Specimen>
      <Specimen label={specimenLabel({ playful: true, awake: true })}>
        <MateMark awake className="size-8" playful />
      </Specimen>
      <Specimen label={specimenLabel({ tint: "violet" })}>
        <MateMark className="size-8" tint="violet" />
      </Specimen>
    </SpecimenGrid>
  ),
});
