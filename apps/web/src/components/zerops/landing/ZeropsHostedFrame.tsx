/**
 * The frame every Zerops page stands in: sign-in, the organization choice,
 * the environments list, a new environment, the sign-in callback.
 *
 * One top bar, one content width. What the bar's left side holds depends on
 * where the page renders: inside the app shell the sidebar already carries
 * the lockup, so the bar holds only the page's breadcrumb (when it has a
 * parent); standing alone — the bare shell, the account gate — the bar
 * carries the lockup itself, as a way home, with the breadcrumb after it. The
 * right side is the caller's: the organization switcher, the account,
 * whatever the page needs at hand.
 *
 * Presentational. The one decision it takes (shell or standalone) it reads
 * from the sidebar context, so the same page needs no prop to say which.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { APP_BASE_NAME } from "../../../branding";
import { isElectron } from "../../../env";
import { cn } from "~/lib/utils";
import { MateLockup } from "../../MateLockup";
import { ScrollArea } from "../../ui/scroll-area";
import { SidebarInset, useOptionalSidebar } from "../../ui/sidebar";
import {
  WorkspacePageContainer,
  workspacePageWidthClass,
  type WorkspacePageWidth,
} from "../../WorkspacePageContainer";
import { WorkspacePageHeader } from "../../WorkspacePageHeader";

export function ZeropsHostedFrame({
  breadcrumb,
  actions,
  centered = false,
  width = "wide",
  children,
}: {
  /** Shown in the bar inside the app shell, where the sidebar holds the brand. */
  readonly breadcrumb?: ReactNode;
  /** The bar's right side. */
  readonly actions?: ReactNode;
  /** A single card in the middle of the page (sign-in, the callback) rather than a page. */
  readonly centered?: boolean;
  readonly width?: WorkspacePageWidth;
  readonly children: ReactNode;
}) {
  const standalone = useOptionalSidebar() === null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {/* The bar's own padding goes; its content sits in the page's column,
            so the lockup lines up with the title and the account with the
            title row's action, at every width. */}
        <WorkspacePageHeader
          className={cn("px-0 sm:px-0", standalone && "border-b border-border")}
          data-zerops-frame={standalone ? "standalone" : "shell"}
          electron={isElectron}
        >
          <div
            className={cn(
              "mx-auto flex h-full w-full min-w-0 items-center gap-3 px-5 sm:px-6",
              workspacePageWidthClass(width),
            )}
          >
            {standalone ? (
              <Link
                aria-label={APP_BASE_NAME}
                className="flex h-7 shrink-0 items-center rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2"
                to="/"
              >
                <MateLockup decorative className="h-4.5 w-auto" />
              </Link>
            ) : null}
            {breadcrumb ?? null}
            {actions === undefined ? null : (
              <div className="ms-auto flex min-w-0 items-center gap-2">{actions}</div>
            )}
          </div>
        </WorkspacePageHeader>

        {centered ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
            {children}
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <WorkspacePageContainer width={width}>{children}</WorkspacePageContainer>
          </ScrollArea>
        )}
      </div>
    </SidebarInset>
  );
}
