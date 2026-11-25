import { FolderIcon, HomeIcon, SettingsIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarProvider,
} from "~/components/ui/sidebar";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type ButtonProps = ComponentProps<typeof SidebarMenuButton>;

const SIZES = variantsOf<NonNullable<ButtonProps["size"]>>({
  sm: true,
  default: true,
  lg: true,
  icon: true,
});
const VARIANTS = variantsOf<NonNullable<ButtonProps["variant"]>>({ default: true, outline: true });
const SUB_SIZES = variantsOf<NonNullable<ComponentProps<typeof SidebarMenuSubButton>["size"]>>({
  sm: true,
  md: true,
});

/** The menu's fixture: projects with their environments under them. */
const PROJECTS = [
  { name: "storefront", environments: ["Stage", "Production"] },
  { name: "acme-docs", environments: [] },
  { name: "a-project-with-a-name-long-enough-to-truncate-in-the-menu", environments: [] },
] as const;
const ROW_IDS = [
  "Overview",
  ...PROJECTS.flatMap((project) => [
    project.name,
    ...project.environments.map((environment) => `${project.name} › ${environment}`),
  ]),
] as const;

export default definePlayground({
  section: "sidebar",
  name: "Sidebar",
  imports:
    'import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSubButton } from "~/components/ui/sidebar";',
  controls: {
    active: { kind: "enum", options: ROW_IDS, note: "the row whose page is open" },
    size: { kind: "enum", options: SIZES, note: "a row's height; icon: the folded rail" },
    variant: { kind: "enum", options: VARIANTS, note: "outline: a row that stands as a control" },
    subSize: { kind: "enum", options: SUB_SIZES, note: "the rows under a project" },
    search: { kind: "boolean", note: "a SidebarInput in its header" },
    footer: { kind: "boolean", note: "Settings in its foot" },
  },
  initial: {
    active: "Overview",
    size: "default",
    variant: "default",
    subSize: "md",
    search: true,
    footer: true,
  },
  render: ({ active, size, variant, subSize, search, footer }) => {
    const row = (id: string, icon: ReactNode, label: string) => (
      <SidebarMenuItem key={id}>
        <SidebarMenuButton
          aria-label={size === "icon" ? label : undefined}
          isActive={active === id}
          size={size}
          variant={variant}
        >
          {icon}
          {size === "icon" ? null : <span>{label}</span>}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
    return (
      <div className="flex h-[26rem] w-80 overflow-hidden rounded-card border">
        <SidebarProvider className="min-h-0">
          <Sidebar collapsible="none">
            {search ? (
              <SidebarHeader>
                <SidebarInput aria-label="Search the menu" placeholder="Search" />
              </SidebarHeader>
            ) : null}
            <SidebarContent>
              <SidebarGroup>
                <SidebarMenu>
                  {row("Overview", <HomeIcon />, "Overview")}
                  {PROJECTS.flatMap((project) => [
                    row(project.name, <FolderIcon />, project.name),
                    ...project.environments.map((environment) => {
                      const id = `${project.name} › ${environment}`;
                      return (
                        <SidebarMenuItem key={id}>
                          <SidebarMenuSubButton isActive={active === id} size={subSize}>
                            {environment}
                          </SidebarMenuSubButton>
                        </SidebarMenuItem>
                      );
                    }),
                  ])}
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
            {footer ? (
              <SidebarFooter>
                <SidebarMenu>{row("Settings", <SettingsIcon />, "Settings")}</SidebarMenu>
              </SidebarFooter>
            ) : null}
          </Sidebar>
        </SidebarProvider>
      </div>
    );
  },
  jsx: ({ active, size, variant, subSize }) => {
    const button = jsxElement(
      "SidebarMenuButton",
      {
        isActive: active === "storefront",
        size,
        variant,
        "aria-label": size === "icon" ? "storefront" : undefined,
      },
      size === "icon" ? "<FolderIcon />" : "<FolderIcon />\n<span>storefront</span>",
      { isActive: false, size: "default", variant: "default" },
    );
    const sub = jsxElement(
      "SidebarMenuSubButton",
      { isActive: active === "storefront › Stage", size: subSize },
      "Stage",
      { isActive: false, size: "md" },
    );
    return jsxElement(
      "SidebarMenu",
      {},
      [jsxElement("SidebarMenuItem", {}, button), jsxElement("SidebarMenuItem", {}, sub)].join(
        "\n",
      ),
    );
  },
  usage: {
    do: [
      "Build the app's menu from it: a SidebarMenuButton per place, isActive on the open one.",
      "Lead each row with its icon or face; let a long name truncate.",
      "Put a project's environments under it as SidebarMenuSubButtons.",
    ],
    dont: [
      "Draw a menu row from a Button: the menu's rows take the sidebar's own tokens.",
      "Mark more than one row active.",
      "Use the sidebar's rows for a list on a page: those are Rows.",
    ],
  },
});
