import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("a message copy tooltip and accessible name identify the same message", async () => {
  const browser = new Window();
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", browser.document);
  vi.stubGlobal("Element", browser.Element);
  vi.stubGlobal("HTMLElement", browser.HTMLElement);
  vi.stubGlobal("Node", browser.Node);
  vi.stubGlobal("navigator", browser.navigator);
  vi.stubGlobal("MutationObserver", browser.MutationObserver);
  vi.stubGlobal("ResizeObserver", browser.ResizeObserver);
  vi.stubGlobal("ShadowRoot", browser.ShadowRoot);
  vi.stubGlobal("getComputedStyle", browser.getComputedStyle.bind(browser));
  vi.stubGlobal("requestAnimationFrame", browser.requestAnimationFrame.bind(browser));
  vi.stubGlobal("cancelAnimationFrame", browser.cancelAnimationFrame.bind(browser));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { MessageCopyButton } = await import("./MessageCopyButton");
  const host = browser.document.createElement("div");
  browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () => root.render(<MessageCopyButton text="The whole message" />));
    const button = host.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Copy message");
    // Happy DOM does not implement keyboard focus visibility.
    const matches = button!.matches.bind(button!);
    vi.spyOn(button!, "matches").mockImplementation(
      (selector) => selector === ":focus-visible" || matches(selector),
    );
    await act(async () => button!.focus());
    const tooltip = browser.document.querySelector('[data-slot="tooltip-popup"]');
    expect(tooltip?.textContent).toBe("Copy message");
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.abort();
  }
});
