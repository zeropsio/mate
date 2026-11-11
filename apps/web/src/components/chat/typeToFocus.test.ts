// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vite-plus/test";

import { shouldTypeToFocusComposer } from "./typeToFocus";

/** A letter typed with the focus on `target`, as the page's key listener hears it. */
function typed(target: Element, key = "j"): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  let heard: KeyboardEvent | undefined;
  window.addEventListener("keydown", (seen) => (heard = seen), { once: true });
  target.dispatchEvent(event);
  return heard!;
}

/** A dialog's popup as the kit draws it, open or kept mounted while closed. */
function popup(slot: string, open: boolean): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("role", "dialog");
  element.setAttribute("tabindex", "-1");
  element.setAttribute("data-slot", slot);
  element.setAttribute(open ? "data-open" : "data-closed", "");
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("typing with nothing to type into goes to the composer", () => {
  it("takes a letter typed with nothing focused into the composer", () => {
    expect(shouldTypeToFocusComposer(typed(document.body))).toBe(true);
  });

  // The jump box is the palette's dialog: a letter typed after a click on its list or its foot,
  // where the focus is on the dialog and on no field, was written into the Mate's draft behind it
  // (Aleš, 2026-10-27: "Draft: Jago").
  it.each([
    { dialog: "the jump box", slot: "command-dialog-popup" },
    { dialog: "a dialog", slot: "dialog-popup" },
    { dialog: "an alert dialog", slot: "alert-dialog-popup" },
    { dialog: "a sheet", slot: "sheet-popup" },
  ])("a letter typed in $dialog never goes to the composer behind it", ({ slot }) => {
    expect(shouldTypeToFocusComposer(typed(popup(slot, true)))).toBe(false);
  });

  it("goes to the composer again once the dialog is closed, though it stays mounted", () => {
    popup("dialog-popup", false);
    expect(shouldTypeToFocusComposer(typed(document.body))).toBe(true);
  });
});
