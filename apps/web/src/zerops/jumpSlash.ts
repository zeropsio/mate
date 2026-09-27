/**
 * `/` opens the jump box, as ⌘K does, wherever nothing is being typed: not in
 * a field, the composer or the terminal, and not in an open menu, dialog or
 * list, whose keys are theirs (`slashOpensJumpBox`).
 */
import { slashOpensJumpBox } from "../components/zerops/JumpBox.logic";
import { isEditableFocused } from "../lib/editableFocus";

/** Somewhere a key belongs to what has it: a menu, a dialog or a list. */
const OWNS_KEYS = '[role="menu"], [role="dialog"], [role="listbox"]';

export function slashKeyOpensJumpBox(event: KeyboardEvent): boolean {
  const target = event.target;
  return slashOpensJumpBox({
    key: event.key,
    modified: event.metaKey || event.ctrlKey || event.altKey,
    composing: event.isComposing,
    handled: event.defaultPrevented,
    owned:
      isEditableFocused(target) ||
      (target instanceof Element && target.closest(OWNS_KEYS) !== null),
  });
}
