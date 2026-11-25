import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Row } from "~/components/ui/row";
import { Section, SectionHeader } from "~/components/ui/section";
import { PersonAvatar } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

export default defineKitSection({
  id: "section",
  title: "Section",
  purpose:
    "A heading and the rows it names: its title, its count beside it, its one action at the line's end, 8 px over its rows.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/section.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label="<SectionHeader title count action>">
        <div className="w-[36rem]">
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
      <Specimen label="<SectionHeader title line action>">
        <div className="w-[36rem]">
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
      <Specimen label="<SectionHeader level={3}> (inside a sheet or a panel)">
        <div className="w-[36rem]">
          <SectionHeader level={3} title="What Fen's crew changed" />
        </div>
      </Specimen>
      <Specimen label='<Section count action> over a <Card variant="flat"> of Rows'>
        <div className="w-[28rem]">
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
  ),
});
