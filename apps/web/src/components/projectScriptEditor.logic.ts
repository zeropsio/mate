import { keybindingFromKeyboardEvent } from "~/components/settings/KeybindingsSettings.logic";

export type ScriptKeybindingKeydown =
  | { type: "record"; keybinding: string }
  | { type: "clear" }
  | { type: "ignore" }
  | { type: "pass" };

type KeydownLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * What a keydown in the script editor's Keybinding field does. A script binding is matched in
 * the capture phase across the whole app, so it needs a modifier: a plain Enter, Esc or Tab
 * keeps its form meaning (submit, close, move focus) and other plain keys record nothing.
 */
export function scriptKeybindingKeydown(
  event: KeydownLike,
  platform: string,
): ScriptKeybindingKeydown {
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  if (!hasModifier) {
    if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab")
      return { type: "pass" };
    if (event.key === "Backspace" || event.key === "Delete") return { type: "clear" };
    return { type: "ignore" };
  }
  if (event.key === "Tab") return { type: "pass" };
  const keybinding = keybindingFromKeyboardEvent(event, platform);
  return keybinding ? { type: "record", keybinding } : { type: "ignore" };
}
