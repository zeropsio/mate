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
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
  bar = true,
  centered = false,
  footer,
  width = "wide",
  side,
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
  /**
   * A column beside the page, below the bar (an environment's vault), full height — where the
   * frame is wide enough for the page beside it ({@link SIDE_BESIDE_MIN_PX}); under the page,
   * full width, where it is not. Drawn for the place it is given.
   */
  readonly side?: ((placement: SidePlacement) => ReactNode) | undefined;
  readonly children: ReactNode;
}) {
  const standalone = useOptionalSidebar() === null;

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
                  <MateLockup decorative className="h-6 w-auto" />
                </Link>
              ) : null}
              {breadcrumb ?? null}
              {actions === undefined ? null : (
                <div className="ms-auto flex min-w-0 items-center gap-2">{actions}</div>
              )}
            </div>
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
        ) : side === undefined ? (
          <ScrollArea className="min-h-0 flex-1">
            <WorkspacePageContainer width={width}>{children}</WorkspacePageContainer>
          </ScrollArea>
        ) : (
          <FrameWithSide side={side} width={width}>
            {children}
          </FrameWithSide>
        )}
      </div>
    </SidebarInset>
  );
}

/** Where a frame's side column stands: beside the page, or under it. */
export type SidePlacement = "beside" | "under";

/**
 * The frame's width from which a side column stands beside the page: below it the page would be
 * squeezed until a table of services stacks into towers, so the column goes under the page.
 */
export const SIDE_BESIDE_MIN_PX = 1100;

/** The page and its side column, beside or under it by the frame's own width. */
function FrameWithSide({
  side,
  width,
  children,
}: {
  readonly side: (placement: SidePlacement) => ReactNode;
  readonly width: WorkspacePageWidth;
  readonly children: ReactNode;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<SidePlacement>("beside");
  // Measured before paint, so the page never draws in one arrangement and moves to the other.
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    const place = (widthPx: number) =>
      setPlacement(widthPx >= SIDE_BESIDE_MIN_PX ? "beside" : "under");
    place(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) place(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex min-h-0 flex-1" data-zerops-side={placement} ref={host}>
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <WorkspacePageContainer width={width}>
          {children}
          {placement === "under" ? side("under") : null}
        </WorkspacePageContainer>
      </ScrollArea>
      {placement === "beside" ? side("beside") : null}
    </div>
  );
}
