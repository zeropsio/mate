// @vitest-environment happy-dom
/**
 * The composer standing in while a Mate connects is where the person types,
 * as the conversation's composer is: it takes the focus as it arrives, and a
 * key typed with nothing to type into goes to it.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerStandIn, type StandInTyped } from "./ComposerStandIn";

let root: Root | undefined;
let typed: StandInTyped = { text: "", caret: 0 };

function Host() {
  const [value, setValue] = useState<StandInTyped>({ text: "", caret: 0 });
  typed = value;
  return <ComposerStandIn typed={value} onType={setValue} />;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const show = async () => {
  const host = document.createElement("div");
  document.body.append(host);
  await act(() => {
    root = createRoot(host);
    root.render(<Host />);
  });
  return document.querySelector("textarea")!;
};

describe("the composer standing in", () => {
  it("takes the focus as it arrives", async () => {
    const field = await show();
    expect(document.activeElement).toBe(field);
  });

  // Where the person put the focus meanwhile — the jump box's field, the menu's search, an open
  // dialog — it stays; a row they clicked to get here gives it up, as the conversation's would.
  it.each([
    { case: "a field the person types into", holder: "input", taken: false },
    { case: "a menu row they clicked", holder: "button", taken: true },
  ])("arriving while $case holds the focus: taken $taken", async ({ holder, taken }) => {
    const elsewhere = document.createElement(holder);
    document.body.append(elsewhere);
    elsewhere.focus();
    const field = await show();
    expect(document.activeElement).toBe(taken ? field : elsewhere);
  });

  it("leaves the focus in an open dialog", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const choice = document.createElement("button");
    dialog.append(choice);
    document.body.append(dialog);
    choice.focus();
    await show();
    expect(document.activeElement).toBe(choice);
  });

  it("takes a key typed with nothing to type into, the caret after it", async () => {
    const field = await show();
    field.blur();
    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    });
    expect(typed).toEqual({ text: "d", caret: 1 });
    expect(document.activeElement).toBe(field);
  });

  it("leaves a shortcut alone", async () => {
    const field = await show();
    field.blur();
    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(typed.text).toBe("");
  });
});
