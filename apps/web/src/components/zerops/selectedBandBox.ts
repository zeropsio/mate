import type { BandBox } from "./SidebarSelectedBand.logic";

/**
 * What the menu's selected band shows this moment, in the window, mid-travel too: its box is
 * what its nested layers leave of each other (`SidebarSelectedBand`), so it is read from them.
 */
export function shownBandBox(band: Element): BandBox {
  let top = -Infinity;
  let left = -Infinity;
  let bottom = Infinity;
  let right = Infinity;
  for (let layer = band.firstElementChild; layer !== null; layer = layer.firstElementChild) {
    const rect = layer.getBoundingClientRect();
    top = Math.max(top, rect.top);
    left = Math.max(left, rect.left);
    bottom = Math.min(bottom, rect.bottom);
    right = Math.min(right, rect.right);
  }
  if (top === -Infinity) return band.getBoundingClientRect();
  return { top, left, bottom: Math.max(top, bottom), right: Math.max(left, right) };
}
