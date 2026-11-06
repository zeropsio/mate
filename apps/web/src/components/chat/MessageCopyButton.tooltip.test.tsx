// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("a message copy tooltip and accessible name identify the same message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { MessageCopyButton } = await import("./MessageCopyButton");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
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
    const tooltip = document.querySelector('[data-slot="tooltip-popup"]');
    expect(tooltip?.textContent).toBe("Copy message");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
