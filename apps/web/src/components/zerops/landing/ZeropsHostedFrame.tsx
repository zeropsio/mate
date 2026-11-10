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
import { useState, type ReactNode } from "react";

import { APP_BASE_NAME } from "../../../branding";
import { isElectron } from "../../../env";
import { useIsMobile } from "~/hooks/useMediaQuery";
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
import { PhoneBarContext } from "../system/PhoneBar";

export function ZeropsHostedFrame({
  breadcrumb,
  actions,
  bar = true,
  centered = false,
  footer,
  width = "wide",
  children,
}: {
  /** Shown in the bar inside the app shell, where the sidebar holds the brand. */
  readonly breadcrumb?: ReactNode;
  /** The bar's right side. */
  readonly actions?: ReactNode;
  /**
   * `false` draws no bar: the landing states (sign-in, the pairing pages, the
   * callback) are one composition in the middle of the page, and a bar above
   * it would only hold the brand a second time. On the desktop the window
   * still needs something to drag by, so a bare strip stays.
   */
  readonly bar?: boolean;
  /** A single card in the middle of the page (sign-in, the callback) rather than a page. */
  readonly centered?: boolean;
  /** One quiet line at the foot of a centred page — the byline. */
  readonly footer?: ReactNode;
  readonly width?: WorkspacePageWidth;
  readonly children: ReactNode;
}) {
  const standalone = useOptionalSidebar() === null;
  // On a phone the menu's button stands fixed in the corner: every page in the shell keeps one
  // bar's line beside it, and the page scrolls beneath that, never under the button.
  const phone = useIsMobile() && !standalone && !centered;
  // A page without a bar of its own says its first line there (`InPhoneBar`).
  const [phoneBar, setPhoneBar] = useState<HTMLElement | null>(null);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {/* The bar's own padding goes; its content sits in the page's column,
            so the lockup lines up with the title and the account with the
            title row's action, at every width. */}
        {bar ? (
          <WorkspacePageHeader
            className={cn("px-0 sm:px-0", standalone && "border-b border-border")}
            data-zerops-frame={standalone ? "standalone" : "shell"}
            electron={isElectron}
          >
            <div
              className={cn(
                "mx-auto flex h-full w-full min-w-0 items-center gap-3",
                // Beside the menu's button the header already steps in; the page's gutter ends it.
                phone ? "pr-4" : "px-5 sm:px-6",
                workspacePageWidthClass(width),
              )}
            >
              {standalone ? (
                <Link
                  aria-label={APP_BASE_NAME}
                  className="flex h-7 shrink-0 items-center rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2"
                  to="/"
                >
                  <MateLockup decorative className="h-6 w-auto" />
                </Link>
              ) : null}
              {breadcrumb ?? null}
              {actions === undefined ? null : (
                <div className="ms-auto flex min-w-0 items-center gap-2">{actions}</div>
              )}
            </div>
          </WorkspacePageHeader>
        ) : phone ? (
          <WorkspacePageHeader className="pr-4" data-zerops-frame="phone" electron={isElectron}>
            <div className="flex h-full min-w-0 flex-1 items-center gap-3" ref={setPhoneBar} />
          </WorkspacePageHeader>
        ) : isElectron ? (
          <div
            aria-hidden="true"
            className="drag-region h-[var(--workspace-topbar-height)] shrink-0"
          />
        ) : null}

        {centered ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {/* Hung from a fixed height, never centred on its own: a card that grows grows
                downward, and the boot's splash mark (index.html) stands where its mark lands. */}
            <div className="flex flex-1 justify-center px-6 pt-status-page pb-6">{children}</div>
            {footer === undefined ? null : (
              <footer className="flex shrink-0 justify-center px-6 pb-6">{footer}</footer>
            )}
          </div>
        ) : (
          <PhoneBarContext value={phone && !bar ? phoneBar : undefined}>
            <ScrollArea className="min-h-0 flex-1">
              {/* A phone's gutter is 16 px, and under the bar the page starts at once. */}
              <WorkspacePageContainer className={cn("px-4", phone && "pt-2")} width={width}>
                {children}
              </WorkspacePageContainer>
            </ScrollArea>
          </PhoneBarContext>
        )}
      </div>
    </SidebarInset>
  );
}
