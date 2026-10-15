import {
  ArrowLeftIcon,
  Building2Icon,
  ChartNoAxesColumnIcon,
  GitPullRequestIcon,
  LayersIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import type { SidebarAccountDestination } from "../zerops/SidebarZeropsAccount.logic";
import { SidebarZeropsAccountRow } from "../zerops/SidebarZeropsAccount";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { Link, useLocation } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { APP_BASE_NAME } from "../../branding";
import { MateMark } from "../MateMark";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  status,
  actions,
  brand,
}: {
  isElectron: boolean;
  /**
   * What stands in the mark's place: the Chief's row, the bar's whole width, the squares floating
   * over its end (`.menu-top`). Its own pieces take the bar's grid: whatever spans both columns
   * runs under the squares, whatever keeps to the first stops short of them.
   */
  brand?: ReactNode;
  /**
   * How current the menu is, while it is not (`SidebarHqStatus`): between the mark and the
   * squares, so saying it moves neither.
   */
  status?: ReactNode;
  /**
   * The row's two quiet squares, on its end edge 16 px in from the divider: search, and + for a
   * new Mate or project. Absent where the menu offers neither.
   */
  actions?: ReactNode;
}) {
  return (
    // The row is the top bar's (`--workspace-topbar-height`), so a page's header beside it shares
    // its centre and its bottom edge; on the web its 40 px mark stands centred in it on the Mates'
    // faces' column. Beside a desktop's traffic lights the bar is the title bar's height, centred
    // on them.
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="md:hidden" />
      {brand === undefined ? (
        <>
          <SidebarBrand />
          {status === undefined && actions === undefined ? null : (
            <div
              className="flex min-w-0 flex-1 items-center justify-end gap-1 md:ps-3 md:pe-4"
              data-zerops-surface="sidebar-top-actions"
            >
              {status}
              {actions}
            </div>
          )}
        </>
      ) : (
        <div className="menu-top">
          {brand}
          {status === undefined && actions === undefined ? null : (
            <div
              className="menu-top-squares flex items-center justify-end gap-1 md:pe-4"
              data-zerops-surface="sidebar-top-actions"
            >
              {status}
              {actions}
            </div>
          )}
        </div>
      )}
    </SidebarHeader>
  );
});

/** A project New Mate may be asked in: its id (the group) and its name. */
export interface SidebarCreateProject {
  readonly id: string;
  readonly name: string;
}

/**
 * The top row's +: a small menu with New Mate and New project, the menu's own
 * flows (`useAddMate`, `useAskNewProject`). New Mate asks in a project: where
 * there is one, at once; with several, it lists them. It holds only what the
 * viewer's role may make — no `onNewProject` where it may not create projects —
 * its name says what it holds, and with nothing to make it is not drawn.
 */
export function SidebarCreateButton({
  projects,
  onNewMate,
  onNewProject,
}: {
  readonly projects: ReadonlyArray<SidebarCreateProject>;
  readonly onNewMate: (projectId: string) => void;
  /** New project, where the viewer's role creates projects. */
  readonly onNewProject?: (() => void) | undefined;
}) {
  const [only] = projects;
  const label =
    only === undefined
      ? "New project"
      : onNewProject === undefined
        ? "New Mate"
        : "New Mate or project";
  if (only === undefined && onNewProject === undefined) return null;
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  aria-label={label}
                  className="menu-round-button"
                  data-zerops-surface="sidebar-create"
                  type="button"
                />
              }
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="w-50">
        {only === undefined ? null : projects.length === 1 ? (
          <MenuItem
            data-zerops-create="mate"
            onClick={() => {
              onNewMate(only.id);
            }}
          >
            New Mate
          </MenuItem>
        ) : (
          <MenuSub>
            <MenuSubTrigger data-zerops-create="mate">New Mate</MenuSubTrigger>
            <MenuSubPopup>
              {projects.map((project) => (
                <MenuItem
                  data-zerops-create-in={project.id}
                  key={project.id}
                  onClick={() => {
                    onNewMate(project.id);
                  }}
                >
                  {project.name}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>
        )}
        {onNewProject === undefined ? null : (
          <MenuItem data-zerops-create="project" onClick={onNewProject}>
            New project
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}

function SidebarBrand() {
  return (
    // The mark leads to the overview. It stands on the menu's faces' column, its centre theirs (the
    // owner, 2026-10-11: "alignment of Mate logo against mates below is shit") — except on macOS,
    // where the traffic lights push the whole titlebar's content right.
    <Link
      aria-label={APP_BASE_NAME}
      className="ml-[max(var(--workspace-controls-left),22px)] hidden h-9 w-7.5 min-w-0 shrink-0 items-center rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 md:flex"
      to="/zerops"
    >
      {/* The live mark alone, 30 x 36 centred in the row (the owner, 2026-10-12: "logo is too
          big, it can be smaller and still centered with the mates below"). Awake as it mounts:
          the boot frame painted the same mark in the same box, and this one takes over from it. */}
      <MateMark awake playful className="h-9 w-7.5" />
    </Link>
  );
}

/**
 * The mark in the window's corner while the menu is closed: a link home,
 * live, where the open menu's logo row holds its own (`SidebarBrand`).
 */
export function SidebarCornerMark() {
  return (
    // Centred in the top bar's row, as the open menu's mark is in its logo
    // row, and in a box the size of a titlebar control, which insets it by
    // half the difference: its left edge stands where the open mark's does.
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Link
        aria-label={APP_BASE_NAME}
        className="pointer-events-auto grid size-[var(--workspace-titlebar-control-size)] place-items-center rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 [-webkit-app-region:no-drag]"
        to="/"
      >
        {/* Live, as the open panel's lockup is: the same mark in the same
            corner, so closing the panel does not still it. */}
        <MateMark awake playful className="h-6 w-auto" />
      </Link>
    </div>
  );
}

function SidebarUtilityItem({
  active = false,
  className,
  icon,
  label,
  onClick,
}: {
  /** The page this item opens is the one open now: lit the way the menu lights its open row. */
  active?: boolean;
  className?: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className={cn("shrink-0", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-current={active ? "page" : undefined}
              aria-label={label}
              isActive={active}
              onClick={onClick}
              size="icon"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/**
 * The glyph beside each destination in the account menu. It lives here rather
 * than in the row: the chrome already owns which icon stands for which place,
 * and the design system keeps one icon map (design-system.md §3).
 */
export function sidebarAccountDestinationIcon(id: SidebarAccountDestination["id"]) {
  switch (id) {
    case "projects":
      return <LayersIcon />;
    case "git":
      return <GitPullRequestIcon />;
    case "usage":
      return <ChartNoAxesColumnIcon />;
    case "team":
      return <UsersIcon />;
    case "settings":
      return <SettingsIcon />;
  }
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, open, setOpenMobile, toggleSidebar } = useSidebar();
  const showBackFooter = useLocation({
    select: (location) => location.pathname !== "/usage" && isSidebarUtilityPage(location.pathname),
  });
  // Where each destination goes, and which one is open, is the account row's
  // now: the four glyphs it replaced were the only readers.
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    void navigateToMainApp();
  }, [closeMobileSidebar, navigateToMainApp]);

  return (
    <SidebarMenu className="flex-row items-center">
      {showBackFooter ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        // One row says who is signed in and whose organization's projects are
        // listed above it, and folds the four destinations into its menu —
        // where each has a name rather than an unlabelled glyph.
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarZeropsAccountRow
            chiefIcon={<Building2Icon />}
            destinationIcon={sidebarAccountDestinationIcon}
          />
        </SidebarMenuItem>
      )}
      <SidebarUpdatePill />
      {/* Peeking out of the rail, the menu docks where it stands. */}
      <SidebarUtilityItem
        className="ml-auto"
        icon={isMobile || open ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
        label={isMobile || open ? "Collapse sidebar" : "Open the menu"}
        onClick={toggleSidebar}
      />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
