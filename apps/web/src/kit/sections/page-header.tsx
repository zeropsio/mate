import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import { PersonAvatar } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A trail as a page's own: the places above it a way back, the page itself in the foreground. */
export function KitTrail() {
  return (
    <WorkspaceBreadcrumb ariaLabel="Breadcrumb">
      <WorkspaceBreadcrumbItem>
        <InlineButton tone="muted">Overview</InlineButton>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current>Tea Shop</WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}

export default defineKitSection({
  id: "page-header",
  title: "PageHeader",
  purpose:
    "A page's head, one piece on every page: the trail above, its mark, its title with its count, tag and summary beside it, one line under it, its actions at the title line's end.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/page-header.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Its trail, its mark, its title with what stands beside it, one line, its actions at the title line's end."
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
            label="<PageHeader trail title tag summary actions>"
            note="A place's page, under its trail"
          >
            <div className="w-full max-w-[44rem]">
              <PageHeader
                actions={
                  <Button size="sm" variant="secondary">
                    Vault
                  </Button>
                }
                summary={<span className="text-muted-foreground">Running · v0.1.3</span>}
                tag={<Badge tone="danger">Production</Badge>}
                title="Tea Shop"
                trail={<KitTrail />}
              />
            </div>
          </Specimen>
          <Specimen
            align="start"
            label="<PageHeader title={undefined} trail>"
            note="Its name unread"
          >
            <div className="w-full max-w-[44rem]">
              <PageHeader title={undefined} trail={<KitTrail />} />
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
