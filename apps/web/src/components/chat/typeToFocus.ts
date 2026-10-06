/**
 * Typing with nothing to type into goes to the composer: a printable key,
 * unmodified, outside every field, control and open layer. `ChatView` routes
 * it into the conversation's composer.
 */
const TYPE_TO_FOCUS_EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");
const TYPE_TO_FOCUS_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(",");
// Popups match only while open or closing: some stay mounted when closed,
// such as the chat header actions menu.
const TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[data-slot="dialog"]',
  '[data-slot="menu-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="select-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="popover-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="combobox-popup"]:is([data-open],[data-ending-style])',
  '[data-slot="autocomplete-popup"]:is([data-open],[data-ending-style])',
].join(",");

function eventPathContainsSelector(event: Event, selector: string): boolean {
  const path = event.composedPath();
  if (path.length === 0 && event.target) {
    path.push(event.target);
  }
  return path.some((target) => target instanceof Element && target.closest(selector));
}

export function shouldTypeToFocusComposer(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  // "/" with nothing focused opens the jump box (`jumpSlash.ts`); a slash
  // command starts in the composer once it has the focus.
  if (event.key === "/") return false;

  if (eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR)) return false;
  if (eventPathContainsSelector(event, TYPE_TO_FOCUS_INTERACTIVE_SELECTOR)) return false;
  if (document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)) return false;

  // The right-panel surface launcher claims its shortcut letters while it is
  // visible (data attribute set in RightPanelTabs); those keys open surfaces
  // instead of typing into the composer.
  const launcherKeys = document
    .querySelector("[data-surface-launcher-keys]")
    ?.getAttribute("data-surface-launcher-keys");
  if (launcherKeys && launcherKeys.toLowerCase().includes(event.key.toLowerCase())) return false;

  return true;
}
