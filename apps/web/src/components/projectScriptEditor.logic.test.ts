import { describe, expect, it } from "vite-plus/test";

import { scriptKeybindingKeydown, type ScriptKeybindingKeydown } from "./projectScriptEditor.logic";

type Press = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

const press = (input: Press) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...input,
});

describe("projectScriptEditor.logic", () => {
  // A script binding is matched in the capture phase across the whole app, so a plain key
  // would take over the composer: Enter would run the script instead of sending.
  it.each<[string, Press, ScriptKeybindingKeydown]>([
    ["Enter submits the form instead of becoming a binding", { key: "Enter" }, { type: "pass" }],
    ["Esc closes the dialog instead of becoming a binding", { key: "Escape" }, { type: "pass" }],
    ["Tab moves focus instead of becoming a binding", { key: "Tab" }, { type: "pass" }],
    ["a plain Space is not recorded", { key: " " }, { type: "ignore" }],
    ["a plain letter is not recorded", { key: "k" }, { type: "ignore" }],
    [
      "Shift with a letter is recorded",
      { key: "P", shiftKey: true },
      { type: "record", keybinding: "shift+p" },
    ],
    [
      "Cmd+K is recorded as mod+k",
      { key: "k", metaKey: true },
      { type: "record", keybinding: "mod+k" },
    ],
    [
      "Alt+Shift+P is recorded",
      { key: "P", altKey: true, shiftKey: true },
      { type: "record", keybinding: "alt+shift+p" },
    ],
    [
      "Cmd+Enter is recorded",
      { key: "Enter", metaKey: true },
      { type: "record", keybinding: "mod+enter" },
    ],
    ["Backspace clears the binding", { key: "Backspace" }, { type: "clear" }],
    ["Delete clears the binding", { key: "Delete" }, { type: "clear" }],
    [
      "a modifier pressed alone records nothing yet",
      { key: "Meta", metaKey: true },
      { type: "ignore" },
    ],
  ])("in the script editor, %s", (_title, input, expected) => {
    expect(scriptKeybindingKeydown(press(input), "MacIntel")).toEqual(expected);
  });
});
