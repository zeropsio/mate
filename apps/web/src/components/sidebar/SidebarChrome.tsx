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
  waiting,
  jump,
}: {
  isElectron: boolean;
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
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="md:hidden" />
      <SidebarBrand />
      {waiting === undefined && jump === undefined ? null : (
        // The room the mark leaves: ⌘K on the end edge, whole, and the
        // waiting faces before it in a slot of at most 96 px that gives way
        // first — fewer faces where the row is narrow (`waitingFacesThatFit`).
        // Its end is the menu's end edge, 16 px short of the divider, as the
        // mark is 16 px in from the window (the owner, 2026-09-29: "padding
        // around this whole column feels a little inconsistent").
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:pe-4">
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
      {/* The live mark alone, 28 px wide: its 44 × 52 box stands 33 px tall. */}
      <MateMark playful className="h-8.25 w-7" />
    </Link>
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
    case "gitea":
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
  // Where the footer is a way back: the pages that are somewhere else. The
  // projects screen (/zerops) is the root of a Zerops account, not somewhere
  // else — there the footer keeps its shape and lights its own icon, so the
  // sidebar looks the same on every visit to the route.
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
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
      {isOnUtilityPage ? (
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
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
