/**
 * The closed menu on a desktop and the open one, as one surface: the rail rests over the open
 * menu, which stays drawn — its rows, its scroll — however the menu stands.
 *
 * - Closed, the menu waits clipped to the rail's edge, hidden and out of the keyboard's way. A
 *   pointer resting on the rail never shows it (the owner, 2026-10-12: "it stems from the reveal..
 *   we should do tiles and just not do reveal").
 * - Opened — from the rail or ⌘B — the menu grows out of the rail's edge and docks, and only the
 *   page slides, its edge travelling with the menu's (`Sidebar`'s `layered`). Closing reverses it.
 */
import { memo, type ReactNode } from "react";

import { useSidebar } from "../ui/sidebar";

export function SidebarStage({
  rail,
  railHolds,
  children,
}: {
  /** The closed menu; none on a phone, where the menu is a sheet. */
  readonly rail: ReactNode | null;
  /** How many tiles the rail holds: covered, it is drawn again only when that changes. */
  readonly railHolds?: number;
  /** The open menu. */
  readonly children: ReactNode;
}) {
  const { open } = useSidebar();
  if (rail === null) return children;
  return (
    // The rail stands over the open menu, which waits clipped to the rail's edge; opened, it grows
    // out of that edge and docks while the page's edge travels with its own; closing, it shrinks
    // back into the rail. Its visibility steps with the clip: shown at once, hidden at its end.
    <div
      className="relative flex min-h-0 w-full flex-auto flex-col"
      data-zerops-surface="sidebar-stage"
    >
      <div
        className={
          open
            ? "pointer-events-none absolute inset-y-0 left-0 z-1 flex w-(--sidebar-width-icon) flex-col border-r border-sidebar-border bg-sidebar bg-(image:--surface-grain) opacity-0 transition-opacity duration-150 ease-out-strong motion-reduce:transition-none"
            : "absolute inset-y-0 left-0 z-1 flex w-(--sidebar-width-icon) flex-col border-r border-sidebar-border bg-sidebar bg-(image:--surface-grain) transition-opacity duration-150 ease-out-strong motion-reduce:transition-none"
        }
        inert={open}
      >
        <RailUnderMenu covered={open} holds={railHolds}>
          {rail}
        </RailUnderMenu>
      </div>
      <div
        className={
          open
            ? "absolute inset-y-0 left-0 flex w-(--sidebar-width) flex-col border-r border-sidebar-border transition-[clip-path,visibility] duration-260 ease-out-strong [clip-path:inset(0_0_0_0)] before:absolute before:inset-0 before:-z-1 before:bg-sidebar before:bg-(image:--surface-grain) motion-reduce:transition-none"
            : "pointer-events-none invisible absolute inset-y-0 left-0 flex w-(--sidebar-width) flex-col border-r border-sidebar-border transition-[clip-path,visibility] duration-200 ease-out-strong [clip-path:inset(0_calc(100%-var(--sidebar-width-icon))_0_0)] before:absolute before:inset-0 before:-z-1 before:bg-sidebar before:bg-(image:--surface-grain) motion-reduce:transition-none"
        }
        data-zerops-surface="sidebar-menu"
        inert={!open}
      >
        <div
          className={
            open
              ? "flex min-h-0 flex-auto flex-col transition-opacity duration-150 ease-out-strong motion-reduce:transition-none"
              : "flex min-h-0 flex-auto flex-col opacity-0 transition-opacity duration-150 ease-out-strong motion-reduce:transition-none"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The rail while the open menu covers it — unseen and inert — keeps its last drawing: its tiles,
 * their faces and tips are not drawn again for every Mate opened or word streamed. A tile coming
 * or going draws it, so its tiles are there to show; and it is drawn anew in the render that
 * closes the menu, before it shows.
 */
const RailUnderMenu = memo(
  function RailUnderMenu({
    children,
  }: {
    readonly covered: boolean;
    readonly holds: number | undefined;
    readonly children: ReactNode;
  }) {
    return children;
  },
  (previous, next) => previous.covered && next.covered && previous.holds === next.holds,
);

/**
 * Whether the open menu is out rather than waiting under the rail — or, on a phone, in its sheet
 * drawn and hidden while closed.
 */
export function sidebarMenuShown(): boolean {
  return (
    document.querySelector(
      '[data-zerops-surface="sidebar-menu"][inert], [data-slot="sidebar"][data-mobile="true"][hidden]',
    ) === null
  );
}
