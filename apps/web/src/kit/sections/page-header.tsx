import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { PersonAvatar } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

export default defineKitSection({
  id: "page-header",
  title: "PageHeader",
  purpose:
    "A page's head, one piece on every page: its mark, its title with the count beside it, one line under it, its actions at the title line's end.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/page-header.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label="<PageHeader title count actions> (the team)">
        <div className="w-[44rem]">
          <PageHeader actions={<Button size="sm">Invite people</Button>} count={3} title="Team" />
        </div>
      </Specimen>
      <Specimen label="<PageHeader lead title line> (a person's page)">
        <div className="w-[44rem]">
          <PageHeader
            lead={<PersonAvatar name="Petra Malá" size={64} />}
            line="petra@example.com · Invited · not joined yet"
            title="Petra Malá"
          />
        </div>
      </Specimen>
      <Specimen label='<PageHeader size="panel" title line> (a side panel&apos;s page)'>
        <div className="w-[33.75rem] border border-border pb-3">
          <PageHeader line="Values every service of Acme Docs reads" size="panel" title="Vault" />
        </div>
      </Specimen>
    </SpecimenGrid>
  ),
});
