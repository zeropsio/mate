import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  CloudIcon,
  GitPullRequestIcon,
  PanelLeftCloseIcon,
  SettingsIcon,
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  status,
  waiting,
  jump,
}: {
  isElectron: boolean;
  /**
   * How current the menu is, while it is not (`SidebarHqStatus`): before the waiting faces, in
   * the row, so saying it moves nothing under it.
   */
  status?: ReactNode;
  /**
   * The Mates waiting on the viewer (`SidebarWaitingStack`), in a slot kept
   * whether or not anybody waits, so the header never moves. Absent where the
   * menu lists no Mates.
   */
  waiting?: ReactNode;
  /**
   * The way into the jump box (`SidebarJumpButton`), on the row's end edge,
   * 12 px from the menu's edge. Absent where the menu has no jump box.
   */
  jump?: ReactNode;
}) {
  return (
    // The row is the top bar's (`--workspace-topbar-height`), so a page's
    // header beside it shares its centre and its bottom edge. On the web
    // that is 65 px, so the mark (33 px, centred) stands 16 px from the top
    // as it stands 16 px from the left (the owner, 2026-09-29: "visually logo
    // has smaller padding on top than on the left"), and ⌘K and the waiting
    // faces share its centre. Beside a desktop's traffic lights the bar is
    // the title bar's height, centred on them.
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="md:hidden" />
      <SidebarBrand />
      {status === undefined && waiting === undefined && jump === undefined ? null : (
        // The room the mark leaves: ⌘K on the end edge, whole, and the
        // waiting faces before it in a slot of at most 96 px that gives way
        // first — fewer faces where the row is narrow (`waitingFacesThatFit`).
        // Its end is the menu's end edge, 16 px short of the divider, as the
        // mark is 16 px in from the window (the owner, 2026-09-29: "padding
        // around this whole column feels a little inconsistent").
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:pe-4">
          {status}
          {waiting === undefined ? null : (
            <div
              className="flex min-w-0 max-w-24 flex-1 items-center justify-end"
              data-zerops-surface="sidebar-waiting-slot"
            >
              {waiting}
            </div>
          )}
          {jump}
        </div>
      )}
    </SidebarHeader>
  );
});

function SidebarBrand() {
  return (
    // The mark stands in the menu's face column: 16 px in, as wide as the
    // Mates' faces under it (the owner, 2026-09-29: "remove the 'mate' and
    // make the width of the logo as wide as the mate below") — except on
    // macOS, where the traffic lights push the whole titlebar's content right.
    <Link
      aria-label={APP_BASE_NAME}
      className="ml-[max(var(--workspace-controls-left),1rem)] hidden h-8.25 w-fit min-w-0 shrink-0 items-center rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 md:flex"
      to="/"
    >
      {/* The live mark alone, 28 px wide: its 44 × 52 box stands 33 px tall. Awake as it mounts:
          the boot frame painted the open mark here, and this one takes over from it. */}
      <MateMark awake playful className="h-8.25 w-7" />
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
function sidebarAccountDestinationIcon(id: SidebarAccountDestination["id"]) {
  switch (id) {
    case "projects":
      return <CloudIcon />;
    case "git":
      return <GitPullRequestIcon />;
    case "usage":
      return <ChartNoAxesColumnIcon />;
    case "settings":
      return <SettingsIcon />;
  }
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
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
          <SidebarZeropsAccountRow destinationIcon={sidebarAccountDestinationIcon} />
        </SidebarMenuItem>
      )}
      <SidebarUpdatePill />
      <SidebarUtilityItem
        className="ml-auto"
        icon={<PanelLeftCloseIcon />}
        label="Collapse sidebar"
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
