import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { PersonAvatar } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "page-header",
  title: "PageHeader",
  purpose:
    "A page's head, one piece on every page: its mark, its title with the count beside it, one line under it, its actions at the title line's end.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/page-header.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Its mark, its title with the count beside it, one line, its actions at the title line's end."
        title="Pages and panels"
      >
        <SpecimenGrid size="xl">
          <Specimen align="start" label="<PageHeader title count actions>" note="The team">
            <div className="w-full max-w-[44rem]">
              <PageHeader
                actions={<Button size="sm">Invite people</Button>}
                count={3}
                title="Team"
              />
            </div>
          </Specimen>
          <Specimen align="start" label="<PageHeader lead title line>" note="A person's page">
            <div className="w-full max-w-[44rem]">
              <PageHeader
                lead={<PersonAvatar name="Petra Malá" size={64} />}
                line="petra@example.com · Invited · not joined yet"
                title="Petra Malá"
              />
            </div>
          </Specimen>
          <Specimen
            align="start"
            label='<PageHeader size="panel" title line>'
            note="A side panel's page"
          >
            <div className="w-full max-w-[33.75rem] rounded-card border border-border pb-3">
              <PageHeader
                line="Values every service of Acme Docs reads"
                size="panel"
                title="Vault"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
