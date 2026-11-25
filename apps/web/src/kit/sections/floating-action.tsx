import { ArrowDownIcon } from "lucide-react";

import { FloatingAction } from "~/components/ui/floating-action";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

function FloatingActionSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Shown; hidden, it sinks away and is inert. The playground's shown switch eases it in and out."
        title="Shown"
      >
        <SpecimenGrid>
          <Specimen label={specimenLabel({ shown: true })}>
            <FloatingAction label="Scroll to end" onClick={() => undefined} shown>
              <ArrowDownIcon aria-hidden="true" />
            </FloatingAction>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "floating-action",
  title: "FloatingAction",
  purpose: "A press floating over content that scrolls under it, eased in and out as it is needed.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/floating-action.tsx",
  render: () => <FloatingActionSpecimens />,
});
