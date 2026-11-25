import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Collapsible, CollapsiblePanel } from "~/components/ui/collapsible";
import { Row } from "~/components/ui/row";
import { Section, SectionHeader } from "~/components/ui/section";
import { PersonAvatar } from "~/components/zerops/primitives";
import { SectionAction } from "~/components/zerops/system";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "section",
  title: "Section",
  purpose:
    "A heading and the rows it names: its title, its count beside it, its one action at the line's end, 8 px over its rows; quiet inside a card, a panel or the menu.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/section.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Its title, its count beside it, its one action at the line's end."
        title="Headers"
      >
        <SpecimenGrid size="xl">
          <Specimen label="<SectionHeader title count action>" note="A count and an action">
            <div className="w-full max-w-[36rem]">
              <SectionHeader
                action={
                  <Button size="sm" variant="ghost">
                    Restore defaults
                  </Button>
                }
                count="4 people"
                title="Team"
              />
            </div>
          </Specimen>
          <Specimen label="<SectionHeader title line action>" note="A line under its title">
            <div className="w-full max-w-[36rem]">
              <SectionHeader
                action={
                  <Button size="sm" variant="secondary">
                    Choose projects
                  </Button>
                }
                line="Owners and admins reach every project by their role. Set a different level on a project here."
                title="Project access"
              />
            </div>
          </Specimen>
          <Specimen label="<SectionHeader level={3}>" note="Inside a sheet or a panel">
            <div className="w-full max-w-[36rem]">
              <SectionHeader level={3} title="What Fen's crew changed" />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note='Inside a card, a side panel, the menu or a sheet, a group is labelled quietly: size="panel".'
        title="Inside a card or a panel"
      >
        <SpecimenGrid size="lg">
          <Specimen label='<SectionHeader size="panel" count action>' note="A card's Mates">
            <div className="w-full max-w-[28rem]">
              <SectionHeader
                action={<SectionAction>+ Add a Mate</SectionAction>}
                count={3}
                size="panel"
                title="Mates"
              />
            </div>
          </Specimen>
          <Specimen label='<SectionHeader size="panel" level={3} count>' note="A review's part">
            <div className="w-full max-w-[28rem]">
              <SectionHeader
                count="2 changes · 3 commits"
                level={3}
                size="panel"
                title="What goes out"
              />
            </div>
          </Specimen>
          <Specimen
            label='<Collapsible defaultOpen> · <SectionHeader size="panel" folds count>'
            note="Folding: its words are the press"
          >
            <div className="w-full max-w-[28rem]">
              <Collapsible defaultOpen>
                <SectionHeader
                  count="3 changed · +42 −3"
                  folds
                  level={3}
                  size="panel"
                  title="Files"
                />
                <CollapsiblePanel className="mt-3">
                  <p className="m-0 text-body">src/status.ts, src/routes.ts and .nvmrc changed.</p>
                </CollapsiblePanel>
              </Collapsible>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A header 8 px over the rows it names." title="Over its rows">
        <SpecimenGrid size="xl">
          <Specimen
            label='<Section count action> · <Card variant="flat"> · <Row>'
            note="People, over a card of rows"
          >
            <div className="w-full max-w-[28rem]">
              <Section
                action={
                  <Button size="sm" variant="ghost">
                    Add access
                  </Button>
                }
                count={3}
                title="People"
              >
                <Card variant="flat">
                  <Row
                    lead={<PersonAvatar name="Petra Malá" size={32} />}
                    line="Owner"
                    title="Petra Malá"
                  />
                </Card>
              </Section>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
