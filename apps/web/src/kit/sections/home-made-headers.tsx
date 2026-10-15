import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { SidebarChromeHeader, SidebarCreateButton } from "~/components/sidebar/SidebarChrome";
import { SettingsBreadcrumb } from "~/components/settings/SettingsBreadcrumb";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { SidebarProvider } from "~/components/ui/sidebar";
import { Switch } from "~/components/ui/switch";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { SheetRow, SheetSection } from "~/components/zerops/addresses/AddressesSheetBits";
import { SidebarChiefRow } from "~/components/zerops/chief/SidebarChiefRow";
import { CrewHeading } from "~/components/zerops/crew/CrewParts";
import { SidebarJumpButton } from "~/components/zerops/SidebarJumpButton";
import { SidebarScopeButton } from "~/components/zerops/SidebarScopeButton";

import { CensusSpecimen, KitViewer } from "../census";
import { defineKitSection } from "../kitSection";
import { SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

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

function SectionHeaders() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/settings/settingsLayout.tsx",
          uses: 38,
          files: 12,
        }}
        label={`<SettingsSection ${specimenLabel({ title: "Appearance" })} headerAction>`}
      >
        <div className="w-[36rem]">
          <SettingsSection
            headerAction={
              <Button size="xs" variant="ghost">
                Restore defaults
              </Button>
            }
            title="Appearance"
          >
            <SettingsRow
              control={<Switch aria-label="Reduce motion" defaultChecked />}
              description="Rows and panels arrive without moving."
              title="Reduce motion"
            />
          </SettingsSection>
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/addresses/AddressesSheetBits.tsx",
          uses: 3,
          files: 3,
        }}
        label={`<SheetSection ${specimenLabel({ title: "Your domains", part: "domains" })} action>`}
      >
        <div className="w-[28rem]">
          <SheetSection
            action={
              <Button size="xs" variant="ghost">
                Add a domain
              </Button>
            }
            part="domains"
            title="Your domains"
          >
            <SheetRow name="shop.example.com" sub="Points at storefront" />
          </SheetSection>
        </div>
      </CensusSpecimen>
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
    "5 home-made page and section headers in 24 files, most used first; the kit has CardHeader, CardFrameHeader and SheetHeader for a surface's head, and no page header.",
  group: "Home-made",
  kind: "Containers",
  source: "apps/web/src/components/WorkspacePageHeader.tsx",
  render: () => (
    <KitViewer>
      <div className="flex flex-col gap-8">
        <SpecimenBlock title="Section headers">
          <SectionHeaders />
        </SpecimenBlock>
        <SpecimenBlock title="Page headers">
          <PageHeaders />
        </SpecimenBlock>
      </div>
    </KitViewer>
  ),
});
