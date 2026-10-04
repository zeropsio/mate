import { describe, expect, it } from "vite-plus/test";

import { mateAddressOpenTarget, mateAddressRoleWord } from "./MateAddresses.logic";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false };

describe("mateAddressOpenTarget", () => {
  /** A pick opens the address in the panel's Browser; the browser's own new-tab gestures open a tab. */
  it.each([
    { name: "a plain click opens it in the panel", event: click, expected: "panel" },
    { name: "⌘-click opens a new tab", event: { ...click, metaKey: true }, expected: "new-tab" },
    { name: "ctrl-click opens a new tab", event: { ...click, ctrlKey: true }, expected: "new-tab" },
    {
      name: "shift-click opens a new tab",
      event: { ...click, shiftKey: true },
      expected: "new-tab",
    },
    { name: "a middle click opens a new tab", event: { ...click, button: 1 }, expected: "new-tab" },
    { name: "a key press opens it in the panel", event: undefined, expected: "panel" },
  ] as const)("$name", ({ event, expected }) => {
    expect(mateAddressOpenTarget(event)).toBe(expected);
  });
});

describe("mateAddressRoleWord", () => {
  it.each([
    { role: "dev", expected: "Dev" },
    { role: "stage", expected: "Stage" },
    { role: "production", expected: "Production" },
    { role: undefined, expected: undefined },
  ] as const)("$role reads $expected", ({ role, expected }) => {
    expect(mateAddressRoleWord(role)).toBe(expected);
  });
});
