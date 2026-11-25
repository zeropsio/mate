import { Collapsible, CollapsiblePanel } from "~/components/ui/collapsible";
import { SectionAction, SectionLabel } from "~/components/zerops/system/SectionLabel";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "section-label",
  title: "SectionLabel",
  purpose:
    "The one quiet label over a group on a page or in a panel: its words, a count after its dot, one action or the section's state at the line's end; folding, it opens what it names.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/zerops/system/SectionLabel.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="The one quiet label over a group." title="Counts, actions and folding">
        <SpecimenGrid size="lg">
          <Specimen label="<SectionLabel count action>" note="Mates, with a way to add one">
            <div className="w-full max-w-[28rem]">
              <SectionLabel action={<SectionAction>+ Add a Mate</SectionAction>} count={3}>
                Mates
              </SectionLabel>
            </div>
          </Specimen>
          <Specimen label="<SectionLabel level={3} count>" note="A review's section">
            <div className="w-full max-w-[28rem]">
              <SectionLabel count="2 changes · 3 commits" level={3}>
                What goes out
              </SectionLabel>
            </div>
          </Specimen>
          <Specimen
            label="<Collapsible defaultOpen> · <SectionLabel folds count>"
            note="Folding: its words are the press"
          >
            <div className="w-full max-w-[28rem]">
              <Collapsible defaultOpen>
                <SectionLabel count="3 changed · +42 −3" folds level={3}>
                  Files
                </SectionLabel>
                <CollapsiblePanel className="mt-3">
                  <p className="m-0 text-body">src/status.ts, src/routes.ts and .nvmrc changed.</p>
                </CollapsiblePanel>
              </Collapsible>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
