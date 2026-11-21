import { isCommandPaletteOpen } from "~/commandPaletteBus";
import type { SidebarRevealTarget } from "~/zerops/sidebarReveal";

/**
 * Where a reveal lands: the control a person would have pressed there takes
 * the focus, and the row that was asked for flashes once — a Mate's own row,
 * a project's heading.
 */
interface RevealLanding {
  readonly focus: HTMLElement;
  readonly flash: HTMLElement;
}

export function revealLanding(
  root: HTMLElement | null,
  target: SidebarRevealTarget,
): RevealLanding | null {
  if (root === null) return null;
  const find = (selector: string) => root.querySelector<HTMLElement>(selector);
  switch (target.kind) {
    case "mate": {
      const row = find(
        `[data-zerops-mate-row="${target.projectId}"] [data-zerops-surface="sidebar-mate"]`,
      );
      return row === null ? null : { focus: row, flash: row };
    }
    case "project": {
      // Its own row: its group's, or its one Mate's.
      const row = find(`[data-zerops-group="${target.groupId}"] [data-zerops-row]`);
      if (row === null) return null;
      return { focus: row, flash: row.closest<HTMLElement>("[data-zerops-mate-unit]") ?? row };
    }
    case "change":
      // The menu only marks what waits for review; its Review is the conversation header's. A
      // found change opens its own page.
      return null;
  }
}

/**
 * One flash of the row a reveal landed on (`zerops-reveal-flash` in
 * `index.css`): while it rings, the focus ring of the control in it waits,
 * and takes over once it is done — one mark at a time.
 */
export function flashOnce(element: HTMLElement): void {
  element.removeAttribute("data-zerops-flash");
  // A reveal of the same row twice flashes it twice: the animation restarts.
  void element.offsetWidth;
  element.setAttribute("data-zerops-flash", "");
  element.addEventListener(
    "animationend",
    () => {
      element.removeAttribute("data-zerops-flash");
    },
    { once: true },
  );
}

/**
 * Focus a revealed row once nothing modal holds the focus: the jump box
 * closing hands the focus back as it goes, and a row focused before that
 * would lose it at once.
 */
export function focusOnceFree(element: HTMLElement, then: () => void, frames = 0): void {
  if (isCommandPaletteOpen() && frames < 30) {
    requestAnimationFrame(() => {
      focusOnceFree(element, then, frames + 1);
    });
    return;
  }
  if (!element.isConnected) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest" });
  then();
}
