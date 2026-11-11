// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { MateFace } from "./MateFace";

/** The browser's reports of the face, oldest first, in the one call a busy page makes. */
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
    name: "a batch of [on screen, hidden] counts as hidden: its eyes stay put",
    seen: [true, false],
    follows: false,
  },
  {
    name: "a batch of [hidden, on screen] counts as on screen: its eyes follow the pointer",
    seen: [false, true],
    follows: true,
  },
])("$name", async ({ seen, follows }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", reportsInOneBatch(seen));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MateFace state="idle" tint="olive" tracks />));
    await act(async () => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 400, clientY: 300, pointerType: "mouse" }),
      );
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    const face = container.querySelector<HTMLElement>("[data-mate-face-tracks]");
    expect(face?.style.getPropertyValue("--mate-gaze-x") !== "").toBe(follows);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
