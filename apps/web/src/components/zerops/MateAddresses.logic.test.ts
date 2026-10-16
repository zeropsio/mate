import { describe, expect, it } from "vite-plus/test";

import {
  mateAddressNameWords,
  mateAddressOpenTarget,
  mateAddressRoleWord,
} from "./MateAddresses.logic";

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
    /** `auxclick` fires for the right button too: its menu is the browser's, never a pick. */
    { name: "a right click opens nothing", event: { ...click, button: 2 }, expected: "none" },
    { name: "a back button opens nothing", event: { ...click, button: 3 }, expected: "none" },
  ] as const)("$name", ({ event, expected }) => {
    expect(mateAddressOpenTarget(event)).toBe(expected);
  });
});

describe("mateAddressRoleWord", () => {
  it.each([
    { role: "dev", expected: "Dev" },
    { role: "preview", expected: "Preview" },
    { role: "stage", expected: "Stage" },
    { role: "production", expected: "Production" },
    { role: undefined, expected: undefined },
  ] as const)("$role reads $expected", ({ role, expected }) => {
    expect(mateAddressRoleWord(role)).toBe(expected);
  });
});

// The live check of 0.15.144: the Sites list read "Dev appdev", "Preview appstage" — a hostname
// beside the word that already says what the site is, above an address that names it again.
describe("mateAddressNameWords", () => {
  it.each([
    {
      name: "a service's bare hostname is said by the role and the address",
      address: { role: "preview", name: "appstage" },
      expected: undefined,
    },
    {
      name: "an environment's name tells two of one role apart",
      address: { role: "stage", name: "app · EU" },
      expected: "app · EU",
    },
    {
      name: "a dev server's port tells two parts apart",
      address: { role: "dev", name: "web :5173" },
      expected: "web :5173",
    },
    {
      name: "a service outside the roles is its name alone",
      address: { role: undefined, name: "docs" },
      expected: undefined,
    },
  ] as const)("$name", ({ address, expected }) => {
    expect(mateAddressNameWords(address)).toBe(expected);
  });
});
