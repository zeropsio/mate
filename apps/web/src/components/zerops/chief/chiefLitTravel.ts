/**
 * The Chief's lit ground and the menu's selected band are one band to the eye (the owner,
 * 2026-10-12: "it should have the same smooth animation when going from a real mate"): opening
 * the Chief carries the ground from the band up to the Chief's row, and opening a Mate from the
 * Chief carries it down to the Mate's. Transform and opacity only, so it runs while the page it
 * opens is drawn.
 */

/** As long as the band's own slide (`SidebarSelectedBand`), on the same strong ease-out. */
const TRAVEL_MS = 240;
const TRAVEL_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

const LIT = '[data-zerops-surface="sidebar-chief-row"] .menu-chief-lit';
const LIT_ON =
  '[data-zerops-surface="sidebar-chief-row"]:is([data-current], [data-pressed]) .menu-chief-lit';

const still = () =>
  typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `box` drawn at `at`, as a transform from its own place (its origin its top-left corner). */
function placed(box: DOMRect, at: DOMRect): string {
  return `translate(${String(at.left - box.left)}px, ${String(at.top - box.top)}px) scale(${String(at.width / box.width)}, ${String(at.height / box.height)})`;
}

function carry(lit: HTMLElement, from: DOMRect, to: DOMRect): void {
  const home = lit.parentElement?.getBoundingClientRect();
  if (home === undefined || home.width === 0 || home.height === 0) return;
  lit.dataset["travel"] = "";
  lit.style.transformOrigin = "0 0";
  const run = lit.animate(
    [
      { transform: placed(home, from), opacity: 1 },
      { transform: placed(home, to), opacity: 1 },
    ],
    { duration: TRAVEL_MS, easing: TRAVEL_EASE },
  );
  const done = () => {
    delete lit.dataset["travel"];
    lit.style.transformOrigin = "";
  };
  run.onfinish = done;
  run.oncancel = done;
}

/**
 * The Chief pressed: the menu's band, where one stands, travels up into the Chief's row and
 * steps aside there.
 */
export function carryBandToChief(): void {
  if (typeof document === "undefined" || still()) return;
  const lit = document.querySelector<HTMLElement>(LIT);
  const band = document.querySelector<HTMLElement>(".menu-band[data-on]");
  if (lit === null || band === null) return;
  const home = lit.parentElement?.getBoundingClientRect();
  if (home === undefined) return;
  carry(lit, band.getBoundingClientRect(), home);
  band.dataset["away"] = "";
  setTimeout(() => {
    delete band.dataset["away"];
  }, TRAVEL_MS + 400);
}

/** A Mate pressed while the Chief is the open one: its lit ground travels down to `unit`. */
export function carryChiefTo(unit: HTMLElement): void {
  if (typeof document === "undefined" || still()) return;
  const lit = document.querySelector<HTMLElement>(LIT_ON);
  const home = lit?.parentElement?.getBoundingClientRect();
  if (lit === null || home === undefined) return;
  carry(lit, home, unit.getBoundingClientRect());
}
