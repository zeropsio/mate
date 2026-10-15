import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { SectionHeader } from "~/components/ui/section";
import { PersonAvatar } from "~/components/zerops/primitives";
import { SidebarChromeHeader, SidebarCreateButton } from "~/components/sidebar/SidebarChrome";
import { SettingsBreadcrumb } from "~/components/settings/SettingsBreadcrumb";
import { SidebarProvider } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { SidebarChiefRow } from "~/components/zerops/chief/SidebarChiefRow";
import { CrewHeading } from "~/components/zerops/crew/CrewParts";
import { SidebarJumpButton } from "~/components/zerops/SidebarJumpButton";
import { SidebarScopeButton } from "~/components/zerops/SidebarScopeButton";

import { CensusSpecimen, KitViewer } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";

const noop = () => {};

/** A page's top bar as the app draws it: full width of a page, a hairline under it. */
function PageBar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="w-[56rem] max-w-full border-b border-border bg-background">{children}</div>
  );
}

function PageHeaders() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/WorkspacePageHeader.tsx", uses: 7, files: 7 }}
        label="<WorkspacePageHeader> + <SettingsBreadcrumb> (settings)"
      >
        <PageBar>
          <WorkspacePageHeader>
            <SettingsBreadcrumb pathname="/settings/general" />
          </WorkspacePageHeader>
        </PageBar>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/sidebar/SidebarChrome.tsx", uses: 3, files: 2 }}
        label="<SidebarChromeHeader brand={<SidebarChiefRow />} actions> (the menu's top row)"
      >
        <SidebarProvider className="block min-h-0">
          <aside
            className="w-[435px] border border-border bg-sidebar text-sidebar-foreground"
            data-sidebar="sidebar"
          >
            <SidebarChromeHeader
              actions={
                <>
                  <SidebarScopeButton onScope={noop} scope="everyone" />
                  <SidebarJumpButton onJump={noop} shortcut="⌘K" />
                  <SidebarCreateButton onNewMate={noop} onNewProject={noop} projects={[]} />
                </>
              }
              brand={<SidebarChiefRow current={false} onOpen={noop} />}
              isElectron={false}
            />
          </aside>
        </SidebarProvider>
      </CensusSpecimen>
    </SpecimenGrid>
  );
}

function Chosen() {
  return (
    <SpecimenBlock title="Chosen · SectionHeader and PageHeader: the count beside the title, one action at the title line's end">
      <SpecimenGrid>
        <Specimen label="<SectionHeader title count action> (settings, the addresses sheet, the vault)">
          <div className="w-[36rem]">
            <SectionHeader
              action={
                <Button size="xs" variant="ghost">
                  Restore defaults
                </Button>
              }
              count="4 people"
              title="Team"
            />
          </div>
        </Specimen>
        <Specimen label="<PageHeader lead title line> (a person's page, adding a team member)">
          <div className="w-[44rem]">
            <PageHeader
              lead={<PersonAvatar name="Petra Malá" size={64} />}
              line="petra@example.com · Invited · not joined yet"
              title="Petra Malá"
            />
          </div>
        </Specimen>
      </SpecimenGrid>
    </SpecimenBlock>
  );
}

function SectionHeaders() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/zerops/crew/CrewParts.tsx", uses: 1, files: 1 }}
        label="<CrewHeading>"
      >
        <div className="w-80 bg-background py-2">
          <CrewHeading>Crewmates</CrewHeading>
        </div>
      </CensusSpecimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "home-made-headers",
  title: "Headers",
  purpose:
    "The kit's SectionHeader and PageHeader first; then the headers still home-made: the crew's group label and the bars at a page's and the menu's top.",
  group: "Home-made",
  kind: "Containers",
  source: "apps/web/src/components/WorkspacePageHeader.tsx",
  render: () => (
    <KitViewer>
      <div className="flex flex-col gap-8">
        <Chosen />
        <SpecimenBlock title="Still home-made: section headers">
          <SectionHeaders />
        </SpecimenBlock>
        <SpecimenBlock title="Still home-made: page bars">
          <PageHeaders />
        </SpecimenBlock>
      </div>
    </KitViewer>
  ),
});
