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
