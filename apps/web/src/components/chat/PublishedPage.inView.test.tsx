// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { PublishedPageFrame } from "./PublishedPage";

/** The browser's reports of the page, oldest first, in the one call a busy page makes. */
function reportsInOneBatch(seen: ReadonlyArray<boolean>) {
  return class {
    constructor(private readonly on: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.on(
        seen.map(
          (isIntersecting, time) => ({ target, isIntersecting, time }) as IntersectionObserverEntry,
        ),
        this as unknown as IntersectionObserver,
      );
    }
    disconnect() {}
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  {
    name: "a batch of [on screen, hidden] counts as hidden: the page's frame does not run",
    seen: [true, false],
    runs: false,
  },
  {
    name: "a batch of [hidden, on screen] counts as on screen: the page's frame runs",
    seen: [false, true],
    runs: true,
  },
])("$name", async ({ seen, runs }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", reportsInOneBatch(seen));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PublishedPageFrame
          title="Launch plan"
          html="<p>Launch</p>"
          theme={{ scheme: "light", vars: {} }}
        />,
      ),
    );
    expect(container.querySelector("iframe") !== null).toBe(runs);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
