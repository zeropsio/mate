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
import { Link, useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { APP_BASE_NAME } from "../../branding";
import { MateLockup } from "../MateLockup";
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
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
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
    </SidebarHeader>
  );
});

function SidebarBrand() {
  return (
    // The mark starts on the panel's own glyph column — the search icon, the
    // footer's controls — except on macOS, where the traffic lights push the
    // whole titlebar's content right.
    <Link
      aria-label={APP_BASE_NAME}
      className="ml-[max(var(--workspace-controls-left),1rem)] hidden h-7 w-fit min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 md:flex"
      to="/"
    >
      {/* Identity v1's lockup: the still mark and the wordmark, outlined — the
          one place the product's name is set, so no page repeats it. */}
      <MateLockup decorative live className="h-6 w-auto" />
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
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  // Where the footer is a way back: the pages that are somewhere else. The
  // projects screen (/zerops) is the root of a Zerops account, not somewhere
  // else — there the footer keeps its shape and lights its own icon, so the
  // sidebar looks the same on every visit to the route.
  const currentFooterPage = useLocation({
    select: (location) =>
      /^\/settings(?:\/|$)/.test(location.pathname)
        ? "settings"
        : /^\/projects\/[^/]+\/?$/.test(location.pathname)
          ? "project-settings"
          : location.pathname === "/usage"
            ? "usage"
            : null,
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
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, closeMobileSidebar, navigate]);

  return (
    <SidebarMenu className="flex-row items-center">
      {currentFooterPage ? (
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
