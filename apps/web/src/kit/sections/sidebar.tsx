import { FolderIcon, HomeIcon, SettingsIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";

const SIZES = ["sm", "default", "lg", "icon"] as const;
const VARIANTS = ["default", "outline"] as const;

function SidebarSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title='A whole menu: <Sidebar collapsible="none"> in a 320 × 420 box'>
        <Specimen label='<SidebarProvider> · <Sidebar collapsible="none"> · <SidebarInset>'>
          <div className="flex h-[26rem] w-[40rem] overflow-hidden rounded-xl border">
            <SidebarProvider className="min-h-0">
              <Sidebar collapsible="none">
                <SidebarHeader>
                  <SidebarInput aria-label="Search the menu" placeholder="Search" />
                </SidebarHeader>
                <SidebarContent>
                  <SidebarGroup>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>
                          <HomeIcon />
                          <span>Overview (isActive)</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <FolderIcon />
                          <span>storefront</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuSubButton>preview</SidebarMenuSubButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuSubButton isActive>production (isActive)</SidebarMenuSubButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton disabled>
                          <FolderIcon />
                          <span>archived (disabled)</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <FolderIcon />
                          <span>a-project-with-a-name-long-enough-to-truncate-in-the-menu</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroup>
                </SidebarContent>
                <SidebarFooter>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton>
                        <SettingsIcon />
                        <span>Settings</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarFooter>
              </Sidebar>
              <SidebarInset>
                <div className="flex items-center gap-2 p-3 text-sm">
                  <SidebarTrigger />
                  <span>SidebarInset: the page beside the menu</span>
                </div>
              </SidebarInset>
            </SidebarProvider>
          </div>
        </Specimen>
      </SpecimenBlock>
      <SpecimenBlock title="SidebarMenuButton variants × sizes">
        <SidebarProvider className="min-h-0">
          <SpecimenMatrix
            rowProp="variant"
            rows={VARIANTS}
            columnProp="size"
            columns={SIZES}
            render={(variant, size) => (
              <div className="w-48">
                {size === "icon" ? (
                  <SidebarMenuButton aria-label="storefront" size={size} variant={variant}>
                    <FolderIcon />
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton size={size} variant={variant}>
                    <FolderIcon />
                    <span>storefront</span>
                  </SidebarMenuButton>
                )}
              </div>
            )}
          />
        </SidebarProvider>
      </SpecimenBlock>
      <SpecimenBlock title="SidebarMenuSubButton sizes">
        <SidebarProvider className="min-h-0">
          <SpecimenGrid>
            {(["sm", "md"] as const).map((size) => (
              <Specimen key={size} label={`size="${size}"`}>
                <div className="w-48">
                  <SidebarMenuSubButton size={size}>preview</SidebarMenuSubButton>
                </div>
              </Specimen>
            ))}
          </SpecimenGrid>
        </SidebarProvider>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "sidebar",
  title: "Sidebar",
  purpose: "The app's left menu and its rows; this page's own index is one.",
  group: "Kit",
  kind: "Navigation",
  source: "apps/web/src/components/ui/sidebar.tsx",
  render: () => <SidebarSpecimens />,
});
